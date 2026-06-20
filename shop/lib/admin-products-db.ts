import { query, withTransaction } from '@/lib/db'
import { effectivePrice } from '@/lib/pricing'
import type { Visibility } from '@/lib/products'
import type { SaleInput, ValidatedProductInput } from '@/lib/products-admin'

export type AdminImage = { id: number; filename: string; sortOrder: number; isCover: boolean }
export type AdminProduct = {
  id: number; slug: string; name: string; series: string | null; subtitle: string | null; description: string | null
  priceKopecks: number; scent: string[]; inStock: boolean; visibility: Visibility; sale: SaleInput
  isSaleActive: boolean; sortOrder: number; images: AdminImage[]; createdAt: string; updatedAt: string
}
type Row = {
  id: number; slug: string; name: string; series: string | null; subtitle: string | null; description: string | null
  price_kopecks: number | string; scent: string[]; in_stock: boolean; visibility: Visibility
  sale_price_kopecks: number | string | null; sale_starts_at: Date | string | null; sale_ends_at: Date | string | null
  sort_order: number; created_at: Date | string; updated_at: Date | string; images: AdminImage[] | null
}
const SELECT = `SELECT p.id, p.slug, p.name, p.series, p.subtitle, p.description, p.price_kopecks, p.scent, p.in_stock,
  p.visibility, p.sale_price_kopecks, p.sale_starts_at, p.sale_ends_at, p.sort_order, p.created_at, p.updated_at,
  COALESCE(imgs.images, '[]'::json) AS images
  FROM products p LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', id, 'filename', filename, 'sortOrder', sort_order, 'isCover', is_cover) ORDER BY sort_order, id) AS images
    FROM product_images WHERE product_id = p.id
  ) imgs ON true`
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null
export function adminProduct(row: Row, now = new Date()): AdminProduct {
  const sale = row.sale_price_kopecks === null ? null : { priceKopecks: Number(row.sale_price_kopecks), startsAt: iso(row.sale_starts_at), endsAt: iso(row.sale_ends_at) }
  const price = effectivePrice({ priceKopecks: Number(row.price_kopecks), salePriceKopecks: sale?.priceKopecks ?? null, saleStartsAt: sale?.startsAt ?? null, saleEndsAt: sale?.endsAt ?? null }, now)
  return { id: row.id, slug: row.slug, name: row.name, series: row.series, subtitle: row.subtitle, description: row.description,
    priceKopecks: Number(row.price_kopecks), scent: row.scent ?? [], inStock: row.in_stock, visibility: row.visibility, sale,
    isSaleActive: price.isOnSale, sortOrder: row.sort_order, images: row.images ?? [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}
export async function listAdminProducts(visibility: Visibility | 'all' = 'all'): Promise<AdminProduct[]> {
  const now = new Date()
  const suffix = visibility === 'all' ? '' : ' WHERE p.visibility = $1'
  const rows = await query<Row>(`${SELECT}${suffix} ORDER BY p.sort_order, p.id`, visibility === 'all' ? [] : [visibility])
  return rows.map((row) => adminProduct(row, now))
}
export async function getAdminProduct(id: number): Promise<AdminProduct | undefined> {
  const rows = await query<Row>(`${SELECT} WHERE p.id = $1`, [id])
  return rows[0] ? adminProduct(rows[0]) : undefined
}
function fields(input: ValidatedProductInput, create: boolean) {
  const values: unknown[] = []
  const add = (name: string, value: unknown) => { values.push(value); return `${name} = $${values.length}` }
  const parts: string[] = []
  for (const [key, column] of Object.entries({ name: 'name', slug: 'slug', series: 'series', subtitle: 'subtitle', description: 'description', priceKopecks: 'price_kopecks', scent: 'scent', inStock: 'in_stock', visibility: 'visibility' })) {
    const value = input[key as keyof ValidatedProductInput]
    if (value !== undefined) parts.push(add(column, value))
  }
  if (input.sale !== undefined) {
    if (input.sale === null) { parts.push('sale_price_kopecks = NULL', 'sale_starts_at = NULL', 'sale_ends_at = NULL') }
    else { parts.push(add('sale_price_kopecks', input.sale.priceKopecks), add('sale_starts_at', input.sale.startsAt), add('sale_ends_at', input.sale.endsAt)) }
  }
  if (create && input.visibility === undefined) parts.push(add('visibility', 'hidden'))
  if (create && input.inStock === undefined) parts.push(add('in_stock', true))
  if (create && input.scent === undefined) parts.push(add('scent', []))
  return { parts, values }
}
export async function createAdminProduct(input: ValidatedProductInput): Promise<AdminProduct> {
  return withTransaction(async (client) => {
    const { parts, values } = fields(input, true)
    // При публикации сразу ставим в конец публичной очереди.
    if (input.visibility === 'public') parts.push(`sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM products WHERE visibility = 'public')`)
    const insertParts = parts.filter((part) => !part.startsWith('sort_order = ('))
    const columns = insertParts.map((part) => part.split(' = ')[0])
    const placeholders = insertParts.map((part) => part.split(' = ')[1])
    const sortExpression = parts.find((part) => part.startsWith('sort_order = ('))
    if (sortExpression) { columns.push('sort_order'); placeholders.push(sortExpression.split(' = ')[1]) }
    const result = await client.query<{ id: number }>(`INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`, values)
    const details = await client.query<Row>(`${SELECT} WHERE p.id = $1`, [result.rows[0].id])
    const product = details.rows[0] ? adminProduct(details.rows[0]) : undefined
    if (!product) throw new Error('Product was not created')
    return product
  })
}
export async function updateAdminProduct(id: number, input: ValidatedProductInput): Promise<AdminProduct | undefined> {
  return withTransaction(async (client) => {
    const currentResult = await client.query<Row>(`SELECT p.*, '[]'::json AS images FROM products p WHERE p.id = $1 FOR UPDATE`, [id])
    const current = currentResult.rows[0]
    if (!current) return undefined
    if (input.sale && input.sale.priceKopecks >= (input.priceKopecks ?? Number(current.price_kopecks))) throw new Error('SALE_PRICE_INVALID')
    const { parts, values } = fields(input, false)
    if (!parts.length) return adminProduct(current)
    if (input.visibility === 'public' && current.visibility !== 'public') parts.push(`sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM products WHERE visibility = 'public')`)
    values.push(id)
    await client.query(`UPDATE products SET ${parts.join(', ')} WHERE id = $${values.length}`, values)
    const details = await client.query<Row>(`${SELECT} WHERE p.id = $1`, [id])
    const product = details.rows[0] ? adminProduct(details.rows[0]) : undefined
    if (!product) throw new Error('Product disappeared')
    return product
  })
}
export async function deleteAdminProduct(id: number): Promise<boolean> {
  const rows = await query<{ id: number }>('DELETE FROM products WHERE id = $1 RETURNING id', [id])
  return Boolean(rows[0])
}
export async function reorderPublicProducts(ids: number[]): Promise<'ok' | 'conflict'> {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: number }>("SELECT id FROM products WHERE visibility = 'public' ORDER BY id FOR UPDATE")
    const actual = result.rows.map((x) => x.id)
    if (actual.length !== ids.length || new Set(ids).size !== ids.length || [...actual].sort().some((id, i) => id !== [...ids].sort()[i])) return 'conflict'
    for (const [index, id] of ids.entries()) await client.query('UPDATE products SET sort_order = $1 WHERE id = $2', [(index + 1) * 10, id])
    return 'ok'
  })
}
