// Связующий слой FBS-каталога: достаёт расшифрованные ключи Ozon и выбранный
// FBS-склад из store_settings, строит HTTP-клиент, формирует WorkerDeps и
// оркеструет постановку/исполнение run-ов для admin-endpoint-ов и CLI. Ключи в
// браузер не уходят: модуль только серверный.
import 'server-only'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import type { DeliveryCredentials } from '@/lib/delivery/types'
import { getOzonFbsWarehouseId, getStoredCredentials } from '@/lib/store-settings'
import { createOzonFbsClient, type OzonFbsClient } from '@/lib/ozon-fbs-client'
import { getAdminProduct } from '@/lib/admin-products-db'
import { effectivePrice } from '@/lib/pricing'
import { canConfirmHidden, computeReadiness, getOzonProfile, type OzonProfile } from '@/lib/ozon-fbs-profile'
import {
  catalogSyncEnabled, enqueueRun, getRun, type RunDto, type SyncOperation, type WorkerDeps,
} from '@/lib/ozon-fbs-sync'

export class OzonCredentialsMissing extends Error { constructor() { super('Ключи Ozon не заданы'); this.name = 'OzonCredentialsMissing' } }
export class CatalogSyncDisabled extends Error { constructor() { super('OZON_CATALOG_SYNC_ENABLED не включён'); this.name = 'CatalogSyncDisabled' } }

export async function loadOzonCredentials(): Promise<DeliveryCredentials | undefined> {
  const stored = await getStoredCredentials('ozon')
  return stored ? { clientId: stored.clientId, secret: stored.secret } : undefined
}

/** Read-only клиент для складов/категорий/атрибутов. Бросает, если ключи не заданы. */
export async function makeReadOnlyOzonClient(): Promise<OzonFbsClient> {
  const creds = await loadOzonCredentials()
  if (!creds) throw new OzonCredentialsMissing()
  return createOzonFbsClient(creds)
}

/** Обязательные attribute_id выбранной категории (read-only, кэш на вызов). */
async function requiredAttributeIds(client: OzonFbsClient, categoryId: number, typeId: number): Promise<number[]> {
  const attrs = await client.listCategoryAttributes(categoryId, typeId)
  return attrs.filter((a) => a.isRequired).map((a) => a.id)
}

export function workerDeps(): WorkerDeps {
  return {
    loadCredentials: loadOzonCredentials,
    loadWarehouseId: getOzonFbsWarehouseId,
    baseUrl: () => process.env.NEXT_PUBLIC_BASE_URL,
    requiredAttributeIds,
  }
}

// ── Постановка в очередь (исполняет worker/CLI, не request lifecycle) ──────────
/** Поставить single-item run. Исполнение — worker/CLI по lease-модели. */
export async function enqueueSingle(operation: SyncOperation, productId: number, actorLoginAt: number): Promise<RunDto | undefined> {
  const warehouseId = await getOzonFbsWarehouseId()
  const { runId } = await enqueueRun({ kind: 'single', operation, warehouseId, actorLoginAt, productIds: [productId] })
  return getRun(runId)
}

/** Поставить массовый run. Долгая синхронизация не выполняется внутри запроса. */
export async function enqueueBulk(operation: SyncOperation, productIds: number[], actorLoginAt: number): Promise<RunDto | undefined> {
  const warehouseId = await getOzonFbsWarehouseId()
  const { runId } = await enqueueRun({ kind: 'bulk', operation, warehouseId, actorLoginAt, productIds })
  return getRun(runId)
}

/** enabled профили, которые можно (пере)импортировать кнопкой (не pending). */
export async function selectImportableProductIds(): Promise<number[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number }>(
    "SELECT product_id FROM ozon_product_profiles WHERE enabled = true AND remote_state <> 'pending' ORDER BY product_id")
  return rows.map((r) => r.product_id)
}

/** Подтверждённо скрытые карточки для массового stock-sync. */
export async function selectHiddenConfirmedProductIds(): Promise<number[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number }>(
    "SELECT product_id FROM ozon_product_profiles WHERE enabled = true AND remote_state = 'hidden_confirmed' AND manual_hidden_confirmed_at IS NOT NULL ORDER BY product_id")
  return rows.map((r) => r.product_id)
}

/**
 * Аудируемо подтвердить ручное скрытие в ЛК. Только для awaiting_manual_hide; НЕ
 * вызывает visibility/set, лишь записывает actor/time и переводит в hidden_confirmed.
 */
export async function confirmHidden(productId: number, actorLoginAt: number): Promise<{ ok: boolean; reason?: string; profile?: OzonProfile }> {
  if (!isDbConfigured()) return { ok: false, reason: 'no_db' }
  return withTransaction(async (client) => {
    const row = (await client.query('SELECT remote_state FROM ozon_product_profiles WHERE product_id = $1 FOR UPDATE', [productId])).rows[0] as { remote_state: OzonProfile['remoteState'] } | undefined
    if (!row) return { ok: false, reason: 'not_found' }
    if (!canConfirmHidden({ remoteState: row.remote_state })) return { ok: false, reason: 'wrong_state' }
    await client.query(
      `UPDATE ozon_product_profiles SET remote_state = 'hidden_confirmed', manual_hidden_confirmed_at = now(), manual_hidden_confirmed_by_login_at = $2, stock_dirty = true WHERE product_id = $1`,
      [productId, actorLoginAt],
    )
    return { ok: true }
  }).then(async (r) => (r.ok ? { ...r, profile: await getOzonProfile(productId) } : r))
}

/**
 * Readiness и план без вызова Ozon (для кнопки «Проверить готовность»). Полнота
 * обязательных атрибутов категории здесь не проверяется по живой категории —
 * это делает import worker перед отправкой; отмечаем явной заметкой.
 */
export type DryRunResult = { ready: boolean; errors: string[]; remoteState: OzonProfile['remoteState'] | null; note: string }
export async function dryRun(productId: number): Promise<DryRunResult | undefined> {
  const product = await getAdminProduct(productId)
  if (!product) return undefined
  const profile = await getOzonProfile(productId)
  const warehouseId = await getOzonFbsWarehouseId()
  const effective = effectivePrice({ priceKopecks: product.priceKopecks, salePriceKopecks: product.sale?.priceKopecks ?? null, saleStartsAt: product.sale?.startsAt ?? null, saleEndsAt: product.sale?.endsAt ?? null }, new Date())
  const errors = computeReadiness({
    enabled: profile?.enabled ?? false, name: product.name, description: product.description, effectivePriceKopecks: effective.kopecks,
    imageCount: product.images.length,
    profile: profile ?? { descriptionCategoryId: null, typeId: null, barcode: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, attributes: [], ozonProductId: null, complianceStatus: 'not_checked' },
    warehouseId, baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
  })
  return { ready: errors.length === 0, errors, remoteState: profile?.remoteState ?? null, note: 'Полнота обязательных атрибутов категории проверяется при импорте.' }
}

/** Массовый dry-run: readiness всех enabled-профилей без вызова Ozon. */
export type BulkReadinessRow = { productId: number; offerId: string; ready: boolean; errors: string[] }
export async function bulkReadiness(): Promise<BulkReadinessRow[]> {
  const ids = await selectImportableProductIds()
  const out: BulkReadinessRow[] = []
  for (const id of ids) {
    const r = await dryRun(id)
    out.push({ productId: id, offerId: `mavita-${id}`, ready: r?.ready ?? false, errors: r?.errors ?? ['Профиль не найден'] })
  }
  return out
}

export { catalogSyncEnabled, getRun }
