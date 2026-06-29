import { describe, it, expect, beforeEach, vi } from 'vitest'

// markOrderPaid общается с БД — мокаем слой db, чтобы прогонять чистую логику
// переходов статуса (TD-17/TD-18) без реального Postgres.
vi.mock('@/lib/db', () => ({
  isDbConfigured: () => true,
  query: vi.fn(),
  withTransaction: async (fn: (client: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }) => Promise<unknown>) => fn({ query: async <T>(text: string, params?: unknown[]) => ({ rows: await q(text, params) as T[] }) }),
}))
vi.mock('@/lib/telegram-notifications', () => ({ enqueueOrderNotification: vi.fn() }))

import { markOrderPaid } from '@/lib/orders'
import { query } from '@/lib/db'
import { enqueueOrderNotification } from '@/lib/telegram-notifications'

const q = vi.mocked(query)
const RAW = { InvId: '5', OutSum: '1800.00' }

beforeEach(() => { q.mockReset(); vi.mocked(enqueueOrderNotification).mockReset() })

describe('markOrderPaid', () => {
  it('pending + совпадающая сумма → paid (UPDATE затронул строку)', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }]) // SELECT
    q.mockResolvedValueOnce([{ id: 5 }]) // UPDATE … RETURNING
    expect(await markOrderPaid(5, 180000, RAW)).toBe('paid')
    expect(enqueueOrderNotification).toHaveBeenCalledWith(expect.anything(), { orderId: 5, eventType: 'payment_paid', eventKey: 'order:5:paid' })
  })

  it('оплаченный CDEK-заказ при включённой автоотправке ставит задачу create_shipment', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000, delivery_method: 'cdek_pickup', pickup_point_code: 'MSK65' }]) // SELECT order
    q.mockResolvedValueOnce([{ id: 5 }]) // UPDATE … RETURNING
    q.mockResolvedValueOnce([{ cdek_auto_shipment_enabled: true }]) // SELECT store_settings
    q.mockResolvedValueOnce([]) // INSERT cdek_task_outbox

    expect(await markOrderPaid(5, 180000, RAW)).toBe('paid')
    expect(q).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cdek_task_outbox'),
      [5, 'create_shipment:5'],
    )
  })

  it('оплаченный CDEK-заказ не ставит задачу, когда автоотправка выключена', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000, delivery_method: 'cdek_pickup', pickup_point_code: 'MSK65' }]) // SELECT order
    q.mockResolvedValueOnce([{ id: 5 }]) // UPDATE … RETURNING
    q.mockResolvedValueOnce([{ cdek_auto_shipment_enabled: false }]) // SELECT store_settings

    expect(await markOrderPaid(5, 180000, RAW)).toBe('paid')
    expect(q.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO cdek_task_outbox'))).toBe(false)
  })

  it('уже оплачен → already_paid, без UPDATE (идемпотентность)', async () => {
    q.mockResolvedValueOnce([{ status: 'paid', total_kopecks: 180000 }])
    expect(await markOrderPaid(5, 180000, RAW)).toBe('already_paid')
    expect(q).toHaveBeenCalledTimes(1) // только SELECT, без записи
    expect(enqueueOrderNotification).not.toHaveBeenCalled()
  })

  it('несовпадение суммы → amount_mismatch, без UPDATE', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }])
    expect(await markOrderPaid(5, 100, RAW)).toBe('amount_mismatch')
    expect(q).toHaveBeenCalledTimes(1)
  })

  it('заказа нет → not_found', async () => {
    q.mockResolvedValueOnce([])
    expect(await markOrderPaid(999, 180000, RAW)).toBe('not_found')
  })

  // TD-17: отменённый заказ не должен «оплачиваться» и не должен молча возвращать paid.
  it('отменённый заказ → cancelled, без UPDATE', async () => {
    q.mockResolvedValueOnce([{ status: 'cancelled', total_kopecks: 180000 }])
    expect(await markOrderPaid(5, 180000, RAW)).toBe('cancelled')
    expect(q).toHaveBeenCalledTimes(1)
  })

  it('неконсистентный pending без awaiting_payment не подтверждается', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }]) // SELECT
    q.mockResolvedValueOnce([]) // UPDATE … RETURNING — 0 строк
    expect(await markOrderPaid(5, 180000, RAW)).toBe('not_found')
  })
})
