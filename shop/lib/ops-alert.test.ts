import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ creds: vi.fn() }))
vi.mock('@/lib/telegram-settings', () => ({ getTelegramDeliveryCredentials: mocks.creds }))

beforeEach(() => mocks.creds.mockReset())
afterEach(() => vi.unstubAllGlobals())

describe('sendOpsAlert — подтверждение доставки', () => {
  it('Telegram не настроен → delivered:false, fetch не зовём', async () => {
    mocks.creds.mockResolvedValue(undefined)
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const { sendOpsAlert } = await import('@/lib/ops-alert')
    expect(await sendOpsAlert('x')).toEqual({ delivered: false, reason: 'telegram_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('2xx + { ok:true, result:{ message_id } } → delivered:true', async () => {
    mocks.creds.mockResolvedValue({ chatId: '1', token: 't' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) } as Response))
    const { sendOpsAlert } = await import('@/lib/ops-alert')
    expect(await sendOpsAlert('x')).toEqual({ delivered: true })
  })
  it('2xx, но { ok:false } (контракт Telegram не выполнен) → delivered:false, telegram_not_ok', async () => {
    mocks.creds.mockResolvedValue({ chatId: '1', token: 't' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, description: 'chat not found' }) } as Response))
    const { sendOpsAlert } = await import('@/lib/ops-alert')
    expect(await sendOpsAlert('x')).toEqual({ delivered: false, reason: 'telegram_not_ok' })
  })
  it('HTTP 429 (rate limit) → delivered:false, причина http_429 (fetch не бросает на 4xx)', async () => {
    mocks.creds.mockResolvedValue({ chatId: '1', token: 't' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ ok: false }) } as Response))
    const { sendOpsAlert } = await import('@/lib/ops-alert')
    expect(await sendOpsAlert('x')).toEqual({ delivered: false, reason: 'http_429' })
  })
  it('сетевой сбой → delivered:false, причина network', async () => {
    mocks.creds.mockResolvedValue({ chatId: '1', token: 't' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    const { sendOpsAlert } = await import('@/lib/ops-alert')
    expect(await sendOpsAlert('x')).toEqual({ delivered: false, reason: 'network' })
  })
})
