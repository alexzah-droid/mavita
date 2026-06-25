// Создание отправления СДЭК и получение PDF-накладной.
// Credentials и настройки приходят явно — модуль не читает БД сам.
// OAuth-токен берётся через accessToken из lib/cdek.ts (кэш по fingerprint).
import { query, withTransaction } from '@/lib/db'
import type { DeliveryCredentials } from '@/lib/delivery/types'
import { CdekValidationError } from '@/lib/cdek'
import { sendOpsAlert } from '@/lib/ops-alert'

// Экспортируем accessToken через реэкспорт, чтобы outbox не импортировал весь cdek.ts
export { CdekValidationError }

function baseUrl() {
  return (process.env.CDEK_API_BASE || 'https://api.cdek.ru/v2').replace(/\/$/, '')
}

async function getToken(creds: DeliveryCredentials): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.secret,
  })
  let response: Response
  try {
    response = await fetch(`${baseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new CdekValidationError('СДЭК недоступен', true)
  }
  const data = await response.json().catch(() => null) as { access_token?: string } | null
  if (!response.ok || !data?.access_token) throw new CdekValidationError('СДЭК недоступен', true, response.status === 401 || response.status === 403)
  return data.access_token
}

// Один кэш токена на процесс (аналог lib/cdek.ts), ключ — fingerprint credentials.
let tokenCache: { token: string; expiresAt: number; fingerprint: string } | undefined

async function accessToken(creds: DeliveryCredentials): Promise<string> {
  const fp = creds.fingerprint ?? `${creds.clientId}:${creds.secret}`
  if (tokenCache && tokenCache.fingerprint === fp && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token
  const token = await getToken(creds)
  tokenCache = { token, expiresAt: Date.now() + 3600_000, fingerprint: fp }
  return token
}

async function cdekPost(creds: DeliveryCredentials, path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await accessToken(creds)
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new CdekValidationError('СДЭК недоступен', true)
  }
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) }
}

async function cdekGet(creds: DeliveryCredentials, path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await accessToken(creds)
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new CdekValidationError('СДЭК недоступен', true)
  }
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) }
}

export type ShipmentSettings = {
  shipmentPoint: string
  senderName: string
  senderPhone: string
  defaultWeightGrams: number
  defaultLengthCm: number
  defaultWidthCm: number
  defaultHeightCm: number
  multiLengthCm: number
  multiWidthCm: number
  multiHeightCm: number
}

type OrderForShipment = {
  id: number
  customerName: string
  customerPhone: string | null
  pickupPointCode: string
  deliveryKopecks: number
  items: {
    productId: number
    productName: string
    priceKopecks: number
    quantity: number
    weightGrams: number | null
    boxLengthCm: number | null
    boxWidthCm: number | null
    boxHeightCm: number | null
  }[]
}

function calcPackage(order: OrderForShipment, settings: ShipmentSettings) {
  const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0)
  const weightGrams = order.items.reduce((s, i) => s + (i.weightGrams ?? settings.defaultWeightGrams) * i.quantity, 0)

  let lengthCm: number, widthCm: number, heightCm: number
  if (totalUnits === 1 && order.items[0]) {
    const item = order.items[0]
    const allDims = item.boxLengthCm !== null && item.boxWidthCm !== null && item.boxHeightCm !== null
    lengthCm = allDims ? item.boxLengthCm! : settings.defaultLengthCm
    widthCm  = allDims ? item.boxWidthCm!  : settings.defaultWidthCm
    heightCm = allDims ? item.boxHeightCm! : settings.defaultHeightCm
  } else {
    lengthCm = settings.multiLengthCm
    widthCm  = settings.multiWidthCm
    heightCm = settings.multiHeightCm
  }

  return { weightGrams, lengthCm, widthCm, heightCm }
}

type CreateResult =
  | { ok: true; uuid: string }
  | { ok: false; retryable: boolean; error: string }

export async function createShipment(
  order: OrderForShipment,
  creds: DeliveryCredentials,
  settings: ShipmentSettings,
): Promise<CreateResult> {
  if (!order.customerPhone) {
    return { ok: false, retryable: false, error: 'Телефон получателя не указан — необходим для создания отправления СДЭК' }
  }
  const pkg = calcPackage(order, settings)

  const body = {
    type: 1,
    tariff_code: 136,
    number: `MAVITA-${order.id}`,
    comment: `Заказ #${order.id}`,
    shipment_point: settings.shipmentPoint,
    delivery_point: order.pickupPointCode,
    sender: {
      name: settings.senderName,
      phones: [{ number: settings.senderPhone }],
    },
    recipient: {
      name: order.customerName,
      phones: [{ number: order.customerPhone! }],
    },
    delivery_recipient_cost: { value: 0 },
    packages: [{
      number: '1',
      weight: pkg.weightGrams,
      length: pkg.lengthCm,
      width: pkg.widthCm,
      height: pkg.heightCm,
      items: order.items.map((item) => ({
        name: item.productName,
        ware_key: String(item.productId),
        payment: { value: 0 },
        cost: item.priceKopecks / 100,
        weight: (item.weightGrams ?? settings.defaultWeightGrams),
        amount: item.quantity,
      })),
    }],
  }

  let result: { ok: boolean; status: number; data: unknown }
  try {
    result = await cdekPost(creds, '/orders', body)
  } catch (err) {
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : 'Сетевая ошибка' }
  }

  const data = result.data as Record<string, unknown> | null

  if (result.ok) {
    const entity = data?.entity as Record<string, unknown> | undefined
    const uuid = typeof entity?.uuid === 'string' ? entity.uuid : undefined
    if (!uuid) return { ok: false, retryable: false, error: 'СДЭК вернул OK без uuid' }
    return { ok: true, uuid }
  }

  // 400 — возможно, отправление уже существует с таким number; пробуем recovery.
  if (result.status === 400) {
    const recovery = await recoverExistingShipment(order.id, creds)
    if (recovery) return { ok: true, uuid: recovery }
    const errText = formatCdekErrors(data)
    return { ok: false, retryable: false, error: errText }
  }

  return { ok: false, retryable: true, error: `СДЭК HTTP ${result.status}` }
}

async function recoverExistingShipment(orderId: number, creds: DeliveryCredentials): Promise<string | null> {
  try {
    const res = await cdekGet(creds, `/orders?im_number=MAVITA-${orderId}`)
    if (!res.ok) return null
    const data = res.data as Record<string, unknown> | null
    const entity = data?.entity as Record<string, unknown> | undefined
    const uuid = typeof entity?.uuid === 'string' ? entity.uuid : undefined
    return uuid ?? null
  } catch {
    return null
  }
}

function formatCdekErrors(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Неизвестная ошибка СДЭК'
  const d = data as Record<string, unknown>
  const requests = Array.isArray(d.requests) ? d.requests : []
  const errors = (requests[0] as Record<string, unknown> | undefined)?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as Record<string, unknown>
    return `${first.code ?? ''}: ${first.message ?? ''}`.trim() || 'Ошибка СДЭК'
  }
  return JSON.stringify(data).slice(0, 300)
}

// ── Накладная (PDF) ──────────────────────────────────────────────────────────

type WaybillResult =
  | { ok: true; waybillUrl: string; barcodeUrl: string | null }
  | { ok: false; pending: boolean; error?: string }

async function requestPrint(
  orderUuid: string,
  creds: DeliveryCredentials,
  type: 'waybill' | 'barcode',
): Promise<string | null> {
  try {
    const printRes = await cdekPost(creds, '/print/orders', { orders: [{ order_uuid: orderUuid }], type })
    if (!printRes.ok) return null
    const printData = printRes.data as Record<string, unknown> | null
    const taskUuid = (printData?.entity as Record<string, unknown> | undefined)?.uuid
    if (typeof taskUuid !== 'string') return null

    const taskRes = await cdekGet(creds, `/print/orders/${taskUuid}`)
    if (!taskRes.ok) return null
    const taskData = taskRes.data as Record<string, unknown> | null
    const taskState = (taskData?.entity as Record<string, unknown> | undefined)?.status
    if (taskState !== 'SUCCESSFUL') return null

    const url = (taskData?.entity as Record<string, unknown> | undefined)?.url
    return typeof url === 'string' ? url : null
  } catch {
    return null
  }
}

export async function pollWaybill(
  orderUuid: string,
  creds: DeliveryCredentials,
): Promise<WaybillResult> {
  // 1. Проверить state заказа в СДЭК
  let res: { ok: boolean; status: number; data: unknown }
  try {
    res = await cdekGet(creds, `/orders/${orderUuid}`)
  } catch (err) {
    return { ok: false, pending: true, error: err instanceof Error ? err.message : 'Сетевая ошибка' }
  }

  if (!res.ok) return { ok: false, pending: true, error: `GET /orders HTTP ${res.status}` }

  const orderData = res.data as Record<string, unknown> | null
  const requests = Array.isArray(orderData?.requests) ? orderData!.requests : []
  const state = (requests[0] as Record<string, unknown> | undefined)?.state
  if (state !== 'SUCCESSFUL') return { ok: false, pending: true }

  // 2. Запросить накладную и штрихкод параллельно
  const [waybillUrl, barcodeUrl] = await Promise.all([
    requestPrint(orderUuid, creds, 'waybill'),
    requestPrint(orderUuid, creds, 'barcode'),
  ])

  if (!waybillUrl) return { ok: false, pending: true, error: 'Накладная ещё не готова в СДЭК' }

  return { ok: true, waybillUrl, barcodeUrl }
}

async function cdekDelete(creds: DeliveryCredentials, path: string): Promise<{ ok: boolean; status: number }> {
  const token = await accessToken(creds)
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new CdekValidationError('СДЭК недоступен', true)
  }
  return { ok: response.ok, status: response.status }
}

// ── Вебхук регистрация ────────────────────────────────────────────────────────

export async function registerWebhook(
  creds: DeliveryCredentials,
  webhookUrl: string,
): Promise<{ ok: true; uuid: string } | { ok: false; error: string }> {
  try {
    const result = await cdekPost(creds, '/webhooks', { url: webhookUrl, type: 'ORDER_STATUS' })
    if (!result.ok) return { ok: false, error: `СДЭК HTTP ${result.status}` }
    const data = result.data as Record<string, unknown> | null
    const entity = data?.entity as Record<string, unknown> | undefined
    const uuid = typeof entity?.uuid === 'string' ? entity.uuid : null
    if (!uuid) return { ok: false, error: 'СДЭК не вернул uuid вебхука' }
    return { ok: true, uuid }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Ошибка регистрации вебхука' }
  }
}

export async function unregisterWebhook(
  creds: DeliveryCredentials,
  uuid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await cdekDelete(creds, `/webhooks/${uuid}`)
    if (!result.ok && result.status !== 404) return { ok: false, error: `СДЭК HTTP ${result.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Ошибка удаления вебхука' }
  }
}

// ── Обновление протухших URL накладной и штрихкода ───────────────────────────

export async function refreshWaybillUrls(
  orderUuid: string,
  creds: DeliveryCredentials,
): Promise<{ waybillUrl: string | null; barcodeUrl: string | null }> {
  const [waybillUrl, barcodeUrl] = await Promise.all([
    requestPrint(orderUuid, creds, 'waybill'),
    requestPrint(orderUuid, creds, 'barcode'),
  ])
  return { waybillUrl, barcodeUrl }
}

// ── Загрузка заказа из БД для createShipment ────────────────────────────────

type OrderRow = {
  id: number
  customer_name: string
  customer_phone: string
  pickup_point_code: string
  delivery_kopecks: number | string
}
type ItemRow = {
  product_id: number
  product_name: string
  price_kopecks: number | string
  quantity: number
  weight_grams: number | null
  box_length_cm: number | null
  box_width_cm: number | null
  box_height_cm: number | null
}

export async function loadOrderForShipment(orderId: number): Promise<OrderForShipment | null> {
  const rows = await query<OrderRow>(
    `SELECT id, customer_name, customer_phone, pickup_point_code, delivery_kopecks
     FROM orders WHERE id = $1 AND status = 'paid' AND delivery_method = 'cdek_pickup'`,
    [orderId],
  )
  const order = rows[0]
  if (!order) return null

  const items = await query<ItemRow>(
    `SELECT oi.product_id, oi.product_name, oi.price_kopecks, oi.quantity,
            p.weight_grams, p.box_length_cm, p.box_width_cm, p.box_height_cm
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.id`,
    [orderId],
  )

  return {
    id: order.id,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    pickupPointCode: order.pickup_point_code,
    deliveryKopecks: Number(order.delivery_kopecks),
    items: items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      priceKopecks: Number(item.price_kopecks),
      quantity: item.quantity,
      weightGrams: item.weight_grams,
      boxLengthCm: item.box_length_cm,
      boxWidthCm: item.box_width_cm,
      boxHeightCm: item.box_height_cm,
    })),
  }
}

// ── Retry-кнопка из админки ──────────────────────────────────────────────────

export async function requeueShipment(orderId: number): Promise<'ok' | 'not_found' | 'already_created'> {
  const rows = await query<{ cdek_order_uuid: string | null }>(
    'SELECT cdek_order_uuid FROM orders WHERE id = $1',
    [orderId],
  )
  if (!rows[0]) return 'not_found'
  if (rows[0].cdek_order_uuid) return 'already_created'

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE cdek_task_outbox SET status = 'pending', attempt_count = 0, locked_at = NULL,
          available_at = now(), last_error = NULL
       WHERE order_id = $1 AND task_type = 'create_shipment' AND status = 'failed'`,
      [orderId],
    )
    await client.query(
      `INSERT INTO cdek_task_outbox (order_id, task_type, event_key)
       VALUES ($1, 'create_shipment', $2)
       ON CONFLICT (event_key) DO NOTHING`,
      [orderId, `create_shipment:${orderId}`],
    )
    await client.query(
      `UPDATE orders SET cdek_error = NULL WHERE id = $1`,
      [orderId],
    )
  })
  return 'ok'
}

export { sendOpsAlert }
