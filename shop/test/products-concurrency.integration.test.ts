import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createTestSchema, delay, type SchemaHandle } from '@/test/integration-db'

// Интеграционный concurrency-тест против реального PostgreSQL (не mock). Проверяет,
// что единый transaction-scoped advisory lock сериализует операции, меняющие состав
// и порядок публичной витрины, и что устаревший reorder получает 409.

let handle: SchemaHandle
let pool: Pool
let db: typeof import('@/lib/db')
let adminDb: typeof import('@/lib/admin-products-db')
let LOCK: number

beforeAll(async () => {
  handle = await createTestSchema()
  process.env.DATABASE_URL = handle.dbUrl
  db = await import('@/lib/db')
  adminDb = await import('@/lib/admin-products-db')
  LOCK = adminDb.PRODUCTS_PUBLIC_ORDER_LOCK
  pool = new Pool({ connectionString: handle.dbUrl })
})
afterAll(async () => { await pool?.end(); await handle?.drop() })
beforeEach(async () => { await db.query('DELETE FROM products') })

async function seed(slug: string, name: string, visibility: string, sortOrder = 0): Promise<number> {
  const rows = await db.query<{ id: number }>('INSERT INTO products (slug, name, price_kopecks, visibility, sort_order) VALUES ($1, $2, 1000, $3, $4) RETURNING id', [slug, name, visibility, sortOrder])
  return rows[0].id
}

function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe('public-order serialization', () => {
  // Тест прогоняет НАСТОЯЩИЕ функции слоя БД (reorderPublicProducts /
  // updateAdminProduct), а не raw SQL: barrier-хук удерживает reorder после захвата
  // блокировок, параллельный updateAdminProduct(publish) блокируется на том же
  // advisory lock. Так регрессия в порядке запросов самих функций ломает тест.
  it('serializes a held reorder against a concurrent publish via the real layer functions', async () => {
    const a = await seed('a', 'A', 'public', 10)
    const b = await seed('b', 'B', 'public', 20)
    const c = await seed('c', 'C', 'hidden')

    const reachedBarrier = deferred()
    const release = deferred()
    adminDb.__setLockBarrier(async (op) => { if (op === 'reorder') { reachedBarrier.resolve(); await release.promise } })
    try {
      const reorderResult = adminDb.reorderPublicProducts([a, b]) // возьмёт lock и зависнет на barrier
      await reachedBarrier.promise

      const publishResult = adminDb.updateAdminProduct(c, { visibility: 'public' }) // блокируется на advisory lock
      await delay(150)
      const stillHidden = await db.query<{ visibility: string }>('SELECT visibility FROM products WHERE id = $1', [c])
      expect(stillHidden[0].visibility).toBe('hidden') // публикация ждёт reorder

      release.resolve()
      expect(await reorderResult).toBe('ok')
      await publishResult
    } finally { adminDb.__setLockBarrier(null) }

    const after = await db.query<{ id: number; sort_order: number }>("SELECT id, sort_order FROM products WHERE visibility = 'public' ORDER BY sort_order")
    expect(after.map((r) => r.id)).toEqual([a, b, c])
    expect(Number(after.find((r) => r.id === c)?.sort_order)).toBe(30) // C опубликован ПОСЛЕ reorder

    // Повторный reorder со старым набором {A,B} теперь не совпадает с {A,B,C}.
    expect(await adminDb.reorderPublicProducts([a, b])).toBe('conflict')
    expect(await adminDb.reorderPublicProducts([a, b, c])).toBe('ok')
  })

  it('serializes concurrent photo upload and delete on the same product row (cover invariant)', async () => {
    const p = await seed('p', 'P', 'public', 10)
    const img = await db.query<{ id: number }>("INSERT INTO product_images (product_id, filename, sort_order, is_cover) VALUES ($1, '/uploads/products/x.webp', 10, true) RETURNING id", [p])
    // Параллельно: удаляем единственную (cover) фотографию и вставляем новую,
    // каждая операция под FOR UPDATE строки товара → выполняются последовательно.
    const insertOne = (async () => {
      await db.withTransaction(async (client) => {
        await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [p])
        const count = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM product_images WHERE product_id = $1', [p])
        await client.query('INSERT INTO product_images (product_id, filename, sort_order, is_cover) VALUES ($1, $2, $3, $4)', [p, '/uploads/products/y.webp', 20, Number(count.rows[0].count) === 0])
      })
    })()
    await Promise.all([adminDb.deleteProductImage(p, img[0].id), insertOne])
    const images = await db.query<{ is_cover: boolean }>('SELECT is_cover FROM product_images WHERE product_id = $1', [p])
    expect(images.length).toBeGreaterThan(0)
    expect(images.filter((i) => i.is_cover).length).toBe(1) // ровно одна обложка
  })

  it('hard-deletes a public product through the same protocol only with the exact name', async () => {
    const d = await seed('d', 'D', 'public', 10)
    expect(await adminDb.deleteAdminProduct(d, ' d ')).toBe('name_mismatch')
    expect((await db.query('SELECT 1 FROM products WHERE id = $1', [d])).length).toBe(1)
    expect(await adminDb.deleteAdminProduct(d, 'D')).toBe('deleted')
    expect((await db.query('SELECT 1 FROM products WHERE id = $1', [d])).length).toBe(0)
  })

  it('rejects a partial price PATCH below the stored sale without mutating the row', async () => {
    const rows = await db.query<{ id: number }>("INSERT INTO products (slug, name, price_kopecks, visibility, sale_price_kopecks) VALUES ('e', 'E', 10000, 'public', 7500) RETURNING id", [])
    const id = rows[0].id
    await expect(adminDb.updateAdminProduct(id, { priceKopecks: 5000 })).rejects.toThrow('SALE_PRICE_INVALID')
    const unchanged = await db.query<{ price_kopecks: number }>('SELECT price_kopecks FROM products WHERE id = $1', [id])
    expect(Number(unchanged[0].price_kopecks)).toBe(10000)
  })
})
