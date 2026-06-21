import type { PoolClient } from 'pg'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { formatRub } from '@/lib/price'
import { getTelegramDeliveryCredentials, recordTelegramDeliveryError } from '@/lib/telegram-settings'

type DbClient = Pick<PoolClient, 'query'>
export type NotificationEventType = 'order_created' | 'payment_paid' | 'order_cancelled' | 'fulfillment_changed'
export type OrderNotificationPayload = { orderId: number; eventType: NotificationEventType; status: string; fulfillmentStatus: string; totalKopecks: number; items: { productName: string; quantity: number }[]; createdAt: string; eventAt: string; reason?: string; trackingNumber?: string | null }
type OrderRow = { id: number; status: string; fulfillment_status: string; total_kopecks: number | string; created_at: Date | string; tracking_number: string | null }

export async function readNotificationSnapshot(client: DbClient, orderId: number): Promise<Omit<OrderNotificationPayload, 'eventType' | 'reason' | 'eventAt'>> {
  const order = (await client.query<OrderRow>('SELECT id, status, fulfillment_status, total_kopecks, created_at, tracking_number FROM orders WHERE id = $1', [orderId])).rows[0]
  if (!order) throw new Error(`Order ${orderId} disappeared before notification enqueue`)
  const items = await client.query<{ product_name: string; quantity: number }>('SELECT product_name, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])
  return { orderId: order.id, status: order.status, fulfillmentStatus: order.fulfillment_status, totalKopecks: Number(order.total_kopecks), items: items.rows.map((item) => ({ productName: item.product_name, quantity: item.quantity })), createdAt: new Date(order.created_at).toISOString(), trackingNumber: order.tracking_number }
}

export async function enqueueOrderNotification(client: DbClient, event: { eventType: NotificationEventType; eventKey: string; orderId: number; reason?: string }): Promise<void> {
  const snapshot = await readNotificationSnapshot(client, event.orderId)
  const payload: OrderNotificationPayload = { ...snapshot, eventType: event.eventType, eventAt: new Date().toISOString(), ...(event.reason ? { reason: event.reason } : {}) }
  await client.query('INSERT INTO order_notification_outbox (order_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (event_key) DO NOTHING', [event.orderId, event.eventKey, event.eventType, JSON.stringify(payload)])
}

const fulfillmentLabel: Record<string, string> = { packing: 'собирается', handed_to_carrier: 'передан перевозчику', delivered: 'выдан получателю' }
export function formatTelegramOrderNotification(payload: OrderNotificationPayload): string {
  const status = payload.eventType === 'order_created' ? 'ожидает оплаты' : payload.eventType === 'payment_paid' ? 'оплачен' : payload.eventType === 'order_cancelled' ? 'отменён' : fulfillmentLabel[payload.fulfillmentStatus] ?? payload.fulfillmentStatus
  const lines = ['МАВИТА · заказ №' + payload.orderId, `Статус: ${status}`, `Сумма: ${formatRub(payload.totalKopecks)}`, `Позиции: ${payload.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ') || '—'}`, `Время: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(payload.eventAt))} (МСК)`]
  if (payload.reason) lines.push(`Причина: ${payload.reason}`)
  if (payload.trackingNumber && payload.eventType === 'fulfillment_changed' && payload.fulfillmentStatus === 'handed_to_carrier') lines.push(`Трек: ${payload.trackingNumber}`)
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (base) lines.push(`Админка: ${base}/admin/orders/${payload.orderId}`)
  return lines.join('\n').slice(0, 3900)
}

type OutboxRow = { id: number; payload: OrderNotificationPayload }
async function claimNext(): Promise<OutboxRow | undefined> {
  return withTransaction(async (client) => {
    await client.query("UPDATE order_notification_outbox SET status = 'pending', locked_at = NULL WHERE status = 'sending' AND locked_at < now() - interval '15 minutes'")
    const row = (await client.query<OutboxRow>("SELECT id, payload FROM order_notification_outbox WHERE status = 'pending' AND available_at <= now() ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0]
    if (!row) return undefined
    await client.query("UPDATE order_notification_outbox SET status = 'sending', locked_at = now() WHERE id = $1", [row.id])
    return row
  })
}
function safeError(status: number | undefined, value: unknown): string { const description = value && typeof value === 'object' && 'description' in value && typeof value.description === 'string' ? value.description : 'Telegram delivery failed'; return `${status ?? 'network'}: ${description}`.slice(0, 300) }
export function retryMinutes(attempt: number): number | undefined { return [1, 5, 15, 60][attempt - 1] ?? (attempt < 10 ? 360 : undefined) }
async function sendClaimed(row: OutboxRow): Promise<void> {
  let credentials: { chatId: string; token: string } | undefined
  try { credentials = await getTelegramDeliveryCredentials() } catch (error) { const message = safeError(undefined, { description: error instanceof Error ? error.message : 'Configuration error' }); await query("UPDATE order_notification_outbox SET status = 'pending', locked_at = NULL, available_at = now() + interval '5 minutes', last_error = $2 WHERE id = $1", [row.id, message]); await recordTelegramDeliveryError(message); return }
  if (!credentials) { await query("UPDATE order_notification_outbox SET status = 'pending', locked_at = NULL, available_at = now() + interval '1 minute' WHERE id = $1", [row.id]); return }
  const attempts = await query<{ attempt_count: number | string }>("UPDATE order_notification_outbox SET attempt_count = attempt_count + 1 WHERE id = $1 RETURNING attempt_count", [row.id])
  const attempt = Number(attempts[0].attempt_count)
  try {
    const response = await fetch(`https://api.telegram.org/bot${credentials.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: credentials.chatId, text: formatTelegramOrderNotification(row.payload), disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
    const body: unknown = await response.json().catch(() => null)
    if (response.ok && body && typeof body === 'object' && 'ok' in body && body.ok === true && 'result' in body && body.result && typeof body.result === 'object' && 'message_id' in body.result && typeof body.result.message_id === 'number') { await query("UPDATE order_notification_outbox SET status = 'sent', sent_at = now(), telegram_message_id = $2, locked_at = NULL, last_error = NULL WHERE id = $1", [row.id, body.result.message_id]); return }
    const message = safeError(response.status, body)
    if (response.status === 400 || response.status === 401 || response.status === 403) { await query("UPDATE order_notification_outbox SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1", [row.id, message]); await recordTelegramDeliveryError(message, response.status === 401); return }
    const minutes = retryMinutes(attempt)
    if (minutes === undefined) { await query("UPDATE order_notification_outbox SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1", [row.id, message]); await recordTelegramDeliveryError(message); return }
    await query("UPDATE order_notification_outbox SET status = 'pending', locked_at = NULL, available_at = now() + ($2 * interval '1 minute'), last_error = $3 WHERE id = $1", [row.id, minutes, message]); await recordTelegramDeliveryError(message)
  } catch (error) {
    const message = safeError(undefined, { description: error instanceof Error ? error.message : 'Network error' }); const minutes = retryMinutes(attempt)
    if (minutes === undefined) await query("UPDATE order_notification_outbox SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1", [row.id, message])
    else await query("UPDATE order_notification_outbox SET status = 'pending', locked_at = NULL, available_at = now() + ($2 * interval '1 minute'), last_error = $3 WHERE id = $1", [row.id, minutes, message])
    await recordTelegramDeliveryError(message)
  }
}

export async function drainNotificationOutbox(limit = 10): Promise<number> { if (!isDbConfigured()) return 0; let sent = 0; for (let i = 0; i < limit; i += 1) { const row = await claimNext(); if (!row) break; await sendClaimed(row); sent += 1 } return sent }
