import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: () => true, query: db.query, withTransaction: vi.fn() }))
import { listAdminOrders } from '@/lib/admin-orders-db'
describe('listAdminOrders', () => {
  beforeEach(() => db.query.mockReset())
  it('treats a long numeric search as a phone fragment, never an overflowing order id', async () => {
    db.query.mockResolvedValue([])
    const q = '7999123456789012345678901234567890'
    await listAdminOrders({ status: 'all', q, limit: 30 })
    const [, params] = db.query.mock.calls[0]
    expect(params).toContain(`%${q}%`)
    expect(params.some((value: unknown) => typeof value === 'number' && !Number.isSafeInteger(value))).toBe(false)
  })
})
