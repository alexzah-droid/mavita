import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from '@/app/api/products/route'
import { SEED_PRODUCTS } from '@/lib/products'

// Без DATABASE_URL data-слой деградирует на seed — проверяем форму ответа API.
describe('GET /api/products (фоллбэк на seed без БД)', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL
  })

  it('возвращает { products: [...] } с seed-каталогом', async () => {
    const res = await GET()
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    expect(body.products).toHaveLength(SEED_PRODUCTS.length)
    expect(body.products[0].slug).toBe(SEED_PRODUCTS[0].slug)
    expect(Number.isInteger(body.products[0].priceKopecks)).toBe(true)
  })
})
