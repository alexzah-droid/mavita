import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { cursorEncode, maskPhone, type AdminOrderFilters, type FulfillmentStatus, type OrderStatus } from '@/lib/admin-orders'
import { enqueueOrderNotification } from '@/lib/telegram-notifications'

export type AdminOrderListItem = { id: number; customerName: string; customerEmail: string; customerPhoneMasked: string | null; totalKopecks: number; status: OrderStatus; fulfillmentStatus: FulfillmentStatus; itemCount: number; createdAt: string }
export type AdminOrderDetail = Omit<AdminOrderListItem, 'customerPhoneMasked'> & { customerPhone: string | null; invId: number | null; itemsKopecks: number; deliveryKopecks: number; deliveryCarrier: 'cdek' | 'ozon' | null; deliveryMethod: 'cdek_pickup' | 'ozon_pickup' | null; pickupPoint: { code: string; city: string; name: string; address: string } | null; trackingNumber: string | null; items: { productName: string; priceKopecks: number; quantity: number }[]; adminEvents: { id: number; eventType: 'cancelled' | 'fulfillment_transition'; reason: string | null; fromFulfillmentStatus: FulfillmentStatus; toFulfillmentStatus: FulfillmentStatus; trackingNumber: string | null; actorLoginAt: number; createdAt: string }[] }

type Row = { id: number; customer_name: string; customer_email: string; customer_phone: string | null; total_kopecks: number | string; status: OrderStatus; fulfillment_status: FulfillmentStatus; item_count: number | string; created_at: Date | string }
function listDto(row: Row): AdminOrderListItem { return { id: row.id, customerName: row.customer_name, customerEmail: row.customer_email, customerPhoneMasked: maskPhone(row.customer_phone), totalKopecks: Number(row.total_kopecks), status: row.status, fulfillmentStatus: row.fulfillment_status, itemCount: Number(row.item_count), createdAt: new Date(row.created_at).toISOString() } }
function msDay(value: string) { return `${value}T00:00:00+03:00` }

export async function listAdminOrders(filters: AdminOrderFilters): Promise<{ orders: AdminOrderListItem[]; nextCursor: string | null }> {
  if (!isDbConfigured()) return { orders: [], nextCursor: null }
  const where: string[] = []; const params: unknown[] = []; const add = (value: unknown) => { params.push(value); return `$${params.length}` }
  if (filters.status !== 'all') where.push(`o.status = ${add(filters.status)}`)
  if (filters.dateFrom) where.push(`o.created_at >= ${add(msDay(filters.dateFrom))}`)
  if (filters.dateTo) { const after = new Date(`${filters.dateTo}T00:00:00+03:00`); after.setUTCDate(after.getUTCDate() + 1); where.push(`o.created_at < ${add(after.toISOString())}`) }
  if (filters.q) {
    if (/^\d+$/.test(filters.q)) {
      const phone = add(`%${filters.q}%`)
      // orders.id — INTEGER. Длинный номер телефона не должен быть приведён к
      // переполняющему integer до передачи в PostgreSQL.
      const numericId = Number(filters.q)
      where.push(Number.isSafeInteger(numericId) && numericId <= 2_147_483_647 ? `(o.id = ${add(numericId)} OR regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') LIKE ${phone})` : `regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') LIKE ${phone}`)
    } else where.push(`(o.customer_name ILIKE ${add(`%${filters.q}%`)} OR o.customer_email ILIKE ${add(`%${filters.q}%`)})`)
  }
  if (filters.cursor) where.push(`(o.created_at, o.id) < (${add(filters.cursor.createdAt)}, ${add(filters.cursor.id)})`)
  const rows = await query<Row>(`SELECT o.id, o.customer_name, o.customer_email, o.customer_phone, o.total_kopecks, o.status, o.fulfillment_status, COALESCE(SUM(oi.quantity), 0) AS item_count, o.created_at FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT ${add(filters.limit + 1)}`, params)
  const hasMore = rows.length > filters.limit; const page = rows.slice(0, filters.limit); const tail = page.at(-1)
  return { orders: page.map(listDto), nextCursor: hasMore && tail ? cursorEncode({ createdAt: new Date(tail.created_at).toISOString(), id: tail.id }) : null }
}

type DetailRow = Row & { inv_id: number | null; items_kopecks: number | string; delivery_kopecks: number | string; delivery_carrier: 'cdek' | 'ozon' | null; delivery_method: 'cdek_pickup' | 'ozon_pickup' | null; pickup_point_code: string | null; pickup_point_city: string | null; pickup_point_name: string | null; pickup_point_address: string | null; tracking_number: string | null }
export async function getAdminOrderById(id: number): Promise<AdminOrderDetail | undefined> {
  if (!isDbConfigured()) return undefined
  const rows = await query<DetailRow>(`SELECT o.*, COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id = o.id), 0) AS item_count FROM orders o WHERE o.id = $1`, [id]); const row = rows[0]; if (!row) return undefined
  const [items, events] = await Promise.all([
    query<{ product_name: string; price_kopecks: number | string; quantity: number }>('SELECT product_name, price_kopecks, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [id]),
    query<{ id: number; event_type: 'cancelled' | 'fulfillment_transition'; reason: string | null; from_fulfillment_status: FulfillmentStatus; to_fulfillment_status: FulfillmentStatus; tracking_number: string | null; actor_login_at: number | string; created_at: Date | string }>('SELECT id, event_type, reason, from_fulfillment_status, to_fulfillment_status, tracking_number, actor_login_at, created_at FROM order_admin_events WHERE order_id = $1 ORDER BY created_at DESC, id DESC', [id]),
  ])
  const base = listDto(row); return { ...base, customerPhone: row.customer_phone, invId: row.inv_id, itemsKopecks: Number(row.items_kopecks), deliveryKopecks: Number(row.delivery_kopecks), deliveryCarrier: row.delivery_carrier, deliveryMethod: row.delivery_method, pickupPoint: row.pickup_point_code && row.pickup_point_city && row.pickup_point_name && row.pickup_point_address ? { code: row.pickup_point_code, city: row.pickup_point_city, name: row.pickup_point_name, address: row.pickup_point_address } : null, trackingNumber: row.tracking_number, items: items.map((item) => ({ productName: item.product_name, priceKopecks: Number(item.price_kopecks), quantity: item.quantity })), adminEvents: events.map((event) => ({ id: event.id, eventType: event.event_type, reason: event.reason, fromFulfillmentStatus: event.from_fulfillment_status, toFulfillmentStatus: event.to_fulfillment_status, trackingNumber: event.tracking_number, actorLoginAt: Number(event.actor_login_at), createdAt: new Date(event.created_at).toISOString() })) }
}

export async function cancelAdminOrder(id: number, reason: string, actorLoginAt: number): Promise<'not_found' | 'not_pending' | AdminOrderDetail> {
  if (!isDbConfigured()) return 'not_found'
  const outcome = await withTransaction(async (client) => {
    const changed = await client.query<{ id: number }>(`UPDATE orders SET status = 'cancelled', fulfillment_status = 'cancelled' WHERE id = $1 AND status = 'pending' AND fulfillment_status = 'awaiting_payment' RETURNING id`, [id])
    if (changed.rows[0]) { await client.query(`INSERT INTO order_admin_events (order_id, event_type, reason, from_fulfillment_status, to_fulfillment_status, actor_login_at) VALUES ($1, 'cancelled', $2, 'awaiting_payment', 'cancelled', $3)`, [id, reason, actorLoginAt]); await enqueueOrderNotification(client, { orderId: id, eventType: 'order_cancelled', eventKey: `order:${id}:cancelled`, reason }); return 'changed' as const }
    const exists = await client.query<{ id: number }>('SELECT id FROM orders WHERE id = $1', [id]); return exists.rows[0] ? 'not_pending' as const : 'not_found' as const
  })
  return outcome === 'changed' ? (await getAdminOrderById(id))! : outcome
}

export async function transitionFulfillment(id: number, next: 'packing' | 'handed_to_carrier' | 'delivered', trackingNumber: string | undefined, actorLoginAt: number): Promise<'not_found' | 'invalid' | AdminOrderDetail> {
  if (!isDbConfigured()) return 'not_found'
  const changed = await withTransaction(async (client) => {
    const current = await client.query<{ status: OrderStatus; fulfillment_status: FulfillmentStatus; tracking_number: string | null }>('SELECT status, fulfillment_status, tracking_number FROM orders WHERE id = $1 FOR UPDATE', [id]); if (!current.rows[0]) return 'not_found' as const
    const order = current.rows[0]; const allowed = (order.fulfillment_status === 'new' && next === 'packing') || (order.fulfillment_status === 'packing' && next === 'handed_to_carrier') || (order.fulfillment_status === 'handed_to_carrier' && next === 'delivered'); if (order.status !== 'paid' || !allowed) return 'invalid' as const
    const nextTracking = next === 'handed_to_carrier' ? trackingNumber : order.fulfillment_status === 'handed_to_carrier' ? order.tracking_number : null
    await client.query('UPDATE orders SET fulfillment_status = $1, tracking_number = $2 WHERE id = $3', [next, nextTracking, id])
    const event = await client.query<{ id: number }>(`INSERT INTO order_admin_events (order_id, event_type, from_fulfillment_status, to_fulfillment_status, tracking_number, actor_login_at) VALUES ($1, 'fulfillment_transition', $2, $3, $4, $5) RETURNING id`, [id, order.fulfillment_status, next, next === 'handed_to_carrier' ? trackingNumber : null, actorLoginAt]); await enqueueOrderNotification(client, { orderId: id, eventType: 'fulfillment_changed', eventKey: `order:${id}:fulfillment:${event.rows[0].id}` }); return 'changed' as const
  })
  return changed === 'changed' ? (await getAdminOrderById(id))! : changed
}
