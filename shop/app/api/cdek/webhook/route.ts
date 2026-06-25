import { NextRequest, NextResponse } from 'next/server'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { enqueueOrderNotification } from '@/lib/telegram-notifications'
import { sendOpsAlert } from '@/lib/ops-alert'

// СДЭК не подписывает вебхуки HMAC. Верификация — проверка cdek_order_uuid в нашей БД.
// Неизвестный UUID → 200 OK без действий (не 4xx, иначе СДЭК будет ретраить).

// Актор для событий вебхука (не admin-сессия)
const ACTOR_CDEK_WEBHOOK = 0

// Порядок statuse для защиты от регресса
const FULFILLMENT_RANK: Record<string, number> = {
  awaiting_payment: 0,
  new: 1,
  packing: 2,
  handed_to_carrier: 3,
  delivered: 4,
}

// Маппинг CDEK status_code → наш fulfillment_status
function mapCdekStatus(cdekCode: string): string | null {
  switch (cdekCode) {
    case 'CREATED':
    case 'ACCEPTED':
    case 'RECEIVED_AT_SHIPMENT_ADDRESS':
      return 'new'
    case 'READY_FOR_SHIPMENT_IN_SENDER_CITY':
    case 'TAKEN_FROM_SENDER':
      return 'packing'
    case 'TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY':
    case 'IN_TRANSIT':
    case 'RETURNED_TO_TRANSIT_CITY':
    case 'READY_FOR_PICKUP':
      return 'handed_to_carrier'
    case 'DELIVERED':
      return 'delivered'
    default:
      return null
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ ok: true })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  if (!body || typeof body !== 'object') return NextResponse.json({ ok: true })
  const payload = body as Record<string, unknown>
  if (payload.type !== 'ORDER_STATUS') return NextResponse.json({ ok: true })

  // СДЭК может класть uuid на разных уровнях — пробуем оба
  const attributes = payload.attributes as Record<string, unknown> | undefined
  const orderUuid = (typeof payload.uuid === 'string' ? payload.uuid : null)
    ?? (typeof attributes?.order_uuid === 'string' ? attributes.order_uuid : null)
  const cdekStatusCode = typeof attributes?.code === 'string' ? attributes.code : null
  const cdekNumber = typeof attributes?.cdek_number === 'string' ? attributes.cdek_number : null

  if (!orderUuid || !cdekStatusCode) return NextResponse.json({ ok: true })

  const targetStatus = mapCdekStatus(cdekStatusCode)

  // Алерт на NOT_DELIVERED, но без изменения статуса
  if (cdekStatusCode === 'NOT_DELIVERED') {
    const orderRows = await query<{ id: number }>('SELECT id FROM orders WHERE cdek_order_uuid = $1', [orderUuid])
    if (orderRows[0]) {
      await sendOpsAlert(`СДЭК ⚠️ Заказ #${orderRows[0].id} не доставлен (NOT_DELIVERED)\nАдминка: ${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/admin/orders/${orderRows[0].id}`)
    }
    return NextResponse.json({ ok: true })
  }

  if (!targetStatus) return NextResponse.json({ ok: true })

  try {
    await withTransaction(async (client) => {
      const orderRows = await client.query<{
        id: number
        status: string
        fulfillment_status: string
        tracking_number: string | null
        cdek_order_uuid: string | null
      }>(
        `SELECT id, status, fulfillment_status, tracking_number, cdek_order_uuid
         FROM orders WHERE cdek_order_uuid = $1 FOR UPDATE`,
        [orderUuid],
      )
      const order = orderRows.rows[0]
      if (!order) return // неизвестный UUID — игнор

      // Только оплаченные заказы можно двигать по fulfillment
      if (order.status !== 'paid') return

      const currentRank = FULFILLMENT_RANK[order.fulfillment_status] ?? -1
      const targetRank  = FULFILLMENT_RANK[targetStatus] ?? -1

      // Переход только вперёд
      if (targetRank <= currentRank) return

      // Трек: при входе в handed_to_carrier или delivered — нужен tracking_number
      // (orders_tracking_number_check: NOT NULL при этих статусах)
      let trackingNumber: string | null = order.tracking_number
      if (targetStatus === 'handed_to_carrier' || targetStatus === 'delivered') {
        trackingNumber = cdekNumber?.trim() || order.tracking_number || orderUuid.slice(0, 8)
      } else {
        // При статусах до handed_to_carrier трек должен быть NULL
        trackingNumber = null
      }

      // Обновляем cdek_number если он пришёл
      const setCdekNumber = cdekNumber ? ', cdek_number = $4' : ''
      const params: unknown[] = [targetStatus, trackingNumber, order.id]
      if (cdekNumber) params.push(cdekNumber)

      await client.query(
        `UPDATE orders SET fulfillment_status = $1, tracking_number = $2${setCdekNumber} WHERE id = $3`,
        params,
      )

      await client.query(
        `INSERT INTO order_admin_events
           (order_id, event_type, from_fulfillment_status, to_fulfillment_status, tracking_number, actor_login_at)
         VALUES ($1, 'cdek_status_update', $2, $3, $4, $5)`,
        [order.id, order.fulfillment_status, targetStatus, trackingNumber, ACTOR_CDEK_WEBHOOK],
      )

      await enqueueOrderNotification(client, {
        orderId: order.id,
        eventType: 'fulfillment_changed',
        eventKey: `order:${order.id}:fulfillment:cdek:${targetStatus}`,
      })
    })
  } catch (err) {
    console.error('CDEK webhook error', err)
    // Возвращаем 200 даже при ошибке — СДЭК не должен ретраить из-за нашей БД
  }

  return NextResponse.json({ ok: true })
}
