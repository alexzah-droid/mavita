import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), search: vi.fn() }))
vi.mock('@/lib/store-settings', () => ({ resolveDeliveryMode: mocks.resolve }))
vi.mock('@/lib/ozon-catalog', () => ({ searchOzonPickupPoints: mocks.search }))

const req = (city = 'Москва') => new Request(`http://localhost/api/ozon?city=${encodeURIComponent(city)}`)
beforeEach(() => { mocks.resolve.mockReset(); mocks.search.mockReset() })

describe('/api/ozon', () => {
  it('Ozon активен → ищет в локальном каталоге', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'pickup_required', carriers: [{ carrier: 'ozon', deliveryKopecks: 0 }] })
    mocks.search.mockResolvedValue([{ code: '1', city: 'Москва', name: 'П', address: 'a' }])
    const { GET } = await import('@/app/api/ozon/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).pickupPoints).toHaveLength(1)
    expect(mocks.search).toHaveBeenCalledWith('Москва')
  })
  it('Ozon не активен → 503, каталог не трогаем', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'pickup_required', carriers: [{ carrier: 'cdek', deliveryKopecks: 35000 }] })
    const { GET } = await import('@/app/api/ozon/route')
    expect((await GET(req())).status).toBe(503)
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('режим error → 503', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'error', carriers: [] })
    const { GET } = await import('@/app/api/ozon/route')
    expect((await GET(req())).status).toBe(503)
  })
  it('ошибка БД каталога → 503 DELIVERY_UNAVAILABLE, не 500', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'pickup_required', carriers: [{ carrier: 'ozon', deliveryKopecks: 0 }] })
    mocks.search.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/ozon/route')
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('DELIVERY_UNAVAILABLE')
  })
})
