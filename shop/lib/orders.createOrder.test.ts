import { beforeEach, describe, expect, it, vi } from 'vitest'

// Интеграционно-образный тест createOrder: locked snapshot выбирает перевозчика и
// тариф, ПВЗ повторно подтверждается у провайдера, snapshot пишется в orders.
const mocks = vi.hoisted(() => ({ isDb: vi.fn(() => true), withTx: vi.fn(), snapshot: vi.fn(), provider: vi.fn(), enqueue: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: mocks.isDb, withTransaction: mocks.withTx, query: vi.fn() }))
vi.mock('@/lib/store-settings', () => ({
  getLockedDeliverySnapshot: mocks.snapshot,
  carrierFromMethod: (m: string) => (m === 'cdek_pickup' ? 'cdek' : undefined),
  PICKUP_METHOD: { cdek: 'cdek_pickup' },
}))
vi.mock('@/lib/delivery/providers', () => ({ providerFor: mocks.provider }))
vi.mock('@/lib/telegram-notifications', () => ({ enqueueOrderNotification: mocks.enqueue }))

// Фейковый клиент транзакции: отвечает по тексту SQL. Запоминает INSERT orders.
function makeClient(insertCapture: { params?: unknown[] }) {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      if (text.includes('FROM products')) return { rows: [{ id: 1, slug: 'a', name: 'Свеча A', price_kopecks: 100000, in_stock: true, visibility: 'public', sale_price_kopecks: null, sale_starts_at: null, sale_ends_at: null }] }
      if (text.startsWith('INSERT INTO orders')) { insertCapture.params = params; return { rows: [{ id: 42 }] } }
      if (text.startsWith('UPDATE orders SET inv_id')) return { rows: [] }
      if (text.startsWith('INSERT INTO order_items')) return { rows: [] }
      return { rows: [] }
    }),
  }
}

beforeEach(() => {
  mocks.isDb.mockReturnValue(true)
  mocks.withTx.mockReset(); mocks.snapshot.mockReset(); mocks.provider.mockReset(); mocks.enqueue.mockReset()
  mocks.enqueue.mockResolvedValue(undefined)
})

describe('createOrder (multi-carrier)', () => {
  it('оформляет СДЭК-заказ: тариф из снимка, ПВЗ подтверждён, snapshot записан', async () => {
    const capture: { params?: unknown[] } = {}
    const client = makeClient(capture)
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    mocks.snapshot.mockResolvedValue({ mode: 'pickup_required', carrier: (c: string) => (c === 'cdek' ? { deliveryKopecks: 35000, credentials: { clientId: 'cid', secret: 'k', fingerprint: 'fp' } } : undefined) })
    const getPickupPoint = vi.fn().mockResolvedValue({ code: 'MSK1', city: 'Москва', name: 'ПВЗ Центр', address: 'ул. 1' })
    mocks.provider.mockReturnValue({ getPickupPoint, listPickupPoints: vi.fn() })

    const { createOrder } = await import('@/lib/orders')
    const result = await createOrder({
      customerName: 'Иван', customerEmail: 'i@example.com', customerPhone: '+79991234567',
      delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK1', expectedDeliveryKopecks: 35000 },
      expectedTotalKopecks: 135000, items: [{ slug: 'a', quantity: 1 }],
    })

    expect(mocks.provider).toHaveBeenCalledWith('cdek', { clientId: 'cid', secret: 'k', fingerprint: 'fp' })
    expect(getPickupPoint).toHaveBeenCalledWith('MSK1')
    expect(result.deliveryCarrier).toBe('cdek')
    // INSERT orders params: [..., customer_comment($5), ..., delivery_method($9), delivery_carrier($10), code($11) ...]
    const p = capture.params!
    expect(p[8]).toBe('cdek_pickup'); expect(p[9]).toBe('cdek'); expect(p[10]).toBe('MSK1')
  })

  it('mode=error из снимка → DeliveryUnavailableError (503)', async () => {
    const client = makeClient({})
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    mocks.snapshot.mockResolvedValue({ mode: 'error', carrier: () => undefined })
    const { createOrder, DeliveryUnavailableError } = await import('@/lib/orders')
    await expect(createOrder({
      customerName: 'Иван', customerEmail: 'i@example.com', customerPhone: '+79991234567',
      delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK1', expectedDeliveryKopecks: 35000 },
      expectedTotalKopecks: 135000, items: [{ slug: 'a', quantity: 1 }],
    })).rejects.toBeInstanceOf(DeliveryUnavailableError)
  })

  it('cdek выбран, но снимок его не отдаёт → отклоняем заказ', async () => {
    const client = makeClient({})
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    mocks.snapshot.mockResolvedValue({ mode: 'pickup_required', carrier: () => undefined })
    const { createOrder, OrderValidationError } = await import('@/lib/orders')
    await expect(createOrder({
      customerName: 'Иван', customerEmail: 'i@example.com', customerPhone: '+79991234567',
      delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK1', expectedDeliveryKopecks: 35000 },
      expectedTotalKopecks: 135000, items: [{ slug: 'a', quantity: 1 }],
    })).rejects.toBeInstanceOf(OrderValidationError)
  })

  it('снимок disabled, но клиент прислал доставку → отклоняем (не молчаливый заказ без ПВЗ)', async () => {
    const client = makeClient({})
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    mocks.snapshot.mockResolvedValue({ mode: 'disabled', carrier: () => undefined })
    const { createOrder, OrderValidationError } = await import('@/lib/orders')
    await expect(createOrder({
      customerName: 'Иван', customerEmail: 'i@example.com', customerPhone: '+79991234567',
      delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK1', expectedDeliveryKopecks: 35000 },
      expectedTotalKopecks: 135000, items: [{ slug: 'a', quantity: 1 }],
    })).rejects.toBeInstanceOf(OrderValidationError)
  })

  it('disabled → заказ без ПВЗ, delivery snapshot пустой', async () => {
    const capture: { params?: unknown[] } = {}
    const client = makeClient(capture)
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    mocks.snapshot.mockResolvedValue({ mode: 'disabled', carrier: () => undefined })
    const { createOrder } = await import('@/lib/orders')
    const result = await createOrder({
      customerName: 'Иван', customerEmail: 'i@example.com', customerPhone: '+79991234567',
      delivery: null, expectedTotalKopecks: 100000, items: [{ slug: 'a', quantity: 1 }],
    })
    expect(result.deliveryCarrier).toBeNull()
    const p = capture.params!
    expect(p[4]).toBeNull() // customer_comment
    expect(p[7]).toBe(0)    // delivery_kopecks
    expect(p[8]).toBeNull() // delivery_method
    expect(p[9]).toBeNull() // delivery_carrier
  })
})
