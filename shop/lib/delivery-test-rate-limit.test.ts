import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isDb: vi.fn(() => true), withTx: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: mocks.isDb, withTransaction: mocks.withTx, query: vi.fn() }))

function fakeClient(recentRows: { created_at: string }[]) {
  const calls: string[] = []
  const query = vi.fn(async (text: string) => {
    calls.push(text)
    if (text.includes('SELECT created_at FROM delivery_test_attempts')) return { rows: recentRows }
    return { rows: [] }
  })
  return { query, calls }
}

beforeEach(() => { mocks.isDb.mockReturnValue(true); mocks.withTx.mockReset() })

describe('delivery test rate limit', () => {
  it('берёт advisory-блокировку ДО подсчёта (защита от гонки) и вставляет при ok', async () => {
    const client = fakeClient([])
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { registerDeliveryTestAttempt } = await import('@/lib/delivery-test-rate-limit')
    const res = await registerDeliveryTestAttempt(123, '1.2.3.4')
    expect(res).toEqual({ ok: true })
    expect(client.calls[0]).toContain('pg_advisory_xact_lock') // блокировка первой
    expect(client.calls.some((q) => q.startsWith('INSERT INTO delivery_test_attempts'))).toBe(true)
  })

  it('при 5 попытках в окне → ok:false с Retry-After, без вставки', async () => {
    const now = Date.now()
    const rows = Array.from({ length: 5 }, (_, i) => ({ created_at: new Date(now - i * 1000).toISOString() }))
    const client = fakeClient(rows)
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { registerDeliveryTestAttempt } = await import('@/lib/delivery-test-rate-limit')
    const res = await registerDeliveryTestAttempt(123, '1.2.3.4')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.retryAfterSeconds).toBeGreaterThan(0)
    expect(client.calls.some((q) => q.startsWith('INSERT INTO delivery_test_attempts'))).toBe(false)
  })
})
