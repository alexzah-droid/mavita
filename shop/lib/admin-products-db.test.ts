import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: mocks.query, withTransaction: mocks.transaction }))
const row = { id: 1, slug: 'svecha', name: 'Свеча', series: null, subtitle: null, description: null, price_kopecks: 10000, scent: [], in_stock: true, visibility: 'hidden', sale_price_kopecks: null, sale_starts_at: null, sale_ends_at: null, sort_order: 0, created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-20T00:00:00Z', images: [] }
beforeEach(() => { mocks.query.mockReset(); mocks.transaction.mockReset(); mocks.transaction.mockImplementation(async (callback) => callback({ query: vi.fn() })) })
describe('admin product persistence rules', () => {
  it('creates new products hidden by default', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [row] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { createAdminProduct } = await import('@/lib/admin-products-db'); const product = await createAdminProduct({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 })
    expect(product.visibility).toBe('hidden'); expect(client.query.mock.calls[0][0]).toContain('INSERT INTO products'); expect(client.query.mock.calls[0][1]).toContain('hidden')
  })
  it('updates public sort orders atomically only for an exact set', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 1 }] }).mockResolvedValue({ rows: [] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderPublicProducts } = await import('@/lib/admin-products-db'); expect(await reorderPublicProducts([1, 2])).toBe('ok'); expect(client.query).toHaveBeenCalledWith('UPDATE products SET sort_order = $1 WHERE id = $2', [10, 1]); expect(client.query).toHaveBeenCalledWith('UPDATE products SET sort_order = $1 WHERE id = $2', [20, 2])
  })
  it('does not update rows when the public set is stale or duplicate', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderPublicProducts } = await import('@/lib/admin-products-db'); expect(await reorderPublicProducts([1, 1])).toBe('conflict'); expect(client.query).toHaveBeenCalledTimes(1)
  })
})
