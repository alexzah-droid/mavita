import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ configured: false, query: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: () => db.configured, query: db.query }))

beforeEach(() => { db.configured = false; db.query.mockReset() })
afterEach(() => { vi.resetModules() })

describe('catalog visibility and seed boundary', () => {
  it('uses seed only without DATABASE_URL', async () => {
    const { getProducts, SEED_PRODUCTS } = await import('@/lib/catalog').then(async (catalog) => ({ ...catalog, ...(await import('@/lib/products')) }))
    expect(await getProducts()).toEqual(SEED_PRODUCTS)
    expect(db.query).not.toHaveBeenCalled()
  })
  it('does not replace an empty configured database with seed', async () => {
    db.configured = true; db.query.mockResolvedValue([])
    const { getProducts, getProductBySlug } = await import('@/lib/catalog')
    expect(await getProducts()).toEqual([])
    expect(await getProductBySlug('seed-slug')).toBeUndefined()
    expect(String(db.query.mock.calls[0][0])).toContain("visibility = 'public'")
    expect(String(db.query.mock.calls[1][0])).toContain("visibility IN ('public', 'unlisted')")
  })
  it('returns CatalogUnavailable instead of seed when configured DB fails', async () => {
    db.configured = true; db.query.mockRejectedValue(new Error('down'))
    const { CatalogUnavailable, getProducts } = await import('@/lib/catalog')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(getProducts()).rejects.toBeInstanceOf(CatalogUnavailable)
    log.mockRestore()
  })
})
