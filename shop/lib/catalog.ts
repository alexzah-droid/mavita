// Серверный data-слой каталога: запросы к БД с graceful-фоллбэком на seed.
// Импортирует pg (через lib/db) — использовать ТОЛЬКО из серверных компонентов и API.

import { isDbConfigured, query } from '@/lib/db'
import {
  mapRowToProduct,
  SEED_PRODUCTS,
  getSeedProduct,
  type Product,
  type ProductRow,
} from '@/lib/products'

const SELECT_PRODUCT = `
  SELECT
    p.slug, p.name, p.series, p.subtitle, p.description,
    p.price_kopecks, p.scent, p.in_stock,
    cover.filename AS cover,
    COALESCE(imgs.filenames, '{}') AS images
  FROM products p
  LEFT JOIN LATERAL (
    SELECT filename FROM product_images
    WHERE product_id = p.id
    ORDER BY is_cover DESC, sort_order, id
    LIMIT 1
  ) cover ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(filename ORDER BY sort_order, id) AS filenames
    FROM product_images
    WHERE product_id = p.id
  ) imgs ON true
`

/** Весь каталог. При недоступной БД — seed (для локальной разработки/сборки). */
export async function getProducts(): Promise<Product[]> {
  if (!isDbConfigured()) return SEED_PRODUCTS
  try {
    const rows = await query<ProductRow>(
      `${SELECT_PRODUCT} ORDER BY p.sort_order, p.id`,
    )
    return rows.length ? rows.map(mapRowToProduct) : SEED_PRODUCTS
  } catch (err) {
    console.error('[catalog] getProducts failed, falling back to seed:', err)
    return SEED_PRODUCTS
  }
}

/** Один товар по slug. При недоступной БД — seed. */
export async function getProductBySlug(
  slug: string,
): Promise<Product | undefined> {
  if (!isDbConfigured()) return getSeedProduct(slug)
  try {
    const rows = await query<ProductRow>(
      `${SELECT_PRODUCT} WHERE p.slug = $1 LIMIT 1`,
      [slug],
    )
    return rows.length ? mapRowToProduct(rows[0]) : getSeedProduct(slug)
  } catch (err) {
    console.error('[catalog] getProductBySlug failed, falling back to seed:', err)
    return getSeedProduct(slug)
  }
}
