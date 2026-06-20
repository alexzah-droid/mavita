import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/store-settings', () => ({ getDeliverySettings: mocks.get, saveDeliverySettings: mocks.save, validateDeliveryKopecks: (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined }))
const admin = { isAdmin: true as const, loginAt: 12 }
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null) })
const patch = (body: unknown) => new Request('http://localhost/api/admin/settings/delivery', { method: 'PATCH', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
describe('delivery settings API', () => {
  it('does not disclose settings before authentication', async () => { mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 })); const { GET } = await import('@/app/api/admin/settings/delivery/route'); expect((await GET()).status).toBe(401); expect(mocks.get).not.toHaveBeenCalled() })
  it('accepts explicit free delivery and rejects arbitrary JSON', async () => { const { PATCH } = await import('@/app/api/admin/settings/delivery/route'); expect((await PATCH(patch({ cdekPickupDeliveryKopecks: -1 }))).status).toBe(400); mocks.save.mockResolvedValue({ cdekPickupDeliveryKopecks: 0 }); expect((await PATCH(patch({ cdekPickupDeliveryKopecks: 0 }))).status).toBe(200); expect(mocks.save).toHaveBeenCalledWith(0, 12) })
})
