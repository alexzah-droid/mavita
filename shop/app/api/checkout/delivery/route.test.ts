import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/lib/store-settings', () => ({
  resolveDeliveryMode: mocks.resolve,
  CARRIER_LABEL: { cdek: 'СДЭК' },
}))
beforeEach(() => mocks.resolve.mockReset())

describe('checkout/delivery', () => {
  it('disabled → { mode: disabled }', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'disabled', carriers: [] })
    const { GET } = await import('@/app/api/checkout/delivery/route')
    const res = await GET(); expect(res.status).toBe(200); expect(await res.json()).toEqual({ mode: 'disabled' })
  })

  it('error → 503', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'error', carriers: [] })
    const { GET } = await import('@/app/api/checkout/delivery/route')
    expect((await GET()).status).toBe(503)
  })

  it('pickup_required → список перевозчиков с подписями и тарифами', async () => {
    mocks.resolve.mockResolvedValue({ mode: 'pickup_required', carriers: [{ carrier: 'cdek', deliveryKopecks: 35000 }] })
    const { GET } = await import('@/app/api/checkout/delivery/route')
    const data = await (await GET()).json()
    expect(data.mode).toBe('pickup_required')
    expect(data.carriers).toEqual([{ carrier: 'cdek', label: 'СДЭК', deliveryKopecks: 35000 }])
  })
})
