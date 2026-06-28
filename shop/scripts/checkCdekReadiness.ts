import { promisify } from 'node:util'
import { execFile as execFileCb } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDbConfigured, query } from '@/lib/db'
import { listPickupPointsByCityCode, suggestCities } from '@/lib/cdek'
import { evaluateCdekReadiness, type CdekReadinessSnapshot, type TimerSnapshot } from '@/lib/cdek-readiness'
import { getStoredCredentials, resolveDeliveryMode } from '@/lib/store-settings'

const execFile = promisify(execFileCb)
const SAMPLE_CITY = 'Москва'

function loadDotEnv() {
  const file = join(process.cwd(), '.env')
  if (!existsSync(file)) return
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!key || process.env[key] != null) continue
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

type StoreSettingsRow = {
  updated_at: Date | string
  cdek_pickup_enabled: boolean
  cdek_pickup_delivery_kopecks: number | string | null
  cdek_auto_shipment_enabled: boolean
  cdek_shipment_point: string | null
  cdek_sender_name: string | null
  cdek_sender_phone: string | null
  cdek_webhook_uuid: string | null
}

type OrdersSummaryRow = {
  cdek_orders: number | string
  orders_with_shipment_uuid: number | string
  orders_with_waybill: number | string
  orders_with_barcode: number | string
  latest_cdek_order_created_at: Date | string | null
  latest_shipment_order_created_at: Date | string | null
}

type OutboxSummaryRow = {
  outbox_pending: number | string
  outbox_processing: number | string
  outbox_failed: number | string
  stale_processing: number | string
}

type EventsSummaryRow = {
  webhook_events: number | string
  latest_webhook_event_at: Date | string | null
}

function parseShow(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    result[line.slice(0, idx)] = line.slice(idx + 1)
  }
  return result
}

async function readTimer(unit: string): Promise<TimerSnapshot> {
  try {
    const { stdout } = await execFile('systemctl', [
      'show',
      unit,
      '--property=LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec',
      '--no-pager',
    ])
    const props = parseShow(stdout)
    return {
      unit,
      loadState: props.LoadState || null,
      activeState: props.ActiveState || null,
      unitFileState: props.UnitFileState || null,
      nextElapse: props.NextElapseUSecRealtime || null,
      lastTrigger: props.LastTriggerUSec || null,
      error: null,
    }
  } catch (error) {
    return {
      unit,
      loadState: null,
      activeState: null,
      unitFileState: null,
      nextElapse: null,
      lastTrigger: null,
      error: error instanceof Error ? error.message : 'systemctl failed',
    }
  }
}

async function probeWebhook(baseUrl: string | null): Promise<CdekReadinessSnapshot['webhook']> {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/cdek/webhook` : null
  if (!url) return { url: null, reachable: false, statusCode: null, error: 'NEXT_PUBLIC_BASE_URL is not set' }
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', cache: 'no-store' })
    const reachable = response.status === 405 || response.status === 200 || response.status === 400
    return { url, reachable, statusCode: response.status, error: reachable ? null : `Unexpected HTTP ${response.status}` }
  } catch (error) {
    return {
      url,
      reachable: false,
      statusCode: null,
      error: error instanceof Error ? error.message : 'Webhook probe failed',
    }
  }
}

async function collectSnapshot(): Promise<CdekReadinessSnapshot> {
  const env = {
    databaseUrlConfigured: isDbConfigured(),
    settingsEncKeyConfigured: Boolean(process.env.SETTINGS_ENC_KEY?.trim()),
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL?.trim() || null,
    deliveryEnabledLiteral: process.env.DELIVERY_ENABLED ?? null,
  }

  let settingsRow: StoreSettingsRow | null = null
  let ordersSummary: OrdersSummaryRow | null = null
  let outboxSummary: OutboxSummaryRow | null = null
  let eventsSummary: EventsSummaryRow | null = null

  if (isDbConfigured()) {
    settingsRow = (await query<StoreSettingsRow>(
      `SELECT updated_at, cdek_pickup_enabled, cdek_pickup_delivery_kopecks,
              cdek_auto_shipment_enabled, cdek_shipment_point, cdek_sender_name,
              cdek_sender_phone, cdek_webhook_uuid
       FROM store_settings
       WHERE singleton = true`,
    ))[0] ?? null

    ordersSummary = (await query<OrdersSummaryRow>(
      `SELECT
          count(*) FILTER (WHERE delivery_method = 'cdek_pickup') AS cdek_orders,
          count(*) FILTER (WHERE cdek_order_uuid IS NOT NULL) AS orders_with_shipment_uuid,
          count(*) FILTER (WHERE cdek_waybill_url IS NOT NULL) AS orders_with_waybill,
          count(*) FILTER (WHERE cdek_barcode_url IS NOT NULL) AS orders_with_barcode,
          max(created_at) FILTER (WHERE delivery_method = 'cdek_pickup') AS latest_cdek_order_created_at,
          max(created_at) FILTER (WHERE cdek_order_uuid IS NOT NULL) AS latest_shipment_order_created_at
       FROM orders`,
    ))[0] ?? null

    outboxSummary = (await query<OutboxSummaryRow>(
      `SELECT
          count(*) FILTER (WHERE status = 'pending') AS outbox_pending,
          count(*) FILTER (WHERE status = 'processing') AS outbox_processing,
          count(*) FILTER (WHERE status = 'failed') AS outbox_failed,
          count(*) FILTER (WHERE status = 'processing' AND locked_at < now() - interval '15 minutes') AS stale_processing
       FROM cdek_task_outbox`,
    ))[0] ?? null

    eventsSummary = (await query<EventsSummaryRow>(
      `SELECT
          count(*) FILTER (WHERE event_type = 'cdek_status_update') AS webhook_events,
          max(created_at) FILTER (WHERE event_type = 'cdek_status_update') AS latest_webhook_event_at
       FROM order_admin_events`,
    ))[0] ?? null
  }

  const resolution = await resolveDeliveryMode().catch(() => ({ mode: 'error' as const, carriers: [] }))
  const cdekActive = resolution.carriers.find((carrier) => carrier.carrier === 'cdek')
  const stored = await getStoredCredentials('cdek').catch(() => undefined)

  let probeOk = false
  let authFailed = false
  let cityCode: number | null = null
  let pickupPointCount: number | null = null
  let probeError: string | null = null

  if (stored) {
    try {
      const cities = await suggestCities(stored, SAMPLE_CITY)
      const city = cities.find((item) => item.city.toLowerCase() === SAMPLE_CITY.toLowerCase()) ?? cities[0]
      if (!city) {
        probeError = `No cities returned for ${SAMPLE_CITY}`
      } else {
        cityCode = city.code
        const points = await listPickupPointsByCityCode(stored, city.code)
        pickupPointCount = points.length
        probeOk = true
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CDEK probe failed'
      probeError = message
      authFailed = /\b401\b|\b403\b|auth/i.test(message)
    }
  }

  const timers = {
    cdek: await readTimer('mavita-cdek.timer'),
    notifications: await readTimer('mavita-notifications.timer'),
  }

  const webhook = await probeWebhook(env.baseUrl)

  return {
    env,
    delivery: {
      mode: resolution.mode,
      cdekEnabled: settingsRow?.cdek_pickup_enabled ?? false,
      tariffKopecks: settingsRow?.cdek_pickup_delivery_kopecks != null ? Number(settingsRow.cdek_pickup_delivery_kopecks) : cdekActive?.deliveryKopecks ?? null,
      settingsUpdatedAt: settingsRow?.updated_at ? new Date(settingsRow.updated_at).toISOString() : null,
    },
    credentials: {
      stored: Boolean(stored),
      probeOk,
      authFailed,
      cityCode,
      pickupPointCount,
      error: probeError,
    },
    shipment: {
      autoShipmentEnabled: settingsRow?.cdek_auto_shipment_enabled ?? false,
      hasShipmentPoint: Boolean(settingsRow?.cdek_shipment_point?.trim()),
      hasSenderName: Boolean(settingsRow?.cdek_sender_name?.trim()),
      hasSenderPhone: Boolean(settingsRow?.cdek_sender_phone?.trim()),
      hasWebhookUuid: Boolean(settingsRow?.cdek_webhook_uuid?.trim()),
    },
    timers,
    webhook,
    db: {
      cdekOrders: Number(ordersSummary?.cdek_orders ?? 0),
      ordersWithShipmentUuid: Number(ordersSummary?.orders_with_shipment_uuid ?? 0),
      ordersWithWaybill: Number(ordersSummary?.orders_with_waybill ?? 0),
      ordersWithBarcode: Number(ordersSummary?.orders_with_barcode ?? 0),
      webhookEvents: Number(eventsSummary?.webhook_events ?? 0),
      outboxPending: Number(outboxSummary?.outbox_pending ?? 0),
      outboxProcessing: Number(outboxSummary?.outbox_processing ?? 0),
      outboxFailed: Number(outboxSummary?.outbox_failed ?? 0),
      staleProcessing: Number(outboxSummary?.stale_processing ?? 0),
      latestCdekOrderCreatedAt: ordersSummary?.latest_cdek_order_created_at ? new Date(ordersSummary.latest_cdek_order_created_at).toISOString() : null,
      latestShipmentOrderCreatedAt: ordersSummary?.latest_shipment_order_created_at ? new Date(ordersSummary.latest_shipment_order_created_at).toISOString() : null,
      latestWebhookEventAt: eventsSummary?.latest_webhook_event_at ? new Date(eventsSummary.latest_webhook_event_at).toISOString() : null,
    },
  }
}

function printReport(snapshot: CdekReadinessSnapshot) {
  const report = evaluateCdekReadiness(snapshot)
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const
  console.log(`CDEK readiness: ${report.ready ? 'READY' : 'NOT READY'}`)
  for (const check of report.checks) {
    console.log(`- [${icon[check.status]}] ${check.summary}`)
    console.log(`  ${check.detail}`)
  }
  console.log('')
  console.log('Snapshot:')
  console.log(JSON.stringify(snapshot, null, 2))
  if (!report.ready) process.exitCode = 1
}

async function main() {
  loadDotEnv()
  const snapshot = await collectSnapshot()
  if (process.argv.includes('--json')) {
    const report = evaluateCdekReadiness(snapshot)
    console.log(JSON.stringify({ report, snapshot }, null, 2))
    if (!report.ready) process.exitCode = 1
    return
  }
  printReport(snapshot)
}

main().catch((error) => {
  console.error('CDEK readiness check failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
