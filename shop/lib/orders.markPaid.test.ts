import { describe, it, expect, beforeEach, vi } from 'vitest'

// markOrderPaid общается с БД — мокаем слой db, чтобы прогонять чистую логику
// переходов статуса (TD-17/TD-18) без реального Postgres.
vi.mock('@/lib/db', () => ({
  isDbConfigured: () => true,
  query: vi.fn(),
}))

import { markOrderPaid } from '@/lib/orders'
import { query } from '@/lib/db'

const q = vi.mocked(query)
const RAW = { InvId: '5', OutSum: '1800.00' }

beforeEach(() => q.mockReset())

describe('markOrderPaid', () => {
  it('pending + совпадающая сумма → paid (UPDATE затронул строку)', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }]) // SELECT
    q.mockResolvedValueOnce([{ id: 5 }]) // UPDATE … RETURNING
    expect(await markOrderPaid(5, 180000, RAW)).toBe('paid')
  })

  it('уже оплачен → already_paid, без UPDATE (идемпотентность)', async () => {
    q.mockResolvedValueOnce([{ status: 'paid', total_kopecks: 180000 }])
    expect(await markOrderPaid(5, 180000, RAW)).toBe('already_paid')
    expect(q).toHaveBeenCalledTimes(1) // только SELECT, без записи
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

  // TD-18: строку увели между SELECT и UPDATE (гонка колбэков) — UPDATE 0 строк,
  // перечитываем статус и возвращаем честный результат вместо ложного 'paid'.
  it('гонка: pending на SELECT, но UPDATE 0 строк и стало paid → already_paid', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }]) // SELECT
    q.mockResolvedValueOnce([]) // UPDATE … RETURNING — 0 строк
    q.mockResolvedValueOnce([{ status: 'paid' }]) // перечитали статус
    expect(await markOrderPaid(5, 180000, RAW)).toBe('already_paid')
  })

  it('гонка: UPDATE 0 строк и заказ оказался cancelled → cancelled', async () => {
    q.mockResolvedValueOnce([{ status: 'pending', total_kopecks: 180000 }])
    q.mockResolvedValueOnce([])
    q.mockResolvedValueOnce([{ status: 'cancelled' }])
    expect(await markOrderPaid(5, 180000, RAW)).toBe('cancelled')
  })
})
