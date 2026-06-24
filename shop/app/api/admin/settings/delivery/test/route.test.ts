import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), stored: vi.fn(), provider: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/store-settings', () => ({ getStoredCredentials: mocks.stored }))
vi.mock('@/lib/delivery/providers', () => ({ providerFor: mocks.provider }))
vi.mock('@/lib/delivery-test-rate-limit', () => ({ registerDeliveryTestAttempt: mocks.limit }))

const admin = { isAdmin: true as const, loginAt: 12 }
beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null); mocks.limit.mockResolvedValue({ ok: true }) })
const post = (body: unknown) => new Request('http://localhost/api/admin/settings/delivery/test', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(body) })

describe('delivery test endpoint', () => {
  it('успех: отдаёт sampleCount, секрет в ответ не попадает', async () => {
    mocks.stored.mockResolvedValue({ clientId: 'cid', secret: 'topsecret' })
    mocks.provider.mockReturnValue({ listPickupPoints: vi.fn().mockResolvedValue([{ code: 'A' }, { code: 'B' }]) })
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    const res = await POST(post({ carrier: 'cdek' }))
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).toContain('"sampleCount":2'); expect(text).not.toContain('topsecret')
  })

  it('нет полного набора ключей → 409 credentials_missing', async () => {
    mocks.stored.mockResolvedValue(undefined)
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    const res = await POST(post({ carrier: 'cdek' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('credentials_missing')
  })

  it('лимит исчерпан → 429 c Retry-After', async () => {
    mocks.limit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    const res = await POST(post({ carrier: 'cdek' }))
    expect(res.status).toBe(429); expect(res.headers.get('Retry-After')).toBe('42')
    expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('draft-секрет перекрывает сохранённый и не уходит в ответ', async () => {
    mocks.stored.mockResolvedValue({ clientId: 'cid', secret: 'old' })
    const list = vi.fn().mockResolvedValue([])
    mocks.provider.mockReturnValue({ listPickupPoints: list })
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    await POST(post({ carrier: 'cdek', secret: 'draftsecret' }))
    expect(mocks.provider).toHaveBeenCalledWith('cdek', { clientId: 'cid', secret: 'draftsecret' })
  })

  it('маска как draft-секрет → 400 (а не тихий тест старого ключа)', async () => {
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    const res = await POST(post({ carrier: 'cdek', secret: '••••3f2a' }))
    expect(res.status).toBe(400); expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('пустой draft-секрет → 400 (строгий контракт)', async () => {
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    expect((await POST(post({ carrier: 'cdek', secret: '   ' }))).status).toBe(400)
  })

  it('401/403 перевозчика → ok:false code=auth_failed', async () => {
    mocks.stored.mockResolvedValue({ clientId: 'cid', secret: 's' })
    const { DeliveryProviderError } = await import('@/lib/delivery/types')
    mocks.provider.mockReturnValue({ listPickupPoints: vi.fn().mockRejectedValue(new DeliveryProviderError('nope', true, true)) })
    const { POST } = await import('@/app/api/admin/settings/delivery/test/route')
    const data = await (await POST(post({ carrier: 'cdek' }))).json()
    expect(data).toEqual({ ok: false, code: 'auth_failed' })
  })
})
