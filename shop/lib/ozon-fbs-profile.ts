// Технический FBS-профиль карточки Ozon: чистая доменная логика (валидация полей,
// readiness, сборка import-payload, URL изображений, предикаты состояния) + слой БД.
// Источник правды — БД МАВИТА. Приложение НЕ управляет видимостью карточки Ozon
// (скрытие — ручной шаг оператора в ЛК); ненулевой FBS-остаток возможен только
// после MODERATED → ручного скрытия → аудируемого подтверждения. См.
// docs/specs/ozon-fbs-catalog-sync.md.
import type { PoolClient } from 'pg'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { effectiveOzonPrice } from '@/lib/ozon-fbs-money'
import type { SaleFields } from '@/lib/pricing'

export type OzonRemoteState =
  | 'not_synced' | 'pending' | 'awaiting_moderation' | 'awaiting_manual_hide'
  | 'hidden_confirmed' | 'invalid' | 'failed' | 'disabled'
export type OzonComplianceStatus = 'not_checked' | 'ready' | 'blocked'
export type HiddenVerificationMethod = 'api' | 'operator'

/** Нормализованное значение атрибута: либо словарное значение, либо свободный текст. */
export type OzonAttributeValue = { dictionaryValueId?: number; value?: string }
export type OzonAttribute = { attributeId: number; complexId: number; values: OzonAttributeValue[] }

export type OzonProfile = {
  productId: number
  enabled: boolean
  offerId: string
  fbsStockQuantity: number
  descriptionCategoryId: number | null
  typeId: number | null
  barcode: string | null
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  attributes: OzonAttribute[]
  ozonProductId: number | null
  importTaskId: string | null
  remoteState: OzonRemoteState
  moderationStatus: string | null
  contentSyncedAt: string | null
  stockSyncedAt: string | null
  moderationStartedAt: string | null
  lastModerationCheckedAt: string | null
  manualHiddenConfirmedAt: string | null
  manualHiddenConfirmedByLoginAt: number | null
  hiddenVerifiedAt: string | null
  hiddenVerificationMethod: HiddenVerificationMethod | null
  contentDirty: boolean
  stockDirty: boolean
  lastStockSentQuantity: number
  complianceStatus: OzonComplianceStatus
  complianceNote: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** Неизменяемый offer_id: смена slug не создаёт новую карточку Ozon. */
export function offerIdFor(productId: number): string { return `mavita-${productId}` }

// ── Валидация технических полей профиля (PATCH) ──────────────────────────────
export type OzonProfileInput = {
  enabled?: boolean
  fbsStockQuantity?: number
  descriptionCategoryId?: number | null
  typeId?: number | null
  barcode?: string | null
  weightGrams?: number | null
  lengthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
  attributes?: OzonAttribute[]
  complianceStatus?: OzonComplianceStatus
  complianceNote?: string | null
}
export type ValidatedOzonProfileInput = OzonProfileInput

const COMPLIANCE: OzonComplianceStatus[] = ['not_checked', 'ready', 'blocked']
const MAX_DIMENSION_MM = 1_000_000
const MAX_WEIGHT_G = 1_000_000

function posIntOrNull(value: unknown, label: string, errors: string[], max: number): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) { errors.push(`${label} — целое число от 1 до ${max}`); return undefined }
  return value
}

function validateAttributes(raw: unknown, errors: string[]): OzonAttribute[] | undefined {
  if (!Array.isArray(raw)) { errors.push('Атрибуты должны быть массивом'); return undefined }
  if (raw.length > 200) { errors.push('Слишком много атрибутов'); return undefined }
  const out: OzonAttribute[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('Атрибут должен быть объектом'); continue }
    const a = item as Record<string, unknown>
    if (typeof a.attributeId !== 'number' || !Number.isInteger(a.attributeId) || a.attributeId <= 0) { errors.push('attributeId — целое > 0'); continue }
    const complexId = a.complexId === undefined ? 0 : a.complexId
    if (typeof complexId !== 'number' || !Number.isInteger(complexId) || complexId < 0) { errors.push('complexId — целое ≥ 0'); continue }
    if (!Array.isArray(a.values) || a.values.length === 0 || a.values.length > 100) { errors.push(`Атрибут ${a.attributeId}: нужно 1…100 значений`); continue }
    const values: OzonAttributeValue[] = []
    let valuesOk = true
    for (const v of a.values) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { valuesOk = false; break }
      const vv = v as Record<string, unknown>
      const hasDict = typeof vv.dictionaryValueId === 'number' && Number.isInteger(vv.dictionaryValueId) && vv.dictionaryValueId > 0
      const hasText = typeof vv.value === 'string' && vv.value.trim().length > 0 && vv.value.length <= 4096
      if (hasDict === hasText) { valuesOk = false; break } // ровно одно из двух
      values.push(hasDict ? { dictionaryValueId: vv.dictionaryValueId as number } : { value: (vv.value as string).trim() })
    }
    if (!valuesOk) { errors.push(`Атрибут ${a.attributeId}: каждое значение — либо dictionaryValueId>0, либо непустой value`); continue }
    out.push({ attributeId: a.attributeId, complexId, values })
  }
  return errors.length ? undefined : out
}

/** Валидирует технические поля профиля. offer_id и ozon-ids менять нельзя — здесь их нет. */
export function validateOzonProfileInput(input: unknown): { value?: ValidatedOzonProfileInput; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['Некорректное тело запроса'] }
  const raw = input as Record<string, unknown>
  const value: ValidatedOzonProfileInput = {}
  const allowed = new Set(['enabled', 'fbsStockQuantity', 'descriptionCategoryId', 'typeId', 'barcode', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'attributes', 'complianceStatus', 'complianceNote'])
  for (const key of Object.keys(raw)) if (!allowed.has(key)) return { errors: [`Неизвестное поле: ${key}`] }

  if (raw.enabled !== undefined) { if (typeof raw.enabled !== 'boolean') errors.push('enabled должно быть boolean'); else value.enabled = raw.enabled }
  if (raw.fbsStockQuantity !== undefined) {
    if (typeof raw.fbsStockQuantity !== 'number' || !Number.isInteger(raw.fbsStockQuantity) || raw.fbsStockQuantity < 0) errors.push('FBS-остаток — целое число ≥ 0')
    else value.fbsStockQuantity = raw.fbsStockQuantity
  }
  // Категория — пара: либо обе заданы (положительные), либо обе очищены.
  const catProvided = 'descriptionCategoryId' in raw || 'typeId' in raw
  if (catProvided) {
    const cat = raw.descriptionCategoryId ?? null
    const type = raw.typeId ?? null
    if (cat === null && type === null) { value.descriptionCategoryId = null; value.typeId = null }
    else if (typeof cat === 'number' && Number.isInteger(cat) && cat > 0 && typeof type === 'number' && Number.isInteger(type) && type > 0) { value.descriptionCategoryId = cat; value.typeId = type }
    else errors.push('descriptionCategoryId и typeId задаются парой положительных целых (или очищаются вместе)')
  }
  if (raw.barcode !== undefined) {
    if (raw.barcode === null) value.barcode = null
    else if (typeof raw.barcode !== 'string' || !raw.barcode.trim() || raw.barcode.trim().length > 64) errors.push('Штрихкод — до 64 символов')
    else value.barcode = raw.barcode.trim()
  }
  const weight = posIntOrNull(raw.weightGrams, 'Вес (г)', errors, MAX_WEIGHT_G); if (weight !== undefined) value.weightGrams = weight
  const length = posIntOrNull(raw.lengthMm, 'Длина (мм)', errors, MAX_DIMENSION_MM); if (length !== undefined) value.lengthMm = length
  const width = posIntOrNull(raw.widthMm, 'Ширина (мм)', errors, MAX_DIMENSION_MM); if (width !== undefined) value.widthMm = width
  const height = posIntOrNull(raw.heightMm, 'Высота (мм)', errors, MAX_DIMENSION_MM); if (height !== undefined) value.heightMm = height
  if (raw.attributes !== undefined) { const a = validateAttributes(raw.attributes, errors); if (a !== undefined) value.attributes = a }
  if (raw.complianceStatus !== undefined) { if (!COMPLIANCE.includes(raw.complianceStatus as OzonComplianceStatus)) errors.push('Некорректный статус готовности'); else value.complianceStatus = raw.complianceStatus as OzonComplianceStatus }
  if (raw.complianceNote !== undefined) {
    if (raw.complianceNote === null) value.complianceNote = null
    else if (typeof raw.complianceNote !== 'string' || raw.complianceNote.length > 2000) errors.push('Заметка готовности — до 2000 символов')
    else value.complianceNote = raw.complianceNote.trim() || null
  }
  return errors.length ? { errors } : { value, errors }
}

// ── URL изображений (только https + собственный домен; localhost запрещён) ─────
export class OzonImageError extends Error { constructor(message: string) { super(message); this.name = 'OzonImageError' } }

/** Публичные HTTPS-URL изображений для Ozon из NEXT_PUBLIC_BASE_URL. Бросает на
 *  localhost/не-https — серверы Ozon не достанут такие адреса. SSRF невозможен:
 *  принимаем только имена файлов из product_images, домен фиксирован базой. */
export function buildOzonImageUrls(baseUrl: string | undefined, filenames: string[]): string[] {
  const base = (baseUrl ?? '').trim()
  let url: URL
  try { url = new URL(base) } catch { throw new OzonImageError('NEXT_PUBLIC_BASE_URL не задан или некорректен') }
  if (url.protocol !== 'https:') throw new OzonImageError('Изображения для Ozon требуют HTTPS NEXT_PUBLIC_BASE_URL')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) throw new OzonImageError('На localhost синхронизация изображений с Ozon недоступна')
  const origin = url.origin
  return filenames.map((f) => `${origin}/uploads/products/${f.replace(/^\/+/, '')}`)
}

// ── Readiness ────────────────────────────────────────────────────────────────
export type ReadinessContext = {
  enabled: boolean
  name: string | null
  description: string | null
  effectivePriceKopecks: number
  imageCount: number
  profile: Pick<OzonProfile, 'descriptionCategoryId' | 'typeId' | 'barcode' | 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm' | 'attributes' | 'ozonProductId' | 'complianceStatus'>
  warehouseId: number | null
  baseUrl: string | undefined
  /** Обязательные attribute_id выбранной категории Ozon (если доступны read-only). */
  requiredAttributeIds?: number[]
}

/** Список ошибок готовности. Пустой — товар можно отправить в Ozon. Подключение к
 *  «Ozon Логистика и Select» и API-скрытие в readiness НЕ входят. */
export function computeReadiness(ctx: ReadinessContext): string[] {
  const errors: string[] = []
  const p = ctx.profile
  if (!ctx.enabled) errors.push('Профиль Ozon выключен')
  if (!ctx.name || !ctx.name.trim()) errors.push('Не заполнено название')
  if (!ctx.description || !ctx.description.trim()) errors.push('Не заполнено описание')
  if (!(ctx.effectivePriceKopecks > 0)) errors.push('Не задана цена')
  if (ctx.imageCount < 1) errors.push('Нужно хотя бы одно изображение')
  if (p.descriptionCategoryId == null || p.typeId == null) errors.push('Не выбрана категория Ozon (description_category_id + type_id)')
  if (!p.attributes || p.attributes.length === 0) errors.push('Не заполнены обязательные атрибуты категории')
  else if (ctx.requiredAttributeIds && ctx.requiredAttributeIds.length) {
    const present = new Set(p.attributes.map((a) => a.attributeId))
    const missing = ctx.requiredAttributeIds.filter((id) => !present.has(id))
    if (missing.length) errors.push(`Не заполнены обязательные атрибуты: ${missing.join(', ')}`)
  }
  // Штрихкод: первый import новой карточки допускается без него (Ozon генерирует
  // сам); каждый последующий import требует сохранённый/введённый штрихкод.
  if (p.ozonProductId != null && !p.barcode) errors.push('Для повторного import нужен штрихкод')
  if (p.weightGrams == null) errors.push('Не задан вес')
  if (p.lengthMm == null || p.widthMm == null || p.heightMm == null) errors.push('Не заданы все три габарита (Д×Ш×В)')
  if (ctx.warehouseId == null) errors.push('Не выбран FBS-склад Ozon')
  try { buildOzonImageUrls(ctx.baseUrl, ['probe.jpg']) } catch (e) { errors.push(e instanceof OzonImageError ? e.message : 'Некорректный NEXT_PUBLIC_BASE_URL') }
  if (p.complianceStatus !== 'ready') errors.push('Не подтверждена готовность к модерации (сертификат/декларация в ЛК)')
  return errors
}

// ── Import payload (детерминированный, из данных сайта) ───────────────────────
export type ImportPayloadInput = {
  offerId: string
  name: string
  description: string
  descriptionCategoryId: number
  typeId: number
  attributes: OzonAttribute[]
  imageUrls: string[]
  priceRubles: string
  weightGrams: number
  lengthMm: number
  widthMm: number
  heightMm: number
  barcode: string | null
}

/** Детерминированный item для /v3/product/import. Видимость не передаётся:
 *  приложение не скрывает и не публикует карточку — это делает оператор в ЛК. */
export function buildImportItem(input: ImportPayloadInput): Record<string, unknown> {
  const item: Record<string, unknown> = {
    offer_id: input.offerId,
    name: input.name,
    description: input.description,
    description_category_id: input.descriptionCategoryId,
    type_id: input.typeId,
    attributes: input.attributes.map((a) => ({
      id: a.attributeId,
      complex_id: a.complexId,
      values: a.values.map((v) => (v.dictionaryValueId != null ? { dictionary_value_id: v.dictionaryValueId } : { value: v.value })),
    })),
    images: input.imageUrls,
    price: input.priceRubles,
    currency_code: 'RUB',
    weight: input.weightGrams,
    weight_unit: 'g',
    height: input.heightMm,
    width: input.widthMm,
    depth: input.lengthMm,
    dimension_unit: 'mm',
  }
  if (input.barcode) item.barcode = input.barcode
  return item
}

// ── Предикаты состояния (state machine) ──────────────────────────────────────
/** Карточку можно (пере)импортировать по кнопке оператора: enabled и не в работе. */
export function canImport(profile: Pick<OzonProfile, 'enabled' | 'remoteState'>): boolean {
  return profile.enabled && profile.remoteState !== 'pending'
}
/** Подтвердить ручное скрытие можно только после успешной модерации. */
export function canConfirmHidden(profile: Pick<OzonProfile, 'remoteState'>): boolean {
  return profile.remoteState === 'awaiting_manual_hide'
}
/** Ненулевой FBS-остаток допустим только для подтверждённо скрытой enabled-карточки. */
export function canSetNonZeroStock(profile: Pick<OzonProfile, 'enabled' | 'remoteState' | 'manualHiddenConfirmedAt'>): boolean {
  return profile.enabled && profile.remoteState === 'hidden_confirmed' && profile.manualHiddenConfirmedAt != null
}
/** Профиль ждёт read-only проверки модерации. */
export function isAwaitingModeration(profile: Pick<OzonProfile, 'remoteState'>): boolean {
  return profile.remoteState === 'awaiting_moderation'
}

// ── Слой БД ──────────────────────────────────────────────────────────────────
type ProfileRow = {
  product_id: number; enabled: boolean; offer_id: string; fbs_stock_quantity: number | string
  description_category_id: string | number | null; type_id: string | number | null; barcode: string | null
  weight_grams: number | string | null; length_mm: number | string | null; width_mm: number | string | null; height_mm: number | string | null
  attributes_json: unknown; ozon_product_id: string | number | null; import_task_id: string | null
  remote_state: OzonRemoteState; moderation_status: string | null
  content_synced_at: Date | string | null; stock_synced_at: Date | string | null
  moderation_started_at: Date | string | null; last_moderation_checked_at: Date | string | null
  manual_hidden_confirmed_at: Date | string | null; manual_hidden_confirmed_by_login_at: string | number | null
  hidden_verified_at: Date | string | null; hidden_verification_method: HiddenVerificationMethod | null
  content_dirty: boolean; stock_dirty: boolean; last_stock_sent_quantity: number | string
  compliance_status: OzonComplianceStatus; compliance_note: string | null
  last_error_code: string | null; last_error_message: string | null
  created_at: Date | string; updated_at: Date | string
}
const PROFILE_COLS = `product_id, enabled, offer_id, fbs_stock_quantity, description_category_id, type_id, barcode,
  weight_grams, length_mm, width_mm, height_mm, attributes_json, ozon_product_id, import_task_id, remote_state,
  moderation_status, content_synced_at, stock_synced_at, moderation_started_at, last_moderation_checked_at,
  manual_hidden_confirmed_at, manual_hidden_confirmed_by_login_at, hidden_verified_at, hidden_verification_method,
  content_dirty, stock_dirty, last_stock_sent_quantity, compliance_status, compliance_note, last_error_code, last_error_message,
  created_at, updated_at`

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null)
const numOrNull = (v: string | number | null) => (v == null ? null : Number(v))

export function mapProfileRow(row: ProfileRow): OzonProfile {
  const attrs = Array.isArray(row.attributes_json) ? (row.attributes_json as OzonAttribute[]) : []
  return {
    productId: row.product_id, enabled: row.enabled, offerId: row.offer_id, fbsStockQuantity: Number(row.fbs_stock_quantity),
    descriptionCategoryId: numOrNull(row.description_category_id), typeId: numOrNull(row.type_id), barcode: row.barcode,
    weightGrams: numOrNull(row.weight_grams), lengthMm: numOrNull(row.length_mm), widthMm: numOrNull(row.width_mm), heightMm: numOrNull(row.height_mm),
    attributes: attrs, ozonProductId: numOrNull(row.ozon_product_id), importTaskId: row.import_task_id,
    remoteState: row.remote_state, moderationStatus: row.moderation_status,
    contentSyncedAt: iso(row.content_synced_at), stockSyncedAt: iso(row.stock_synced_at),
    moderationStartedAt: iso(row.moderation_started_at), lastModerationCheckedAt: iso(row.last_moderation_checked_at),
    manualHiddenConfirmedAt: iso(row.manual_hidden_confirmed_at), manualHiddenConfirmedByLoginAt: numOrNull(row.manual_hidden_confirmed_by_login_at),
    hiddenVerifiedAt: iso(row.hidden_verified_at), hiddenVerificationMethod: row.hidden_verification_method,
    contentDirty: row.content_dirty, stockDirty: row.stock_dirty, lastStockSentQuantity: Number(row.last_stock_sent_quantity),
    complianceStatus: row.compliance_status, complianceNote: row.compliance_note,
    lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export async function getOzonProfile(productId: number): Promise<OzonProfile | undefined> {
  if (!isDbConfigured()) return undefined
  const rows = await query<ProfileRow>(`SELECT ${PROFILE_COLS} FROM ozon_product_profiles WHERE product_id = $1`, [productId])
  return rows[0] ? mapProfileRow(rows[0]) : undefined
}

/** Профиль для товара, создавая дефолтную строку с серверным offer_id при первом обращении. */
export async function ensureOzonProfile(productId: number): Promise<OzonProfile> {
  return withTransaction(async (client) => ensureProfileTx(client, productId))
}
async function ensureProfileTx(client: PoolClient, productId: number): Promise<OzonProfile> {
  const inserted = await client.query<ProfileRow>(
    `INSERT INTO ozon_product_profiles (product_id, offer_id) VALUES ($1, $2)
     ON CONFLICT (product_id) DO NOTHING RETURNING ${PROFILE_COLS}`,
    [productId, offerIdFor(productId)],
  )
  if (inserted.rows[0]) return mapProfileRow(inserted.rows[0])
  const existing = await client.query<ProfileRow>(`SELECT ${PROFILE_COLS} FROM ozon_product_profiles WHERE product_id = $1`, [productId])
  return mapProfileRow(existing.rows[0])
}

// Поля, изменение которых сбрасывает подтверждение скрытия и требует нового import.
type ContentField = 'descriptionCategoryId' | 'typeId' | 'barcode' | 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm' | 'attributes'

/**
 * Сохранить технические поля профиля под row-lock. Любое изменение import-контента
 * сбрасывает manual_hidden_confirmed_* / hidden_verified_* и ставит content_dirty +
 * stock_dirty (ненулевой остаток нельзя восстановить до повторного скрытия). Смена
 * только fbsStockQuantity ставит лишь stock_dirty. enabled=false → disabled;
 * повторное enable disabled-профиля → not_synced с очисткой подтверждения.
 */
export async function updateOzonProfileFields(productId: number, input: ValidatedOzonProfileInput): Promise<OzonProfile | undefined> {
  if (!isDbConfigured()) return undefined
  return withTransaction(async (client) => {
    const current = (await client.query<ProfileRow>(`SELECT ${PROFILE_COLS} FROM ozon_product_profiles WHERE product_id = $1 FOR UPDATE`, [productId])).rows[0]
    let profile = current ? mapProfileRow(current) : await ensureProfileTx(client, productId)

    const sets: string[] = []
    const params: unknown[] = []
    const add = (col: string, value: unknown) => { params.push(value); sets.push(`${col} = $${params.length}`) }

    const contentChanged = (['descriptionCategoryId', 'typeId', 'barcode', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'attributes'] as ContentField[])
      .some((k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(profile[k]))
    const stockChanged = input.fbsStockQuantity !== undefined && input.fbsStockQuantity !== profile.fbsStockQuantity

    if (input.fbsStockQuantity !== undefined) add('fbs_stock_quantity', input.fbsStockQuantity)
    if (input.descriptionCategoryId !== undefined) add('description_category_id', input.descriptionCategoryId)
    if (input.typeId !== undefined) add('type_id', input.typeId)
    if (input.barcode !== undefined) add('barcode', input.barcode)
    if (input.weightGrams !== undefined) add('weight_grams', input.weightGrams)
    if (input.lengthMm !== undefined) add('length_mm', input.lengthMm)
    if (input.widthMm !== undefined) add('width_mm', input.widthMm)
    if (input.heightMm !== undefined) add('height_mm', input.heightMm)
    if (input.attributes !== undefined) add('attributes_json', JSON.stringify(input.attributes))
    if (input.complianceStatus !== undefined) add('compliance_status', input.complianceStatus)
    if (input.complianceNote !== undefined) add('compliance_note', input.complianceNote)

    // enabled-переходы.
    if (input.enabled !== undefined && input.enabled !== profile.enabled) {
      add('enabled', input.enabled)
      if (!input.enabled) { add('remote_state', 'disabled'); add('stock_dirty', true) }
      else { // повторное включение: новый цикл import с 0 → модерация → ручное скрытие
        add('remote_state', 'not_synced')
        add('content_dirty', true); add('stock_dirty', true)
        add('manual_hidden_confirmed_at', null); add('manual_hidden_confirmed_by_login_at', null)
        add('hidden_verified_at', null); add('hidden_verification_method', null)
      }
    }
    if (contentChanged) {
      add('content_dirty', true); add('stock_dirty', true)
      add('manual_hidden_confirmed_at', null); add('manual_hidden_confirmed_by_login_at', null)
      add('hidden_verified_at', null); add('hidden_verification_method', null)
    } else if (stockChanged) {
      add('stock_dirty', true)
    }
    if (!sets.length) return profile
    params.push(productId)
    const updated = await client.query<ProfileRow>(`UPDATE ozon_product_profiles SET ${sets.join(', ')} WHERE product_id = $${params.length} RETURNING ${PROFILE_COLS}`, params)
    profile = mapProfileRow(updated.rows[0])
    return profile
  })
}
