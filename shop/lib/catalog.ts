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

export class CatalogUnavailable extends Error {
  constructor(cause?: unknown) { super('Catalog is temporarily unavailable'); this.name = 'CatalogUnavailable'; this.cause = cause }
}

const SELECT_PRODUCT = `
  SELECT
    p.slug, p.name, p.series, p.subtitle, p.description,
    p.price_kopecks, p.scent, p.in_stock, p.visibility,
    p.sale_price_kopecks, p.sale_starts_at, p.sale_ends_at,
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

/** Весь публичный каталог. Seed допускается только без настроенной БД. */
export async function getProducts(): Promise<Product[]> {
  if (!isDbConfigured()) return SEED_PRODUCTS
  try {
    const rows = await query<ProductRow>(
      `${SELECT_PRODUCT} WHERE p.visibility = 'public' ORDER BY p.sort_order, p.id`,
    )
    return rows.map(mapRowToProduct)
  } catch (err) {
    console.error('[catalog] getProducts failed:', err)
    throw new CatalogUnavailable(err)
  }
}

/** Публичный или доступный по прямой ссылке товар. */
export async function getProductBySlug(
  slug: string,
): Promise<Product | undefined> {
  if (!isDbConfigured()) return getSeedProduct(slug)
  try {
    const rows = await query<ProductRow>(
      `${SELECT_PRODUCT} WHERE p.slug = $1 AND p.visibility IN ('public', 'unlisted') LIMIT 1`,
      [slug],
    )
    return rows.length ? mapRowToProduct(rows[0]) : undefined
  } catch (err) {
    console.error('[catalog] getProductBySlug failed:', err)
    throw new CatalogUnavailable(err)
  }
}
