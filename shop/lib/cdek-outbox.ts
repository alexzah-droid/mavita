// Воркер cdek_task_outbox — создаёт отправления СДЭК и получает PDF-накладные.
// Аналог drainNotificationOutbox: claim → process → done/retry/failed.
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { sendOpsAlert } from '@/lib/ops-alert'
import { createShipment, loadOrderForShipment, pollWaybill } from '@/lib/cdek-shipment'
import { getCdekShipmentSettings, getRuntimeCredentials } from '@/lib/store-settings'

const MAX_CREATE_ATTEMPTS = 5
// Backoff в секундах для create_shipment: 30 → 120 → 600 → 3600 → failed
const CREATE_BACKOFF_S = [30, 120, 600, 3600]
// poll_waybill: не ошибка — просто ждём. Перенос на 10 с без счётчика попыток.
const POLL_RETRY_S = 10
const POLL_TIMEOUT_H = 3 // часов: если накладная не появилась — помечаем failed (без alert, заказ рабочий)

type OutboxRow = {
  id: number
  order_id: number
  task_type: 'create_shipment' | 'poll_waybill'
  attempt_count: number | string
  created_at: Date | string
}

async function reclaimStale(): Promise<void> {
  await query(
    `UPDATE cdek_task_outbox SET status = 'pending', locked_at = NULL
     WHERE status = 'processing' AND locked_at < now() - interval '15 minutes'`,
  )
}

async function claimNext(): Promise<OutboxRow | undefined> {
  return withTransaction(async (client) => {
    const row = (await client.query<OutboxRow>(
      `SELECT id, order_id, task_type, attempt_count, created_at
       FROM cdek_task_outbox
       WHERE status = 'pending' AND available_at <= now()
       ORDER BY available_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    )).rows[0]
    if (!row) return undefined
    await client.query(
      `UPDATE cdek_task_outbox SET status = 'processing', locked_at = now() WHERE id = $1`,
      [row.id],
    )
    return row
  })
}

async function markDone(id: number): Promise<void> {
  await query(
    `UPDATE cdek_task_outbox SET status = 'done', done_at = now(), locked_at = NULL WHERE id = $1`,
    [id],
  )
}

async function markFailed(id: number, error: string): Promise<void> {
  await query(
    `UPDATE cdek_task_outbox SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1`,
    [id, error],
  )
}

async function reschedule(id: number, delaySec: number, error?: string): Promise<void> {
  await query(
    `UPDATE cdek_task_outbox
     SET status = 'pending', locked_at = NULL,
         available_at = now() + ($2 * interval '1 second'),
         last_error = COALESCE($3, last_error)
     WHERE id = $1`,
    [id, delaySec, error ?? null],
  )
}

async function incrementAttempt(id: number): Promise<number> {
  const rows = await query<{ attempt_count: number | string }>(
    `UPDATE cdek_task_outbox SET attempt_count = attempt_count + 1 WHERE id = $1 RETURNING attempt_count`,
    [id],
  )
  return Number(rows[0].attempt_count)
}

async function enqueueWaybill(orderId: number): Promise<void> {
  await query(
    `INSERT INTO cdek_task_outbox (order_id, task_type, event_key)
     VALUES ($1, 'poll_waybill', $2)
     ON CONFLICT (event_key) DO NOTHING`,
    [orderId, `poll_waybill:${orderId}`],
  )
}

async function processCreateShipment(row: OutboxRow): Promise<void> {
  const creds = await getRuntimeCredentials('cdek')
  if (!creds) {
    await reschedule(row.id, 60, 'CDEK credentials not configured')
    return
  }
  const settings = await getCdekShipmentSettings()
  if (!settings) {
    await reschedule(row.id, 60, 'CDEK shipment settings not configured')
    return
  }

  const order = await loadOrderForShipment(row.order_id)
  if (!order) {
    await markFailed(row.id, `Order ${row.order_id} not found or not paid CDEK order`)
    return
  }

  const attempt = await incrementAttempt(row.id)

  const result = await createShipment(order, creds, settings)

  if (result.ok) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET cdek_order_uuid = $1, cdek_error = NULL WHERE id = $2`,
        [result.uuid, row.order_id],
      )
      await client.query(
        `UPDATE cdek_task_outbox SET status = 'done', done_at = now(), locked_at = NULL WHERE id = $1`,
        [row.id],
      )
    })
    await enqueueWaybill(row.order_id)
    return
  }

  if (!result.retryable || attempt >= MAX_CREATE_ATTEMPTS) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET cdek_error = $1 WHERE id = $2`,
        [result.error, row.order_id],
      )
      await client.query(
        `UPDATE cdek_task_outbox SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1`,
        [row.id, result.error],
      )
    })
    await sendOpsAlert(
      `СДЭК ❌ Не удалось создать отправление по заказу #${row.order_id}\n${result.error}\nАдминка: ${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/admin/orders/${row.order_id}`,
    )
    return
  }

  const delaySec = CREATE_BACKOFF_S[attempt - 1] ?? CREATE_BACKOFF_S.at(-1)!
  await reschedule(row.id, delaySec, result.error)
}

async function processPollWaybill(row: OutboxRow): Promise<void> {
  const creds = await getRuntimeCredentials('cdek')
  if (!creds) { await reschedule(row.id, 60); return }

  const orderRows = await query<{ cdek_order_uuid: string | null }>(
    'SELECT cdek_order_uuid FROM orders WHERE id = $1',
    [row.order_id],
  )
  const orderUuid = orderRows[0]?.cdek_order_uuid
  if (!orderUuid) {
    await markFailed(row.id, 'cdek_order_uuid not set — create_shipment not done yet?')
    return
  }

  // Таймаут: накладная не появилась за 3 часа — помечаем failed, заказ рабочий
  const ageH = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000
  if (ageH > POLL_TIMEOUT_H) {
    await markFailed(row.id, 'Накладная не была сгенерирована за 3 часа')
    return
  }

  const result = await pollWaybill(orderUuid, creds)

  if (result.ok) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET cdek_waybill_url = $1, cdek_barcode_url = $2 WHERE id = $3`,
        [result.waybillUrl, result.barcodeUrl ?? null, row.order_id],
      )
      await client.query(
        `UPDATE cdek_task_outbox SET status = 'done', done_at = now(), locked_at = NULL WHERE id = $1`,
        [row.id],
      )
    })
    return
  }

  // pending (CDEK ещё генерит) — не инкрементим attempt_count
  await reschedule(row.id, POLL_RETRY_S, result.error)
}

async function processClaimed(row: OutboxRow): Promise<void> {
  try {
    if (row.task_type === 'create_shipment') {
      await processCreateShipment(row)
    } else {
      await processPollWaybill(row)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const attempt = Number(row.attempt_count)
    if (row.task_type === 'create_shipment' && attempt < MAX_CREATE_ATTEMPTS) {
      const delaySec = CREATE_BACKOFF_S[attempt] ?? CREATE_BACKOFF_S.at(-1)!
      await reschedule(row.id, delaySec, msg)
    } else {
      await markFailed(row.id, msg)
    }
  }
}

export async function drainCdekOutbox(limit = 10): Promise<number> {
  if (!isDbConfigured()) return 0
  await reclaimStale()
  let processed = 0
  for (let i = 0; i < limit; i += 1) {
    const row = await claimNext()
    if (!row) break
    await processClaimed(row)
    processed += 1
  }
  return processed
}
