import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isDb: vi.fn(() => true), query: vi.fn(), withTx: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: mocks.isDb, query: mocks.query, withTransaction: mocks.withTx }))

beforeEach(() => { mocks.isDb.mockReturnValue(true); mocks.query.mockReset() })

describe('getOrderByToken delivery snapshot', () => {
  it('возвращает перевозчика, ПВЗ и суммы доставки для страницы заказа', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 5, customer_name: 'Иван', customer_email: 'i@e.ru', customer_phone: '+79990000000', total_kopecks: 130000, items_kopecks: 100000, delivery_kopecks: 30000, delivery_carrier: 'cdek', pickup_point_code: 'MSK1', pickup_point_city: 'Москва', pickup_point_name: 'ПВЗ', pickup_point_address: 'ул. 1', status: 'paid', created_at: '2026-06-21T00:00:00Z' }])
      .mockResolvedValueOnce([{ product_name: 'Свеча', price_kopecks: 100000, quantity: 1 }])
    const { getOrderByToken } = await import('@/lib/orders')
    const order = await getOrderByToken('tok')
    expect(order?.deliveryCarrier).toBe('cdek')
    expect(order?.deliveryKopecks).toBe(30000)
    expect(order?.itemsKopecks).toBe(100000)
    expect(order?.pickupPoint).toEqual({ code: 'MSK1', city: 'Москва', name: 'ПВЗ', address: 'ул. 1' })
  })

  it('без доставки (legacy/disabled) pickupPoint = null', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 6, customer_name: 'Пётр', customer_email: 'p@e.ru', customer_phone: null, total_kopecks: 50000, items_kopecks: 50000, delivery_kopecks: 0, delivery_carrier: null, pickup_point_code: null, pickup_point_city: null, pickup_point_name: null, pickup_point_address: null, status: 'pending', created_at: '2026-06-21T00:00:00Z' }])
      .mockResolvedValueOnce([])
    const { getOrderByToken } = await import('@/lib/orders')
    const order = await getOrderByToken('tok')
    expect(order?.deliveryCarrier).toBeNull(); expect(order?.pickupPoint).toBeNull(); expect(order?.deliveryKopecks).toBe(0)
  })
})
