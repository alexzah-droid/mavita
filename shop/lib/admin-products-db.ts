import type { PoolClient } from 'pg'
import { query, withTransaction } from '@/lib/db'
import { effectivePrice } from '@/lib/pricing'
import type { Visibility } from '@/lib/products'
import type { SaleInput, ValidatedProductInput } from '@/lib/products-admin'

// Единый transaction-scoped advisory lock, сериализующий любые операции, которые
// способны изменить состав или порядок публичной витрины (создание, PATCH,
// reorder, удаление). Человекочитаемое имя ключа — `products:public-order`; в SQL
// передаётся только число. Брать его нужно ПЕРВЫМ запросом транзакции, до чтения
// товара, списка public или вычисления max(sort_order). См.
// docs/specs/admin-products-hardening.md §5.
export const PRODUCTS_PUBLIC_ORDER_LOCK = 7_903_244_111
async function lockPublicOrder(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [PRODUCTS_PUBLIC_ORDER_LOCK])
}

// Все операции с фото (upload, reorder, delete) сериализуются на ОДНОЙ строке
// products через `SELECT … FOR UPDATE`. Без этого гонка delete-последней-обложки
// против upload могла оставить товар с фото и без cover: delete блокирует только
// product_images и читает пустой набор, пока параллельный upload (тоже под этой
// блокировкой) ещё не закоммитил вставку non-cover. `app/api/upload/route.ts`
// берёт ту же блокировку первым запросом своей транзакции.
async function lockProductRow(client: PoolClient, productId: number): Promise<boolean> {
  return (await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [productId])).rows.length > 0
}

// Тестовый barrier-хук: позволяет интеграционному concurrency-тесту удержать
// функцию слоя БД после захвата блокировок (см. test/products-concurrency.integration.test.ts).
// В production не задаётся и является no-op.
type LockBarrier = (op: 'create' | 'update' | 'reorder' | 'delete') => Promise<void>
let lockBarrier: LockBarrier | null = null
export function __setLockBarrier(fn: LockBarrier | null): void { lockBarrier = fn }

/** Результат жёсткого удаления: подтверждение имени проверяется на сервере. */
export type DeleteResult = 'deleted' | 'not_found' | 'name_mismatch'

export type AdminImage = { id: number; filename: string; sortOrder: number; isCover: boolean }
export type AdminProduct = {
  id: number; slug: string; name: string; series: string | null; subtitle: string | null; description: string | null
  priceKopecks: number; scent: string[]; inStock: boolean; visibility: Visibility; sale: SaleInput
  isSaleActive: boolean; sortOrder: number; images: AdminImage[]; createdAt: string; updatedAt: string
  weightGrams: number | null; boxLengthCm: number | null; boxWidthCm: number | null; boxHeightCm: number | null
}
type Row = {
  id: number; slug: string; name: string; series: string | null; subtitle: string | null; description: string | null
  price_kopecks: number | string; scent: string[]; in_stock: boolean; visibility: Visibility
  sale_price_kopecks: number | string | null; sale_starts_at: Date | string | null; sale_ends_at: Date | string | null
  sort_order: number; created_at: Date | string; updated_at: Date | string; images: AdminImage[] | null
  weight_grams: number | null; box_length_cm: number | null; box_width_cm: number | null; box_height_cm: number | null
}
const SELECT = `SELECT p.id, p.slug, p.name, p.series, p.subtitle, p.description, p.price_kopecks, p.scent, p.in_stock,
  p.visibility, p.sale_price_kopecks, p.sale_starts_at, p.sale_ends_at, p.sort_order, p.created_at, p.updated_at,
  p.weight_grams, p.box_length_cm, p.box_width_cm, p.box_height_cm,
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
    isSaleActive: price.isOnSale, sortOrder: row.sort_order, images: row.images ?? [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    weightGrams: row.weight_grams ?? null, boxLengthCm: row.box_length_cm ?? null, boxWidthCm: row.box_width_cm ?? null, boxHeightCm: row.box_height_cm ?? null }
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
  for (const [key, column] of Object.entries({ name: 'name', slug: 'slug', series: 'series', subtitle: 'subtitle', description: 'description', priceKopecks: 'price_kopecks', scent: 'scent', inStock: 'in_stock', visibility: 'visibility', weightGrams: 'weight_grams', boxLengthCm: 'box_length_cm', boxWidthCm: 'box_width_cm', boxHeightCm: 'box_height_cm' })) {
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
    await lockPublicOrder(client)
    if (lockBarrier) await lockBarrier('create')
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
    await lockPublicOrder(client)
    if (lockBarrier) await lockBarrier('update')
    const currentResult = await client.query<Row>(`SELECT p.*, '[]'::json AS images FROM products p WHERE p.id = $1 FOR UPDATE`, [id])
    const current = currentResult.rows[0]
    if (!current) return undefined
    // Зависимое ограничение проверяется по ИТОГОВОМУ состоянию: новая обычная цена
    // (или текущая) против новой скидки (или текущей). Так частичный PATCH цены при
    // уже сохранённой скидке отдаёт контролируемый 400, а не доходит до CHECK.
    const finalPrice = input.priceKopecks ?? Number(current.price_kopecks)
    const finalSale = input.sale === undefined
      ? (current.sale_price_kopecks === null ? null : { priceKopecks: Number(current.sale_price_kopecks) })
      : input.sale
    if (finalSale && finalSale.priceKopecks >= finalPrice) throw new Error('SALE_PRICE_INVALID')
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
// Жёсткое удаление: подтверждение точным текущим именем проверяется на сервере
// (клиентская проверка — только UX). Берёт order-lock до чтения строки, потому что
// удаление public-товара меняет состав витрины. Сравнение `name` — без trim,
// нормализации и case-folding.
export async function deleteAdminProduct(id: number, confirmationName: string): Promise<DeleteResult> {
  return withTransaction(async (client) => {
    await lockPublicOrder(client)
    if (lockBarrier) await lockBarrier('delete')
    const result = await client.query<{ name: string }>('SELECT name FROM products WHERE id = $1 FOR UPDATE', [id])
    const current = result.rows[0]
    if (!current) return 'not_found'
    if (current.name !== confirmationName) return 'name_mismatch'
    await client.query('DELETE FROM products WHERE id = $1', [id])
    return 'deleted'
  })
}
export async function reorderPublicProducts(ids: number[]): Promise<'ok' | 'conflict'> {
  return withTransaction(async (client) => {
    await lockPublicOrder(client)
    const result = await client.query<{ id: number }>("SELECT id FROM products WHERE visibility = 'public' ORDER BY id FOR UPDATE")
    if (lockBarrier) await lockBarrier('reorder')
    const actual = result.rows.map((x) => x.id)
    if (actual.length !== ids.length || new Set(ids).size !== ids.length || [...actual].sort().some((id, i) => id !== [...ids].sort()[i])) return 'conflict'
    for (const [index, id] of ids.entries()) await client.query('UPDATE products SET sort_order = $1 WHERE id = $2', [(index + 1) * 10, id])
    return 'ok'
  })
}
const IMAGE_SELECT = 'SELECT id, filename, sort_order AS "sortOrder", is_cover AS "isCover" FROM product_images WHERE product_id = $1 ORDER BY sort_order, id'
async function imagesOf(client: PoolClient, productId: number): Promise<AdminImage[]> {
  return (await client.query<AdminImage>(IMAGE_SELECT, [productId])).rows
}
// Атомарная перестановка порядка и назначение ровно одной обложки. `orderedImageIds`
// обязан быть полным точным набором фото товара; иначе — 'conflict' без записи.
// Старая обложка снимается ОДНИМ запросом до назначения новой (uq_product_cover
// проверяется на каждом statement, иначе временный дубль и 23505). Возвращает
// полный актуальный список — форма заменяет им локальное состояние (см. §3 спеки).
export async function reorderProductImages(productId: number, orderedImageIds: number[], coverImageId: number): Promise<{ images: AdminImage[] } | 'conflict'> {
  return withTransaction(async (client) => {
    await lockProductRow(client, productId)
    const rows = await client.query<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 FOR UPDATE', [productId])
    const actual = rows.rows.map((x) => x.id).sort((a, b) => a - b)
    const orderedSorted = [...orderedImageIds].sort((a, b) => a - b)
    if (actual.length !== orderedImageIds.length || new Set(orderedImageIds).size !== orderedImageIds.length || !orderedImageIds.includes(coverImageId) || actual.some((imageId, i) => imageId !== orderedSorted[i])) return 'conflict'
    await client.query('UPDATE product_images SET is_cover = false WHERE product_id = $1 AND is_cover = true', [productId])
    for (const [index, imageId] of orderedImageIds.entries()) await client.query('UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [(index + 1) * 10, imageId === coverImageId, imageId])
    return { images: await imagesOf(client, productId) }
  })
}
// Удаляет фото; при удалении текущей обложки назначает следующую по sort_order в той
// же транзакции. Возвращает обновлённый список и имя файла для последующего cleanup.
export async function deleteProductImage(productId: number, imageId: number): Promise<{ filename: string; images: AdminImage[] } | null> {
  return withTransaction(async (client) => {
    await lockProductRow(client, productId)
    const result = await client.query<{ filename: string; is_cover: boolean }>('DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING filename, is_cover', [imageId, productId])
    const image = result.rows[0]
    if (!image) return null
    if (image.is_cover) await client.query('UPDATE product_images SET is_cover = true WHERE id = (SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order, id LIMIT 1)', [productId])
    return { filename: image.filename, images: await imagesOf(client, productId) }
  })
}
