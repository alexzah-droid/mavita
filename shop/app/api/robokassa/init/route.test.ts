import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), payment: vi.fn(), configured: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/orders', () => {
  class OrderValidationError extends Error { constructor(public errors: string[]) { super() } }
  class PriceChangedError extends Error { constructor(public amounts: { itemsKopecks: number; deliveryKopecks: number; totalKopecks: number }) { super() } }
  class DeliveryUnavailableError extends Error {}
  return { createOrder: mocks.create, OrderValidationError, PriceChangedError, DeliveryUnavailableError }
})
vi.mock('@/lib/cdek', () => ({ CdekValidationError: class CdekValidationError extends Error { unavailable = false } }))
vi.mock('@/lib/robokassa', () => ({ buildPaymentUrl: mocks.payment, isRobokassaConfigured: mocks.configured }))
vi.mock('@/lib/db', () => ({ query: mocks.query }))
import { PriceChangedError } from '@/lib/orders'
import { POST } from '@/app/api/robokassa/init/route'
const request = () => new Request('http://localhost/api/robokassa/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerName: 'Иван Иванов', customerEmail: 'i@example.com', customerPhone: '+79991234567', delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK', expectedDeliveryKopecks: 50000 }, expectedTotalKopecks: 150000, items: [{ slug: 'candle', quantity: 1 }] }) })
beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()))
describe('Robokassa init', () => {
  it('returns all server amounts on PRICE_CHANGED, without creating a payment', async () => { mocks.create.mockRejectedValue(new PriceChangedError({ itemsKopecks: 120000, deliveryKopecks: 60000, totalKopecks: 180000 })); const response = await POST(request()); expect(response.status).toBe(409); await expect(response.json()).resolves.toMatchObject({ error: { code: 'PRICE_CHANGED' }, itemsKopecks: 120000, deliveryKopecks: 60000, totalKopecks: 180000 }); expect(mocks.payment).not.toHaveBeenCalled() })
})
