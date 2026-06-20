// Заказы: чистая валидация/сборка позиций (тестируется юнитами) + персист в БД.
// Цена и название берутся из КАТАЛОГА (БД), а не от клиента — это snapshot на момент
// покупки и защита от подмены цены на клиенте. Суммы в копейках (I2).

import { randomUUID } from 'node:crypto'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { effectivePrice } from '@/lib/pricing'
import type { Visibility } from '@/lib/products'
import { getPickupPoint } from '@/lib/cdek'

export type OrderInput = {
  customerName: string
  customerEmail: string
  customerPhone: string
  delivery: { method: 'cdek_pickup'; pickupPointCode: string; expectedDeliveryKopecks: number }
  expectedTotalKopecks: number
  items: { slug: string; quantity: number }[]
}

export type CatalogItem = {
  id: number
  slug: string
  name: string
  priceKopecks: number
  inStock: boolean
  visibility: Visibility
  salePriceKopecks: number | null
  saleStartsAt: string | null
  saleEndsAt: string | null
}

export type OrderLine = {
  productId: number
  slug: string
  productName: string
  priceKopecks: number
  quantity: number
}

export type Order = {
  id: number
  customerName: string
  customerEmail: string
  customerPhone: string | null
  totalKopecks: number
  status: string
  createdAt: string
  items: { productName: string; priceKopecks: number; quantity: number }[]
}

export type ValidationResult = { ok: boolean; errors: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_QTY = 99

/** Ошибка с пользовательскими сообщениями — API превращает её в 400. */
export class OrderValidationError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'OrderValidationError'
    this.errors = errors
  }
}
export class PriceChangedError extends Error {
  constructor(public amounts: { itemsKopecks: number; deliveryKopecks: number; totalKopecks: number }) { super('PRICE_CHANGED'); this.name = 'PriceChangedError' }
}
export class DeliveryUnavailableError extends Error { constructor() { super('Оформление временно недоступно'); this.name = 'DeliveryUnavailableError' } }

function normalizePhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, ''); if (digits.length !== 11 || !/^[78]/.test(digits)) return undefined
  return `+7${digits.slice(1)}`
}

/** Чистая валидация формы заказа (без обращения к БД). */
export function validateOrderInput(input: OrderInput): ValidationResult {
  const errors: string[] = []
  if (!input.customerName?.trim()) errors.push('Укажите ФИО получателя')
  const email = input.customerEmail?.trim() ?? ''
  if (!email || !EMAIL_RE.test(email)) errors.push('Укажите корректный email')
  if (!normalizePhone(input.customerPhone ?? '')) errors.push('Укажите корректный телефон получателя')
  if (input.delivery?.method !== 'cdek_pickup' || !input.delivery.pickupPointCode?.trim()) errors.push('Выберите пункт выдачи СДЭК')
  if (!Number.isSafeInteger(input.delivery?.expectedDeliveryKopecks) || input.delivery.expectedDeliveryKopecks < 0 || !Number.isSafeInteger(input.expectedTotalKopecks) || input.expectedTotalKopecks < 0) errors.push('Некорректная сумма заказа')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push('Корзина пуста')
  } else {
    for (const it of input.items) {
      if (!it.slug || typeof it.slug !== 'string') {
        errors.push('Некорректная позиция в корзине')
        break
      }
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QTY) {
        errors.push(`Некорректное количество для «${it.slug}»`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Чистая сборка позиций заказа из авторитетного каталога. Возвращает позиции
 * со snapshot названия/цены, итоговую сумму и список ошибок (товар не найден / нет в наличии).
 */
export function buildOrderLines(
  catalog: Map<string, CatalogItem>,
  items: { slug: string; quantity: number }[],
  now = new Date(),
): { lines: OrderLine[]; totalKopecks: number; errors: string[] } {
  const errors: string[] = []
  // Дубли одного slug схлопываются в одну позицию (TD-10): иначе в заказе было бы
  // два order_items на тот же товар. Порядок первого появления сохраняется.
  const byslug = new Map<string, OrderLine>()
  for (const it of items) {
    const product = catalog.get(it.slug)
    if (!product) {
      errors.push(`Товар «${it.slug}» не найден`)
      continue
    }
    if (!product.inStock) {
      errors.push(`«${product.name}» нет в наличии`)
      continue
    }
    if (product.visibility === 'hidden') {
      errors.push(`«${product.name}» недоступен`)
      continue
    }
    const price = effectivePrice(product, now).kopecks
    const existing = byslug.get(product.slug)
    if (existing) {
      existing.quantity += it.quantity
    } else {
      byslug.set(product.slug, {
        productId: product.id,
        slug: product.slug,
        productName: product.name,
        priceKopecks: price,
        quantity: it.quantity,
      })
    }
  }
  const lines = [...byslug.values()]
  const totalKopecks = lines.reduce((s, l) => s + l.priceKopecks * l.quantity, 0)
  return { lines, totalKopecks, errors }
}

type CatalogRow = {
  id: number
  slug: string
  name: string
  price_kopecks: number | string
  in_stock: boolean
  visibility: Visibility
  sale_price_kopecks: number | string | null
  sale_starts_at: Date | string | null
  sale_ends_at: Date | string | null
}

function toIso(value: Date | string | null): string | null { return value ? new Date(value).toISOString() : null }
async function fetchCatalog(client: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }, slugs: string[]): Promise<Map<string, CatalogItem>> {
  const result = await client.query<CatalogRow>(
    `SELECT id, slug, name, price_kopecks, in_stock, visibility, sale_price_kopecks, sale_starts_at, sale_ends_at
     FROM products WHERE slug = ANY($1) FOR SHARE`,
    [slugs],
  )
  const map = new Map<string, CatalogItem>()
  for (const r of result.rows) {
    map.set(r.slug, {
      id: r.id,
      slug: r.slug,
      name: r.name,
      priceKopecks: Number(r.price_kopecks),
      inStock: r.in_stock,
      visibility: r.visibility,
      salePriceKopecks: r.sale_price_kopecks == null ? null : Number(r.sale_price_kopecks),
      saleStartsAt: toIso(r.sale_starts_at),
      saleEndsAt: toIso(r.sale_ends_at),
    })
  }
  return map
}

/** Создать заказ (status=pending) + позиции атомарно. token — неугадываемый id для URL. */
export async function createOrder(
  input: OrderInput,
): Promise<{ id: number; token: string; totalKopecks: number; itemsKopecks: number; deliveryKopecks: number; lines: OrderLine[] }> {
  if (!isDbConfigured()) {
    throw new Error('DATABASE_URL is not set — orders require a database')
  }

  const validation = validateOrderInput(input)
  if (!validation.ok) throw new OrderValidationError(validation.errors)

  // Snapshot точки берём повторно на сервере: клиентский callback нельзя считать авторитетным.
  const pickupPoint = await getPickupPoint(input.delivery.pickupPointCode.trim())

  const token = randomUUID()
  const result = await withTransaction(async (client) => {
    const catalog = await fetchCatalog(client, input.items.map((i) => i.slug))
    const { lines, totalKopecks: itemsKopecks, errors } = buildOrderLines(catalog, input.items, new Date())
    if (errors.length) throw new OrderValidationError(errors)
    if (!lines.length) throw new OrderValidationError(['Корзина пуста'])
    const settings = await client.query<{ cdek_pickup_delivery_kopecks: number | string }>('SELECT cdek_pickup_delivery_kopecks FROM store_settings WHERE singleton = true FOR SHARE')
    if (!settings.rows[0]) throw new DeliveryUnavailableError()
    const deliveryKopecks = Number(settings.rows[0].cdek_pickup_delivery_kopecks); const totalKopecks = itemsKopecks + deliveryKopecks
    if (input.delivery.expectedDeliveryKopecks !== deliveryKopecks || input.expectedTotalKopecks !== totalKopecks) throw new PriceChangedError({ itemsKopecks, deliveryKopecks, totalKopecks })
    const orderRes = await client.query<{ id: number }>(
      `INSERT INTO orders (token, customer_name, customer_email, customer_phone, total_kopecks, items_kopecks, delivery_kopecks, delivery_method, delivery_carrier, pickup_point_code, pickup_point_city, pickup_point_name, pickup_point_address, fulfillment_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cdek_pickup', 'cdek', $8, $9, $10, $11, 'awaiting_payment', 'pending')
       RETURNING id`,
      [
        token,
        input.customerName.trim(),
        input.customerEmail.trim(),
        normalizePhone(input.customerPhone)!,
        totalKopecks,
        itemsKopecks,
        deliveryKopecks,
        pickupPoint.code,
        pickupPoint.city,
        pickupPoint.name,
        pickupPoint.address,
      ],
    )
    const orderId = orderRes.rows[0].id

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, price_kopecks, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, line.productId, line.productName, line.priceKopecks, line.quantity],
      )
    }
    return { id: orderId, totalKopecks, itemsKopecks, deliveryKopecks, lines }
  })

  return { ...result, token }
}

export type MarkPaidResult =
  | 'paid' // переведён pending → paid
  | 'already_paid' // уже был оплачен (идемпотентный повтор колбэка)
  | 'not_found' // заказа с таким InvId нет
  | 'amount_mismatch' // сумма от Робокассы не совпала с заказом
  | 'cancelled' // заказ отменён — деньги пришли, нужен ручной разбор

/**
 * Пометить заказ оплаченным. Меняет статус только если заказ pending И сумма
 * (в копейках) совпадает с total_kopecks заказа — защита от недоплаты/рассинхрона.
 * Идемпотентно: повторный колбэк по уже оплаченному заказу — 'already_paid'.
 *
 * Об успехе судим по числу реально обновлённых строк (RETURNING), а не по факту
 * «дошли до UPDATE»: иначе при гонке двух колбэков оба вернули бы 'paid' (TD-18),
 * а оплата отменённого заказа молча терялась бы — Робокасса получила бы OK и
 * прекратила ретраи, хотя статус не сменился (TD-17).
 */
export async function markOrderPaid(
  invId: number,
  paidKopecks: number,
  robokassaData: Record<string, string>,
): Promise<MarkPaidResult> {
  if (!isDbConfigured()) return 'not_found'

  return withTransaction(async (client) => {
    const selected = await client.query<{ status: string; fulfillment_status: string; total_kopecks: number | string }>('SELECT status, fulfillment_status, total_kopecks FROM orders WHERE id = $1 FOR UPDATE', [invId])
    const order = selected.rows[0]; if (!order) return 'not_found'
    if (order.status === 'paid') return 'already_paid'; if (order.status === 'cancelled') return 'cancelled'; if (Number(order.total_kopecks) !== paidKopecks) return 'amount_mismatch'
    const updated = await client.query<{ id: number }>(`UPDATE orders SET status = 'paid', fulfillment_status = 'new', robokassa_data = $1 WHERE id = $2 AND status = 'pending' AND fulfillment_status = 'awaiting_payment' RETURNING id`, [JSON.stringify(robokassaData), invId])
    return updated.rows.length ? 'paid' : 'not_found'
  })
}

/** token заказа по InvId (= id) — для редиректов success/fail на /order/<token>. */
export async function getOrderTokenByInvId(invId: number): Promise<string | undefined> {
  if (!isDbConfigured() || !Number.isInteger(invId)) return undefined
  const rows = await query<{ token: string }>(
    `SELECT token FROM orders WHERE id = $1`,
    [invId],
  )
  return rows[0]?.token
}

type OrderRow = {
  id: number
  customer_name: string
  customer_email: string
  customer_phone: string | null
  total_kopecks: number | string
  status: string
  created_at: string
}
type OrderItemRow = {
  product_name: string
  price_kopecks: number | string
  quantity: number
}

/**
 * Получить заказ с позициями по неугадываемому token (не по серийному id) —
 * иначе чужие заказы и PII перебирались бы по /order/1, /order/2…
 * undefined, если не найден или БД недоступна.
 */
export async function getOrderByToken(token: string): Promise<Order | undefined> {
  if (!isDbConfigured() || !token) return undefined
  const orders = await query<OrderRow>(
    `SELECT id, customer_name, customer_email, customer_phone, total_kopecks, status, created_at
     FROM orders WHERE token = $1`,
    [token],
  )
  if (!orders.length) return undefined
  const o = orders[0]
  const items = await query<OrderItemRow>(
    `SELECT product_name, price_kopecks, quantity FROM order_items WHERE order_id = $1 ORDER BY id`,
    [o.id],
  )
  return {
    id: o.id,
    customerName: o.customer_name,
    customerEmail: o.customer_email,
    customerPhone: o.customer_phone,
    totalKopecks: Number(o.total_kopecks),
    status: o.status,
    createdAt: o.created_at,
    items: items.map((it) => ({
      productName: it.product_name,
      priceKopecks: Number(it.price_kopecks),
      quantity: it.quantity,
    })),
  }
}
