import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), credentials: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/db', () => ({
  isDbConfigured: () => true,
  query: mocks.query,
  withTransaction: async (fn: (client: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }) => Promise<unknown>) => fn({ query: async <T>(text: string, params?: unknown[]) => ({ rows: await mocks.query(text, params) as T[] }) }),
}))
vi.mock('@/lib/telegram-settings', () => ({ getTelegramDeliveryCredentials: mocks.credentials, recordTelegramDeliveryError: mocks.error }))

import { drainNotificationOutbox } from '@/lib/telegram-notifications'

const row = { id: 7, payload: { orderId: 7, eventType: 'payment_paid' as const, status: 'paid', fulfillmentStatus: 'new', totalKopecks: 100, items: [], createdAt: '2026-06-21T10:00:00.000Z', eventAt: '2026-06-21T10:01:00.000Z' } }
const originalFetch = global.fetch

beforeEach(() => {
  mocks.query.mockReset(); mocks.credentials.mockReset(); mocks.error.mockReset()
  mocks.query.mockImplementation((text: string) => {
    if (text.includes('SELECT id, payload')) return [row]
    if (text.includes('RETURNING attempt_count')) return [{ attempt_count: 1 }]
    return []
  })
})

describe('Telegram outbox sender', () => {
  it('keeps a disabled channel pending without consuming an attempt and claims with SKIP LOCKED', async () => {
    mocks.credentials.mockResolvedValue(undefined)
    await drainNotificationOutbox(1)
    const sql = mocks.query.mock.calls.map(([text]) => String(text)).join('\n')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).not.toContain('attempt_count = attempt_count + 1')
    expect(sql).toContain("status = 'pending', locked_at = NULL")
  })

  it('keeps configuration failures pending without consuming an attempt', async () => {
    mocks.credentials.mockRejectedValue(new Error('Missing encryption key'))
    await drainNotificationOutbox(1)
    const sql = mocks.query.mock.calls.map(([text]) => String(text)).join('\n')
    expect(sql).toContain("available_at = now() + interval '5 minutes'")
    expect(sql).not.toContain('attempt_count = attempt_count + 1')
    expect(sql).not.toContain("status = 'failed'")
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Missing encryption key'))
  })

  it('schedules a retry for 429 after consuming exactly one attempt', async () => {
    mocks.credentials.mockResolvedValue({ chatId: '-1001', token: '123456:abcdefghijklmnopqrstuv' })
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ description: 'Too Many Requests' }), { status: 429, headers: { 'content-type': 'application/json' } })) as typeof fetch
    await drainNotificationOutbox(1)
    const sql = mocks.query.mock.calls.map(([text]) => String(text)).join('\n')
    expect(sql).toContain('attempt_count = attempt_count + 1')
    expect(sql).toContain("available_at = now() + ($2 * interval '1 minute')")
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('429:'))
  })

  it('fails and disables the channel on 401', async () => {
    mocks.credentials.mockResolvedValue({ chatId: '-1001', token: '123456:abcdefghijklmnopqrstuv' })
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ description: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch
    await drainNotificationOutbox(1)
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('401:'), true)
    expect(mocks.query.mock.calls.map(([text]) => String(text)).join('\n')).toContain("status = 'failed'")
  })
})

afterEach(() => { global.fetch = originalFetch })
