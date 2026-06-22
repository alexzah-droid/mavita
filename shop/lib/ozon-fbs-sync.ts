// Очередь и worker синхронизации каталога товаров МАВИТА → Ozon. Endpoint создаёт
// run в БД, worker подхватывает его по lease/fencing-модели и обрабатывает позиции.
// Инварианты (см. docs/specs/ozon-fbs-catalog-sync.md):
//  - import всегда оставляет/ставит FBS-остаток 0; ненулевой остаток возможен лишь
//    после MODERATED → ручного скрытия → аудируемого подтверждения (hidden_confirmed);
//  - перед КАЖДЫМ HTTP-вызовом worker повторно читает profile под row-lock и
//    сверяет lease_token, snapshot updated_at и условия операции (execution-time
//    check) — при расхождении item отменяется как stale без вызова Ozon;
//  - dark-gate OZON_CATALOG_SYNC_ENABLED: пока не 'true', мутационные вызовы Ozon
//    не выполняются (moderation_poll read-only разрешён);
//  - приложение НЕ вызывает visibility/set и не управляет видимостью.
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { isDbConfigured, query, tryWithAdvisoryLock, withTransaction } from '@/lib/db'
import type { DeliveryCredentials } from '@/lib/delivery/types'
import { effectivePrice } from '@/lib/pricing'
import { kopecksToOzonPrice } from '@/lib/ozon-fbs-money'
import { createOzonFbsClient, type OzonFbsClient, OzonApiError } from '@/lib/ozon-fbs-client'
import {
  buildImportItem, buildOzonImageUrls, computeReadiness, mapProfileRow, type OzonProfile,
} from '@/lib/ozon-fbs-profile'

export type SyncOperation = 'content_import' | 'stock_update' | 'zero_stock' | 'moderation_poll'
export type SyncRunKind = 'single' | 'bulk'
const MUTATING_OPS: SyncOperation[] = ['content_import', 'stock_update', 'zero_stock']

/** Dark-gate каталога: пока не literal 'true', мутационные вызовы Ozon запрещены. */
export function catalogSyncEnabled(): boolean { return process.env.OZON_CATALOG_SYNC_ENABLED === 'true' }
export function isMutatingOperation(op: SyncOperation): boolean { return MUTATING_OPS.includes(op) }

/** Предельный возраст awaiting_moderation в часах; некорректное/пустое → 168. */
export function moderationMaxAgeHours(): number {
  const raw = Number(process.env.OZON_MODERATION_MAX_AGE_HOURS)
  return Number.isFinite(raw) && raw > 0 ? raw : 168
}

// ── Решение по позиции (чистая функция, ядро state machine) ───────────────────
export type ItemDecision =
  | { action: 'import'; zeroFirst: boolean }
  | { action: 'set_stock'; stock: number; recordHidden: boolean }
  | { action: 'poll' }
  | { action: 'skip'; reason: string }

/**
 * Что делать с позицией прямо сейчас, под row-lock, с уже перечитанным профилем.
 * `stale` вычисляется в SQL точным сравнением timestamptz (IS NOT DISTINCT FROM)
 * со snapshot run_item — не через JS Date (тот теряет микросекунды). Возвращает skip
 * с причиной, если предусловия операции нарушены — без вызова Ozon. НЕ проверяет
 * readiness контента (это делает worker отдельно перед import) и не ходит в сеть.
 */
export function decideItemAction(op: SyncOperation, profile: OzonProfile, stale: boolean): ItemDecision {
  switch (op) {
    case 'content_import': {
      if (!profile.enabled) return { action: 'skip', reason: 'profile_disabled' }
      if (profile.remoteState === 'pending') return { action: 'skip', reason: 'already_pending' }
      if (stale) return { action: 'skip', reason: 'stale' }
      // Перед re-import уже подтверждённо скрытой карточки с ненулевым остатком
      // сначала обнуляем остаток.
      return { action: 'import', zeroFirst: profile.lastStockSentQuantity > 0 }
    }
    case 'stock_update': {
      // Ненулевой остаток только для enabled + hidden_confirmed + подтверждённого скрытия.
      const allowed = profile.enabled && profile.remoteState === 'hidden_confirmed' && profile.manualHiddenConfirmedAt != null
      if (!allowed) return { action: 'skip', reason: 'not_hidden_confirmed' }
      if (stale) return { action: 'skip', reason: 'stale' }
      return { action: 'set_stock', stock: profile.fbsStockQuantity, recordHidden: true }
    }
    case 'zero_stock': {
      // Обнуляем только ранее импортированные карточки (есть ozon_product_id).
      if (profile.ozonProductId == null) return { action: 'skip', reason: 'never_imported' }
      return { action: 'set_stock', stock: 0, recordHidden: false }
    }
    case 'moderation_poll': {
      if (profile.remoteState !== 'awaiting_moderation') return { action: 'skip', reason: 'not_awaiting_moderation' }
      return { action: 'poll' }
    }
  }
}

/** Классификация ответа модерации product-info. */
export type ModerationOutcome = 'approved' | 'rejected' | 'pending'
export function classifyModeration(moderateStatus: string | null): ModerationOutcome {
  const s = (moderateStatus ?? '').toLowerCase()
  if (!s) return 'pending'
  if (/(approved|moderated|success|passed|verified)/.test(s)) return 'approved'
  if (/(declined|rejected|fail|error|blocked)/.test(s)) return 'rejected'
  return 'pending'
}

// ── DTO/чтение очереди и сводки ───────────────────────────────────────────────
export type RunDto = {
  id: string; kind: SyncRunKind; operation: SyncOperation; warehouseId: number | null; status: 'queued' | 'running' | 'completed' | 'failed'
  totalItems: number; succeededItems: number; failedItems: number; summary: string | null; createdAt: string; startedAt: string | null; completedAt: string | null
}
type RunRow = { id: string; kind: SyncRunKind; operation: SyncOperation; warehouse_id: string | number | null; status: RunDto['status']; total_items: number | string; succeeded_items: number | string; failed_items: number | string; summary: string | null; created_at: Date | string; started_at: Date | string | null; completed_at: Date | string | null }
function runDto(r: RunRow): RunDto {
  return { id: r.id, kind: r.kind, operation: r.operation, warehouseId: r.warehouse_id == null ? null : Number(r.warehouse_id), status: r.status, totalItems: Number(r.total_items), succeededItems: Number(r.succeeded_items), failedItems: Number(r.failed_items), summary: r.summary, createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null }
}
const RUN_COLS = 'id, kind, operation, warehouse_id, status, total_items, succeeded_items, failed_items, summary, created_at, started_at, completed_at'

// Детали позиции run включают текущее состояние профиля — этап карточки, статус
// модерации, отметку ручного подтверждения и метод проверки скрытия (записанный
// только успешным stock_update), время. Без секретов.
export type RunItemDto = {
  productId: number; offerId: string | null; status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  attempts: number; errorCode: string | null; errorMessage: string | null
  remoteState: OzonProfile['remoteState'] | null; moderationStatus: string | null
  manualHiddenConfirmedAt: string | null; hiddenVerificationMethod: 'api' | 'operator' | null; updatedAt: string | null
}

export async function getRun(runId: string): Promise<RunDto | undefined> {
  if (!isDbConfigured()) return undefined
  const rows = await query<RunRow>(`SELECT ${RUN_COLS} FROM ozon_catalog_product_sync_runs WHERE id = $1`, [runId])
  return rows[0] ? runDto(rows[0]) : undefined
}

/** Последние run-ы (для истории в админке; переживает refresh). */
export async function listRecentRuns(limit = 10): Promise<RunDto[]> {
  if (!isDbConfigured()) return []
  const rows = await query<RunRow>(`SELECT ${RUN_COLS} FROM ozon_catalog_product_sync_runs ORDER BY created_at DESC LIMIT $1`, [limit])
  return rows.map(runDto)
}

export async function listRunItems(runId: string): Promise<RunItemDto[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number; offer_id: string | null; status: RunItemDto['status']; attempts: number | string; error_code: string | null; error_message: string | null; remote_state: OzonProfile['remoteState'] | null; moderation_status: string | null; manual_hidden_confirmed_at: Date | string | null; hidden_verification_method: 'api' | 'operator' | null; updated_at: Date | string | null }>(
    `SELECT i.product_id, p.offer_id, i.status, i.attempts, i.error_code, i.error_message, i.updated_at,
       p.remote_state, p.moderation_status, p.manual_hidden_confirmed_at, p.hidden_verification_method
     FROM ozon_catalog_product_sync_run_items i
     LEFT JOIN ozon_product_profiles p ON p.product_id = i.product_id
     WHERE i.run_id = $1 ORDER BY i.product_id`, [runId])
  return rows.map((r) => ({
    productId: r.product_id, offerId: r.offer_id, status: r.status, attempts: Number(r.attempts), errorCode: r.error_code, errorMessage: r.error_message,
    remoteState: r.remote_state, moderationStatus: r.moderation_status,
    manualHiddenConfirmedAt: r.manual_hidden_confirmed_at ? new Date(r.manual_hidden_confirmed_at).toISOString() : null,
    hiddenVerificationMethod: r.hidden_verification_method, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }))
}

export type CatalogSummary = {
  enabled: number; awaitingModeration: number; awaitingManualHide: number; hiddenConfirmed: number
  invalid: number; failed: number; disabled: number; contentDirty: number; stockDirty: number; zeroStock: number
  lastContentSyncedAt: string | null; lastStockSyncedAt: string | null
}
export async function getCatalogSummary(): Promise<CatalogSummary> {
  const empty: CatalogSummary = { enabled: 0, awaitingModeration: 0, awaitingManualHide: 0, hiddenConfirmed: 0, invalid: 0, failed: 0, disabled: 0, contentDirty: 0, stockDirty: 0, zeroStock: 0, lastContentSyncedAt: null, lastStockSyncedAt: null }
  if (!isDbConfigured()) return empty
  const rows = await query<Record<string, string | null>>(
    `SELECT
       count(*) FILTER (WHERE enabled)::text AS enabled,
       count(*) FILTER (WHERE remote_state = 'awaiting_moderation')::text AS awaiting_moderation,
       count(*) FILTER (WHERE remote_state = 'awaiting_manual_hide')::text AS awaiting_manual_hide,
       count(*) FILTER (WHERE remote_state = 'hidden_confirmed')::text AS hidden_confirmed,
       count(*) FILTER (WHERE remote_state = 'invalid')::text AS invalid,
       count(*) FILTER (WHERE remote_state = 'failed')::text AS failed,
       count(*) FILTER (WHERE remote_state = 'disabled')::text AS disabled,
       count(*) FILTER (WHERE content_dirty)::text AS content_dirty,
       count(*) FILTER (WHERE stock_dirty)::text AS stock_dirty,
       count(*) FILTER (WHERE last_stock_sent_quantity = 0 AND ozon_product_id IS NOT NULL)::text AS zero_stock,
       max(content_synced_at)::text AS last_content,
       max(stock_synced_at)::text AS last_stock
     FROM ozon_product_profiles`)
  const r = rows[0] ?? {}
  const n = (k: string) => Number(r[k] ?? 0)
  return {
    enabled: n('enabled'), awaitingModeration: n('awaiting_moderation'), awaitingManualHide: n('awaiting_manual_hide'), hiddenConfirmed: n('hidden_confirmed'),
    invalid: n('invalid'), failed: n('failed'), disabled: n('disabled'), contentDirty: n('content_dirty'), stockDirty: n('stock_dirty'), zeroStock: n('zero_stock'),
    lastContentSyncedAt: r.last_content ? new Date(r.last_content).toISOString() : null, lastStockSyncedAt: r.last_stock ? new Date(r.last_stock).toISOString() : null,
  }
}

// ── Создание run + позиций ────────────────────────────────────────────────────
export type EnqueueParams = { kind: SyncRunKind; operation: SyncOperation; warehouseId: number | null; actorLoginAt: number; productIds: number[] }

export async function enqueueRun(params: EnqueueParams): Promise<{ runId: string; total: number }> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set')
  const runId = randomUUID()
  const ids = [...new Set(params.productIds)]
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ozon_catalog_product_sync_runs (id, kind, operation, warehouse_id, status, actor_login_at, total_items)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6)`,
      [runId, params.kind, params.operation, params.warehouseId, params.actorLoginAt, ids.length],
    )
    for (const productId of ids) {
      await client.query(
        `INSERT INTO ozon_catalog_product_sync_run_items (run_id, product_id, product_updated_at, profile_updated_at, desired_stock, status)
         SELECT $1, $2, p.updated_at, pr.updated_at,
           CASE WHEN $3 = 'stock_update' THEN pr.fbs_stock_quantity WHEN $3 = 'zero_stock' THEN 0 ELSE NULL END,
           'queued'
         FROM products p LEFT JOIN ozon_product_profiles pr ON pr.product_id = p.id
         WHERE p.id = $2
         ON CONFLICT (run_id, product_id) DO NOTHING`,
        [runId, productId, params.operation],
      )
    }
  })
  return { runId, total: ids.length }
}

// Селекторы кандидатов фоновых операций (по расписанию).
export async function selectStockUpdateProductIds(): Promise<number[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number }>(
    `SELECT product_id FROM ozon_product_profiles
     WHERE enabled = true AND remote_state = 'hidden_confirmed' AND manual_hidden_confirmed_at IS NOT NULL AND stock_dirty = true
     ORDER BY product_id`)
  return rows.map((r) => r.product_id)
}
export async function selectZeroStockProductIds(): Promise<number[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number }>(
    `SELECT product_id FROM ozon_product_profiles
     WHERE remote_state = 'disabled' AND ozon_product_id IS NOT NULL AND (stock_dirty = true OR last_stock_sent_quantity > 0)
     ORDER BY product_id`)
  return rows.map((r) => r.product_id)
}
export async function selectModerationPollProductIds(): Promise<number[]> {
  if (!isDbConfigured()) return []
  const rows = await query<{ product_id: number }>(
    `SELECT product_id FROM ozon_product_profiles WHERE remote_state = 'awaiting_moderation' ORDER BY product_id`)
  return rows.map((r) => r.product_id)
}

// ── Worker ────────────────────────────────────────────────────────────────────
export type WorkerDeps = {
  /** Расшифрованные credentials Ozon (независимо от enabled перевозчика). */
  loadCredentials: () => Promise<DeliveryCredentials | undefined>
  /** Выбранный FBS-склад из store_settings. */
  loadWarehouseId: () => Promise<number | null>
  baseUrl: () => string | undefined
  /** Обязательные attribute_id категории (read-only) — для серверной проверки import. */
  requiredAttributeIds?: (client: OzonFbsClient, categoryId: number, typeId: number) => Promise<number[]>
  makeClient?: (creds: DeliveryCredentials) => OzonFbsClient
  now?: () => Date
  leaseMs?: number
  /** Пауза между опросами статуса импорта (по умолчанию реальный таймер). */
  sleep?: (ms: number) => Promise<void>
}

const LEASE_MS = 5 * 60_000

function safeError(error: unknown): { code: string | null; message: string } {
  if (error instanceof OzonApiError) return { code: error.code, message: error.message.slice(0, 500) }
  if (error instanceof Error) return { code: error.name, message: error.message.slice(0, 500) }
  return { code: null, message: 'Неизвестная ошибка' }
}

/**
 * Обработать один run целиком: захватить lease, пройти позиции, финализировать.
 * Возвращает сводку. Безопасно при отсутствии lease (другой worker уже владеет).
 */
export async function processRun(runId: string, deps: WorkerDeps): Promise<RunDto | undefined> {
  if (!isDbConfigured()) return undefined
  const now = deps.now ?? (() => new Date())
  const leaseToken = randomUUID()
  const leaseMs = deps.leaseMs ?? LEASE_MS

  // Захватить только свободный/просроченный lease.
  const acquired = await query<RunRow>(
    `UPDATE ozon_catalog_product_sync_runs
     SET status = 'running', lease_token = $2, lease_expires_at = now() + ($3 || ' milliseconds')::interval, started_at = COALESCE(started_at, now())
     WHERE id = $1 AND status IN ('queued','running') AND (lease_token IS NULL OR lease_expires_at < now())
     RETURNING ${RUN_COLS}`,
    [runId, leaseToken, String(leaseMs)],
  )
  if (!acquired[0]) return getRun(runId)
  const run = runDto(acquired[0])

  // Мутационный run при выключенном dark-gate: ничего не шлём в Ozon.
  if (isMutatingOperation(run.operation) && !catalogSyncEnabled()) {
    await query(`UPDATE ozon_catalog_product_sync_run_items SET status = 'skipped', error_code = 'dark_gate', error_message = 'OZON_CATALOG_SYNC_ENABLED не включён', updated_at = now() WHERE run_id = $1 AND status = 'queued'`, [runId])
    return finalizeRun(runId, leaseToken)
  }

  const creds = await deps.loadCredentials()
  if (!creds) {
    await query(`UPDATE ozon_catalog_product_sync_run_items SET status = 'failed', error_code = 'no_credentials', error_message = 'Ключи Ozon не заданы', updated_at = now() WHERE run_id = $1 AND status = 'queued'`, [runId])
    return finalizeRun(runId, leaseToken)
  }
  const ozon = (deps.makeClient ?? ((c) => createOzonFbsClient(c)))(creds)
  const warehouseId = run.warehouseId ?? (await deps.loadWarehouseId())

  const items = await query<{ product_id: number }>(
    `SELECT product_id FROM ozon_catalog_product_sync_run_items WHERE run_id = $1 AND status = 'queued' ORDER BY product_id`, [runId])

  for (const item of items) {
    await processItem({ runId, leaseToken, run, ozon, warehouseId, deps, now }, item.product_id)
  }
  return finalizeRun(runId, leaseToken)
}

// Singleton worker-lease: «одна активная задача одновременно» (спека). Сессионный
// advisory-lock на всё выполнение drain — второй экземпляр CLI не возьмёт НИ ОДНОГО
// run, пока первый держит лок. Ключ не пересекается с PRODUCTS_PUBLIC_ORDER_LOCK.
export const OZON_CATALOG_WORKER_LOCK = 7_903_244_112

/**
 * Слить очередь: подхватить свободные/просроченные queued|running run-ы по одному
 * и исполнить их (worker/CLI-модель; endpoint только ставит run). Любая операция,
 * включая admin-созданный content_import (исполнение ≠ инициация: содержание
 * запланировал оператор кнопкой). Dark-gate проверяется внутри processRun. Весь drain
 * под глобальным worker-локом — параллельный второй worker сразу выходит (busy:true).
 */
export async function processQueuedRuns(deps: WorkerDeps, maxRuns = 25): Promise<{ busy: boolean; runs: RunDto[] }> {
  if (!isDbConfigured()) return { busy: false, runs: [] }
  const result = await tryWithAdvisoryLock(OZON_CATALOG_WORKER_LOCK, async () => {
    const out: RunDto[] = []
    for (let i = 0; i < maxRuns; i += 1) {
      const next = await query<{ id: string }>(
        `SELECT id FROM ozon_catalog_product_sync_runs
         WHERE status IN ('queued','running') AND (lease_token IS NULL OR lease_expires_at < now())
         ORDER BY created_at LIMIT 1`)
      if (!next[0]) break
      const run = await processRun(next[0].id, deps)
      if (run) out.push(run)
      if (run && run.status === 'running') break // не зациклиться, если run не завершился
    }
    return out
  })
  return result.acquired ? { busy: false, runs: result.value } : { busy: true, runs: [] }
}

type ItemContext = { runId: string; leaseToken: string; run: RunDto; ozon: OzonFbsClient; warehouseId: number | null; deps: WorkerDeps; now: () => Date }

/** Текущий worker потерял владение run-ом (lease отозван/истёк по дороге). */
class LeaseLost extends Error { constructor() { super('lease_lost'); this.name = 'LeaseLost' } }

async function ownsLease(client: PoolClient, runId: string, leaseToken: string): Promise<boolean> {
  const row = (await client.query<{ lease_token: string | null; lease_expires_at: Date | null }>('SELECT lease_token, lease_expires_at FROM ozon_catalog_product_sync_runs WHERE id = $1 FOR UPDATE', [runId])).rows[0]
  return Boolean(row && row.lease_token === leaseToken && row.lease_expires_at && new Date(row.lease_expires_at) > new Date())
}

/** Сверить lease+expiry НЕПОСРЕДСТВЕННО перед каждым HTTP-вызовом Ozon. При потере
 *  владения — бросаем LeaseLost, чтобы откатить транзакцию и не слать запрос. */
async function assertLease(ctx: ItemContext, client: PoolClient): Promise<void> {
  if (!(await ownsLease(client, ctx.runId, ctx.leaseToken))) throw new LeaseLost()
}

// Загрузить профиль под row-lock И вычислить stale ТОЧНЫМ сравнением timestamptz
// со snapshot run_item прямо в SQL (IS NOT DISTINCT FROM, полная микросекундная
// точность — без JS Date, который округляет до миллисекунд).
async function loadProfileForUpdate(client: PoolClient, runId: string, productId: number): Promise<{ profile: OzonProfile; stale: boolean } | undefined> {
  const row = (await client.query<Record<string, unknown> & { not_stale: boolean | null }>(
    `SELECT pr.*,
        (it.profile_updated_at IS NOT DISTINCT FROM pr.updated_at
         AND it.product_updated_at IS NOT DISTINCT FROM p.updated_at) AS not_stale
     FROM ozon_product_profiles pr
     JOIN products p ON p.id = pr.product_id
     JOIN ozon_catalog_product_sync_run_items it ON it.run_id = $2 AND it.product_id = pr.product_id
     WHERE pr.product_id = $1 FOR UPDATE OF pr`, [productId, runId])).rows[0]
  if (!row) return undefined
  return { profile: mapProfileRow(row as never), stale: row.not_stale === false }
}

const setItem = (status: RunItemDto['status'], code: string | null, message: string | null) =>
  ({ text: `UPDATE ozon_catalog_product_sync_run_items SET status = $3, attempts = attempts + 1, error_code = $4, error_message = $5, updated_at = now() WHERE run_id = $1 AND product_id = $2`, status, code, message })

async function processItem(ctx: ItemContext, productId: number): Promise<void> {
  try {
    await withTransaction(async (client) => {
      if (!(await ownsLease(client, ctx.runId, ctx.leaseToken))) { return } // lease потерян — оставляем queued
      const loaded = await loadProfileForUpdate(client, ctx.runId, productId)
      if (!loaded) { const s = setItem('skipped', 'no_profile', 'Профиль не найден'); await client.query(s.text, [ctx.runId, productId, s.status, s.code, s.message]); return }
      const { profile, stale } = loaded
      const decision = decideItemAction(ctx.run.operation, profile, stale)

      if (decision.action === 'skip') { const s = setItem('skipped', decision.reason, 'Позиция пропущена (предусловие не выполнено)'); await client.query(s.text, [ctx.runId, productId, s.status, s.code, s.message]); return }

      try {
        if (decision.action === 'import') await execImport(ctx, client, profile)
        else if (decision.action === 'set_stock') await execSetStock(ctx, client, profile, decision.stock, decision.recordHidden)
        else if (decision.action === 'poll') await execPoll(ctx, client, profile)
        const s = setItem('completed', null, null); await client.query(s.text, [ctx.runId, productId, s.status, s.code, s.message])
      } catch (error) {
        // Потеря lease — не наша ошибка: откатываем транзакцию (никаких частичных
        // записей), позиция остаётся queued для реклейма другим/повторным worker-ом.
        if (error instanceof LeaseLost) throw error
        const { code, message } = safeError(error)
        // Ошибку фиксируем всегда; в 'failed' переводим только import (его pending не
        // имеет смысла оставлять). stock_update/poll сохраняют своё состояние.
        await client.query('UPDATE ozon_product_profiles SET last_error_code = $2, last_error_message = $3 WHERE product_id = $1', [productId, code, message])
        if (decision.action === 'import') await client.query("UPDATE ozon_product_profiles SET remote_state = 'failed' WHERE product_id = $1 AND remote_state = 'pending'", [productId])
        const s = setItem('failed', code, message); await client.query(s.text, [ctx.runId, productId, s.status, s.code, s.message])
      }
    })
  } catch { /* транзакция откатилась (например потеря lease) — позиция останется queued/неизменной */ }
}

async function execImport(ctx: ItemContext, client: PoolClient, profile: OzonProfile): Promise<void> {
  // Readiness под актуальные данные сайта.
  const prod = (await client.query<{ name: string; description: string | null; price_kopecks: number | string; sale_price_kopecks: number | string | null; sale_starts_at: Date | string | null; sale_ends_at: Date | string | null; img_count: string }>(
    `SELECT p.name, p.description, p.price_kopecks, p.sale_price_kopecks, p.sale_starts_at, p.sale_ends_at,
       (SELECT count(*) FROM product_images WHERE product_id = p.id)::text AS img_count
     FROM products p WHERE p.id = $1`, [profile.productId])).rows[0]
  if (!prod) throw new OzonApiError('Товар не найден', { status: 0, retryable: false, authFailed: false })
  const now = ctx.now()
  const sale = { priceKopecks: Number(prod.price_kopecks), salePriceKopecks: prod.sale_price_kopecks == null ? null : Number(prod.sale_price_kopecks), saleStartsAt: prod.sale_starts_at ? new Date(prod.sale_starts_at).toISOString() : null, saleEndsAt: prod.sale_ends_at ? new Date(prod.sale_ends_at).toISOString() : null }
  const effectiveKopecks = effectivePrice(sale, now).kopecks
  const effective = kopecksToOzonPrice(effectiveKopecks)

  let requiredIds: number[] | undefined
  if (ctx.deps.requiredAttributeIds && profile.descriptionCategoryId && profile.typeId) {
    await assertLease(ctx, client)
    requiredIds = await ctx.deps.requiredAttributeIds(ctx.ozon, profile.descriptionCategoryId, profile.typeId)
  }
  const readiness = computeReadiness({
    enabled: profile.enabled, name: prod.name, description: prod.description, effectivePriceKopecks: effectiveKopecks,
    imageCount: Number(prod.img_count), profile, warehouseId: ctx.warehouseId, baseUrl: ctx.deps.baseUrl(), requiredAttributeIds: requiredIds,
  })
  if (readiness.length) {
    await client.query('UPDATE ozon_product_profiles SET remote_state = \'invalid\', last_error_code = \'readiness\', last_error_message = $2 WHERE product_id = $1', [profile.productId, readiness.join('; ').slice(0, 500)])
    throw new OzonApiError(`Readiness: ${readiness.join('; ')}`, { status: 0, retryable: false, authFailed: false })
  }

  const filenames = (await client.query<{ filename: string }>('SELECT filename FROM product_images WHERE product_id = $1 ORDER BY sort_order, id', [profile.productId])).rows.map((r) => r.filename)
  const imageUrls = buildOzonImageUrls(ctx.deps.baseUrl(), filenames)
  if (ctx.warehouseId == null) throw new OzonApiError('Не выбран FBS-склад', { status: 0, retryable: false, authFailed: false })
  const warehouseId = ctx.warehouseId
  const sleep = ctx.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // Перед re-import уже скрытой карточки с ненулевым остатком — сначала обнулить.
  if (profile.lastStockSentQuantity > 0 && profile.ozonProductId != null) {
    await assertLease(ctx, client)
    await ctx.ozon.setStock({ offerId: profile.offerId, productId: profile.ozonProductId, stock: 0, warehouseId })
    await client.query('UPDATE ozon_product_profiles SET last_stock_sent_quantity = 0 WHERE product_id = $1', [profile.productId])
  }

  await client.query('UPDATE ozon_product_profiles SET remote_state = \'pending\', content_dirty = true WHERE product_id = $1', [profile.productId])
  const item = buildImportItem({
    offerId: profile.offerId, name: prod.name, description: prod.description ?? '', descriptionCategoryId: profile.descriptionCategoryId!, typeId: profile.typeId!,
    attributes: profile.attributes, imageUrls, priceRubles: effective, weightGrams: profile.weightGrams!, lengthMm: profile.lengthMm!, widthMm: profile.widthMm!, heightMm: profile.heightMm!, barcode: profile.barcode,
  })
  await assertLease(ctx, client)
  const { taskId } = await ctx.ozon.importProducts([item])
  // task_id сохраняем сразу: при сбое polling ниже коммит catch оставит его для ретрая.
  await client.query('UPDATE ozon_product_profiles SET import_task_id = $2 WHERE product_id = $1', [profile.productId, taskId])

  // Импорт НЕ считается успешным без подтверждённого product_id (bounded polling).
  let ozonProductId: number | null = null
  for (let i = 0; i < 8; i += 1) {
    await assertLease(ctx, client)
    const info = (await ctx.ozon.getImportInfo(taskId)).find((x) => x.offerId === profile.offerId)
    if (info?.errors?.length) throw new OzonApiError(info.errors.join('; ').slice(0, 500), { status: 0, retryable: false, authFailed: false })
    if (info?.productId) { ozonProductId = info.productId; break }
    if (i < 7) await sleep(1000)
  }
  if (ozonProductId == null) throw new OzonApiError('Ozon не подтвердил product_id импорта — повторите позже', { status: 0, code: 'import_unconfirmed', retryable: false, authFailed: false })

  // Гарантируем stock=0 на удалённой карточке (новой или известной), затем читаем
  // авто-сгенерированный штрихкод, чтобы повторный import не блокировался readiness.
  await assertLease(ctx, client)
  await ctx.ozon.setStock({ offerId: profile.offerId, productId: ozonProductId, stock: 0, warehouseId })
  await assertLease(ctx, client)
  const info = (await ctx.ozon.getProductInfo({ productIds: [ozonProductId] }))[0]
  const remoteBarcode = info?.barcodes?.find((b) => b.trim().length > 0) ?? null

  await client.query(
    `UPDATE ozon_product_profiles SET remote_state = 'awaiting_moderation', ozon_product_id = $2,
       barcode = COALESCE(barcode, $3),
       moderation_started_at = now(), content_synced_at = now(), content_dirty = false, stock_dirty = false,
       last_stock_sent_quantity = 0, last_error_code = NULL, last_error_message = NULL,
       manual_hidden_confirmed_at = NULL, manual_hidden_confirmed_by_login_at = NULL, hidden_verified_at = NULL, hidden_verification_method = NULL
     WHERE product_id = $1`,
    [profile.productId, ozonProductId, remoteBarcode],
  )
}

async function execSetStock(ctx: ItemContext, client: PoolClient, profile: OzonProfile, stock: number, recordHidden: boolean): Promise<void> {
  if (ctx.warehouseId == null) throw new OzonApiError('Не выбран FBS-склад', { status: 0, retryable: false, authFailed: false })
  if (profile.ozonProductId == null) throw new OzonApiError('Карточка ещё не импортирована', { status: 0, retryable: false, authFailed: false })

  // Ненулевой остаток: при доступном API-признаке скрытия проверить его прямо перед
  // записью; иначе honor-system (метод operator). Аудируется в любом случае.
  let verificationMethod: 'api' | 'operator' = 'operator'
  if (stock > 0 && recordHidden) {
    await assertLease(ctx, client)
    const info = (await ctx.ozon.getProductInfo({ productIds: [profile.ozonProductId] }))[0]
    if (info && info.visible === true) {
      throw new OzonApiError('Карточка ещё видима на витрине Ozon — ненулевой остаток отклонён', { status: 0, retryable: false, authFailed: false })
    }
    if (info && info.visible === false) verificationMethod = 'api'
  }

  await assertLease(ctx, client)
  await ctx.ozon.setStock({ offerId: profile.offerId, productId: profile.ozonProductId, stock, warehouseId: ctx.warehouseId })
  // hidden_verified_* пишет ТОЛЬКО успешный stock_update подтверждённо скрытой карточки.
  if (recordHidden) {
    await client.query(
      `UPDATE ozon_product_profiles SET last_stock_sent_quantity = $2, stock_synced_at = now(), stock_dirty = false,
         hidden_verified_at = now(), hidden_verification_method = $3, last_error_code = NULL, last_error_message = NULL WHERE product_id = $1`,
      [profile.productId, stock, verificationMethod],
    )
  } else {
    await client.query(
      `UPDATE ozon_product_profiles SET last_stock_sent_quantity = $2, stock_synced_at = now(), stock_dirty = false,
         last_error_code = NULL, last_error_message = NULL WHERE product_id = $1`,
      [profile.productId, stock],
    )
  }
}

async function execPoll(ctx: ItemContext, client: PoolClient, profile: OzonProfile): Promise<void> {
  const ageHours = profile.moderationStartedAt ? (ctx.now().getTime() - new Date(profile.moderationStartedAt).getTime()) / 3_600_000 : 0
  await assertLease(ctx, client)
  const info = profile.ozonProductId != null
    ? (await ctx.ozon.getProductInfo({ productIds: [profile.ozonProductId] }))[0]
    : (await ctx.ozon.getProductInfo({ offerIds: [profile.offerId] }))[0]
  const outcome = classifyModeration(info?.moderateStatus ?? null)
  if (outcome === 'approved') {
    await client.query('UPDATE ozon_product_profiles SET remote_state = \'awaiting_manual_hide\', moderation_status = $2, last_moderation_checked_at = now() WHERE product_id = $1', [profile.productId, info?.moderateStatus ?? 'approved'])
  } else if (outcome === 'rejected') {
    await client.query('UPDATE ozon_product_profiles SET remote_state = \'failed\', moderation_status = $2, last_moderation_checked_at = now(), last_error_code = \'moderation_rejected\', last_error_message = $3 WHERE product_id = $1', [profile.productId, info?.moderateStatus ?? 'rejected', (info?.statusName ?? 'Модерация отклонена').slice(0, 500)])
  } else if (ageHours >= moderationMaxAgeHours()) {
    await client.query('UPDATE ozon_product_profiles SET remote_state = \'failed\', last_moderation_checked_at = now(), last_error_code = \'moderation_timeout\', last_error_message = \'Модерация не завершилась в срок\' WHERE product_id = $1', [profile.productId])
  } else {
    await client.query('UPDATE ozon_product_profiles SET moderation_status = $2, last_moderation_checked_at = now() WHERE product_id = $1', [profile.productId, info?.moderateStatus ?? null])
  }
}

async function finalizeRun(runId: string, leaseToken: string): Promise<RunDto | undefined> {
  const rows = await query<RunRow>(
    `UPDATE ozon_catalog_product_sync_runs r SET
       status = CASE WHEN c.failed > 0 THEN 'failed' ELSE 'completed' END,
       succeeded_items = c.succeeded, failed_items = c.failed,
       summary = 'ok=' || c.succeeded || ' failed=' || c.failed || ' skipped=' || c.skipped,
       completed_at = now(), lease_token = NULL, lease_expires_at = NULL
     FROM (
       SELECT
         count(*) FILTER (WHERE status = 'completed') AS succeeded,
         count(*) FILTER (WHERE status = 'failed') AS failed,
         count(*) FILTER (WHERE status = 'skipped') AS skipped,
         count(*) FILTER (WHERE status IN ('queued','running')) AS pending
       FROM ozon_catalog_product_sync_run_items WHERE run_id = $1
     ) c
     WHERE r.id = $1 AND r.lease_token = $2 AND c.pending = 0
     RETURNING ${RUN_COLS}`,
    [runId, leaseToken],
  )
  if (rows[0]) return runDto(rows[0])
  // Остались незавершённые позиции (lease истёк по дороге) — освободить lease.
  await query('UPDATE ozon_catalog_product_sync_runs SET lease_token = NULL, lease_expires_at = NULL WHERE id = $1 AND lease_token = $2', [runId, leaseToken])
  return getRun(runId)
}
