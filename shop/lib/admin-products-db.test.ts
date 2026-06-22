import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: mocks.query, withTransaction: mocks.transaction }))
const row = { id: 1, slug: 'svecha', name: 'Свеча', series: null, subtitle: null, description: null, price_kopecks: 10000, scent: [], in_stock: true, visibility: 'hidden', sale_price_kopecks: null, sale_starts_at: null, sale_ends_at: null, sort_order: 0, created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-20T00:00:00Z', images: [] }
const LOCK = 'SELECT pg_advisory_xact_lock($1::bigint)'
beforeEach(() => { mocks.query.mockReset(); mocks.transaction.mockReset(); mocks.transaction.mockImplementation(async (callback) => callback({ query: vi.fn() })) })

describe('admin product persistence rules', () => {
  it('creates new products hidden by default after taking the public-order lock', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [row] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { createAdminProduct } = await import('@/lib/admin-products-db'); const product = await createAdminProduct({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 })
    expect(product.visibility).toBe('hidden'); expect(client.query.mock.calls[0][0]).toBe(LOCK); expect(client.query.mock.calls[1][0]).toContain('INSERT INTO products'); expect(client.query.mock.calls[1][1]).toContain('hidden')
  })
  it('rejects a partial price PATCH that would drop below the stored sale, without UPDATE', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...row, price_kopecks: 10000, sale_price_kopecks: 7500 }] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { updateAdminProduct } = await import('@/lib/admin-products-db')
    await expect(updateAdminProduct(1, { priceKopecks: 5000 })).rejects.toThrow('SALE_PRICE_INVALID')
    expect(client.query.mock.calls.some((c) => String(c[0]).startsWith('UPDATE products SET'))).toBe(false)
  })
  it('allows clearing the sale together with a lower price', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...row, sale_price_kopecks: 7500 }] }).mockResolvedValue({ rows: [row] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { updateAdminProduct } = await import('@/lib/admin-products-db')
    await expect(updateAdminProduct(1, { priceKopecks: 5000, sale: null })).resolves.toBeDefined()
    expect(client.query.mock.calls.some((c) => String(c[0]).startsWith('UPDATE products SET') && String(c[0]).includes('sale_price_kopecks = NULL'))).toBe(true)
  })
  it('updates public sort orders atomically only for an exact set, behind the lock', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 1 }] }).mockResolvedValue({ rows: [] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderPublicProducts } = await import('@/lib/admin-products-db'); expect(await reorderPublicProducts([1, 2])).toBe('ok')
    expect(client.query.mock.calls[0][0]).toBe(LOCK)
    expect(client.query).toHaveBeenCalledWith('UPDATE products SET sort_order = $1 WHERE id = $2', [10, 1]); expect(client.query).toHaveBeenCalledWith('UPDATE products SET sort_order = $1 WHERE id = $2', [20, 2])
  })
  it('does not update rows when the public set is stale or duplicate', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderPublicProducts } = await import('@/lib/admin-products-db'); expect(await reorderPublicProducts([1, 1])).toBe('conflict'); expect(client.query).toHaveBeenCalledTimes(2)
  })
})

describe('hard delete with server-side confirmation', () => {
  it('deletes only when confirmationName matches exactly (no trim/case-folding)', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: 'Свеча' }] }).mockResolvedValue({ rows: [] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { deleteAdminProduct } = await import('@/lib/admin-products-db')
    expect(await deleteAdminProduct(1, 'Свеча')).toBe('deleted')
    expect(client.query.mock.calls[0][0]).toBe(LOCK); expect(client.query).toHaveBeenCalledWith('DELETE FROM products WHERE id = $1', [1])
  })
  it('returns name_mismatch and does not delete on inexact name', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: 'Свеча' }] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { deleteAdminProduct } = await import('@/lib/admin-products-db')
    expect(await deleteAdminProduct(1, ' свеча ')).toBe('name_mismatch')
    expect(client.query.mock.calls.some((c) => String(c[0]).startsWith('DELETE'))).toBe(false)
  })
  it('returns not_found for a missing product', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) }; mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { deleteAdminProduct } = await import('@/lib/admin-products-db')
    expect(await deleteAdminProduct(99, 'whatever')).toBe('not_found')
  })
})

describe('product image ordering and deletion', () => {
  it('locks the product row, clears the old cover before assigning a new earlier image, returns the full list', async () => {
    const images = [{ id: 2, filename: 'b', sortOrder: 10, isCover: true }, { id: 1, filename: 'a', sortOrder: 20, isCover: false }]
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: images }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderProductImages } = await import('@/lib/admin-products-db')
    expect(await reorderProductImages(42, [2, 1], 2)).toEqual({ images })
    expect(client.query.mock.calls[0]).toEqual(['SELECT id FROM products WHERE id = $1 FOR UPDATE', [42]])
    expect(client.query.mock.calls[2]).toEqual(['UPDATE product_images SET is_cover = false WHERE product_id = $1 AND is_cover = true', [42]])
    expect(client.query.mock.calls[3]).toEqual(['UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [10, true, 2]])
    expect(client.query.mock.calls[4]).toEqual(['UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [20, false, 1]])
  })
  it('reports conflict without writing when the image set does not match', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { reorderProductImages } = await import('@/lib/admin-products-db')
    expect(await reorderProductImages(42, [1], 1)).toBe('conflict'); expect(client.query).toHaveBeenCalledTimes(2)
  })
  it('promotes the next image to cover after deleting the current cover, under the product-row lock', async () => {
    const images = [{ id: 3, filename: 'c', sortOrder: 10, isCover: true }]
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [{ filename: 'gone.jpg', is_cover: true }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: images }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { deleteProductImage } = await import('@/lib/admin-products-db')
    expect(await deleteProductImage(42, 9)).toEqual({ filename: 'gone.jpg', images })
    expect(client.query.mock.calls[0]).toEqual(['SELECT id FROM products WHERE id = $1 FOR UPDATE', [42]])
    expect(String(client.query.mock.calls[2][0])).toContain('UPDATE product_images SET is_cover = true')
  })
  it('returns null when the image is missing', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [] }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { deleteProductImage } = await import('@/lib/admin-products-db')
    expect(await deleteProductImage(42, 9)).toBeNull()
  })
})
