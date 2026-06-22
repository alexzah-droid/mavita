import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), getProfile: vi.fn(), enqueueSingle: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/ozon-fbs-profile', async (orig) => ({ ...(await orig<typeof import('@/lib/ozon-fbs-profile')>()), getOzonProfile: mocks.getProfile }))
vi.mock('@/lib/ozon-fbs-service', () => ({ catalogSyncEnabled: () => process.env.OZON_CATALOG_SYNC_ENABLED === 'true', enqueueSingle: mocks.enqueueSingle }))

const admin = { isAdmin: true as const, loginAt: 5 }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = () => new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost' } })
const enabledProfile = { enabled: true, remoteState: 'not_synced' }

beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null); mocks.getProfile.mockResolvedValue(enabledProfile); mocks.enqueueSingle.mockResolvedValue({ id: 'run-1', status: 'queued' }) })
afterEach(() => { delete process.env.OZON_CATALOG_SYNC_ENABLED })

describe('POST ozon-profile/import — dark gate', () => {
  it('требует аутентификацию', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }))
    const { POST } = await import('./route')
    expect((await POST(req(), params('9'))).status).toBe(401)
    expect(mocks.enqueueSingle).not.toHaveBeenCalled()
  })
  it('OZON_CATALOG_SYNC_ENABLED не true → 409, Ozon не вызывается', async () => {
    process.env.OZON_CATALOG_SYNC_ENABLED = 'false'
    const { POST } = await import('./route')
    const res = await POST(req(), params('9'))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CATALOG_SYNC_DISABLED')
    expect(mocks.enqueueSingle).not.toHaveBeenCalled()
  })
  it('gate включён + canImport → ставит single content_import', async () => {
    process.env.OZON_CATALOG_SYNC_ENABLED = 'true'
    const { POST } = await import('./route')
    const res = await POST(req(), params('9'))
    expect(res.status).toBe(200)
    expect(mocks.enqueueSingle).toHaveBeenCalledWith('content_import', 9, 5)
  })
  it('gate включён, но профиль выключен → 409 без вызова', async () => {
    process.env.OZON_CATALOG_SYNC_ENABLED = 'true'
    mocks.getProfile.mockResolvedValue({ enabled: false, remoteState: 'disabled' })
    const { POST } = await import('./route')
    expect((await POST(req(), params('9'))).status).toBe(409)
    expect(mocks.enqueueSingle).not.toHaveBeenCalled()
  })
})
