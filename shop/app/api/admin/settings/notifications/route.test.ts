import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), get: vi.fn(), save: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/telegram-settings', () => ({ getTelegramSettings: mocks.get, saveTelegramSettings: mocks.save, clearTelegramCredentials: mocks.clear, validateTelegramChatId: (value: unknown) => typeof value === 'string' && /^-?\d+$/.test(value) ? value : undefined, validateTelegramToken: (value: unknown) => typeof value === 'string' && /^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(value) ? value : undefined }))
const admin = { isAdmin: true as const, loginAt: 9 }
const request = (body: unknown) => new Request('http://localhost/api/admin/settings/notifications', { method: 'PATCH', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null) })

describe('Telegram notification settings API', () => {
  it('does not disclose settings before authentication', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }))
    const { GET } = await import('@/app/api/admin/settings/notifications/route')
    expect((await GET()).status).toBe(401); expect(mocks.get).not.toHaveBeenCalled()
  })

  it('uses no-store, rejects empty chat ID when supplied, and preserves omitted fields', async () => {
    const { GET, PATCH } = await import('@/app/api/admin/settings/notifications/route')
    mocks.get.mockResolvedValue({ enabled: false, configured: true, tokenLast4: 'abcd' })
    const response = await GET(); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(await response.json()).not.toHaveProperty('botToken')
    expect((await PATCH(request({ enabled: false, chatId: '' }))).status).toBe(400)
    mocks.save.mockResolvedValue({ enabled: false, configured: true, tokenLast4: 'abcd' })
    expect((await PATCH(request({ enabled: false }))).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith({ enabled: false }, 9)
  })
})
