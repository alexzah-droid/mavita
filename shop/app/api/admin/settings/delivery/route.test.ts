import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

class DeliveryConfigurationError extends Error { constructor(m = 'incomplete') { super(m); this.name = 'DeliveryConfigurationError' } }
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/store-settings', () => ({ getDeliverySettings: mocks.get, saveCarrierSettings: mocks.save, DeliveryConfigurationError }))

const admin = { isAdmin: true as const, loginAt: 12 }
const emptyDto = { carriers: { cdek: { enabled: false, hasSecret: false, secretMask: null, clientId: null, deliveryKopecks: null }, ozon: { enabled: false, hasSecret: false, secretMask: null, clientId: null, deliveryKopecks: null } }, updatedAt: null, updatedByActorLoginAt: null }
beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null) })
const patch = (body: unknown) => new Request('http://localhost/api/admin/settings/delivery', { method: 'PATCH', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('delivery settings API', () => {
  it('не раскрывает настройки до аутентификации', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }))
    const { GET } = await import('@/app/api/admin/settings/delivery/route')
    expect((await GET()).status).toBe(401); expect(mocks.get).not.toHaveBeenCalled()
  })

  it('GET отдаёт DTO с масками (без открытого секрета)', async () => {
    mocks.get.mockResolvedValue(emptyDto)
    const { GET } = await import('@/app/api/admin/settings/delivery/route')
    const res = await GET(); expect(res.status).toBe(200); expect(await res.json()).toEqual(emptyDto)
  })

  it('отвергает неизвестные поля и неизвестного перевозчика', async () => {
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    expect((await PATCH(patch({ carrier: 'cdek', bogus: 1 }))).status).toBe(400)
    expect((await PATCH(patch({ carrier: 'sber', deliveryKopecks: 0 }))).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('отвергает маску как новый секрет', async () => {
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    expect((await PATCH(patch({ carrier: 'cdek', secret: '••••3f2a' }))).status).toBe(400)
  })

  it('секрет+тариф+enabled в одном запросе уходят в saveCarrierSettings', async () => {
    mocks.save.mockResolvedValue(emptyDto)
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    const res = await PATCH(patch({ carrier: 'cdek', enabled: true, clientId: 'cid', secret: 's3cr3t', deliveryKopecks: 35000 }))
    expect(res.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith('cdek', { enabled: true, clientId: 'cid', secret: 's3cr3t', deliveryKopecks: 35000 }, 12)
  })

  it('пустой секрет = «не менять» (в patch не попадает)', async () => {
    mocks.save.mockResolvedValue(emptyDto)
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    await PATCH(patch({ carrier: 'cdek', deliveryKopecks: 0, secret: '' }))
    expect(mocks.save).toHaveBeenCalledWith('cdek', { deliveryKopecks: 0 }, 12)
  })

  it('включение без полного набора → 409', async () => {
    mocks.save.mockRejectedValue(new DeliveryConfigurationError())
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    expect((await PATCH(patch({ carrier: 'ozon', enabled: true }))).status).toBe(409)
  })

  it('CSRF (чужой Origin) → 403', async () => {
    mocks.csrf.mockReturnValue(NextResponse.json({}, { status: 403 }))
    const { PATCH } = await import('@/app/api/admin/settings/delivery/route')
    expect((await PATCH(patch({ carrier: 'cdek', deliveryKopecks: 0 }))).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
