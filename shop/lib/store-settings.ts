// Настройки доставки: мульти-перевозчик (СДЭК, Ozon). Секреты ключей хранятся
// ШИФРОВАННЫМИ в БД (lib/secret-box.ts); открытый ключ наружу не уходит.
//
// Три уровня доступа к ключам:
//  - getDeliverySettings()   — админка: маска/статус, БЕЗ открытого секрета.
//  - getRuntimeCredentials() — рантайм/checkout: расшифровка, ТОЛЬКО для enabled.
//  - getStoredCredentials()  — «Проверить связь»: расшифровка независимо от enabled.
//
// resolveDeliveryMode() — единая семантика включения (disabled/pickup_required/error).
// Fail closed: включённый, но невидимо сломанный перевозчик → error (503), а не
// тихий заказ без ПВЗ. Серверный модуль — Client Component его не импортирует.

import 'server-only' // расшифровывает секреты перевозчиков: только серверные слои
import { createHash } from 'node:crypto'
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/secret-box'
import { isOzonCatalogFresh } from '@/lib/ozon-catalog'

export type Carrier = 'cdek' | 'ozon'
export const CARRIERS: Carrier[] = ['cdek', 'ozon']
export const CARRIER_LABEL: Record<Carrier, string> = { cdek: 'СДЭК', ozon: 'ОЗОН' }
export const PICKUP_METHOD: Record<Carrier, 'cdek_pickup' | 'ozon_pickup'> = { cdek: 'cdek_pickup', ozon: 'ozon_pickup' }
export function carrierFromMethod(method: string): Carrier | undefined {
  return method === 'cdek_pickup' ? 'cdek' : method === 'ozon_pickup' ? 'ozon' : undefined
}

export type CarrierSettings = { enabled: boolean; hasSecret: boolean; secretMask: string | null; clientId: string | null; deliveryKopecks: number | null }
export type DeliverySettings = { carriers: Record<Carrier, CarrierSettings>; updatedAt: string | null; updatedByActorLoginAt: number | null }

export type DeliveryMode = 'disabled' | 'pickup_required' | 'error'
export type ActiveCarrier = { carrier: Carrier; deliveryKopecks: number }
export type DeliveryResolution = { mode: DeliveryMode; carriers: ActiveCarrier[] }
export type RuntimeCredentials = { clientId: string; secret: string; fingerprint: string }

/** Включённый перевозчик настроен неполно/не расшифровывается → checkout = 503. */
export class DeliveryConfigurationError extends Error {
  constructor(message = 'Перевозчик настроен некорректно') { super(message); this.name = 'DeliveryConfigurationError' }
}

// ── Описание колонок и AAD по перевозчику (внутренние константы, безопасны для SQL) ──
type CarrierDesc = { enabledCol: string; tariffCol: string; idCol: string; encCol: string; aad: string }
const DESC: Record<Carrier, CarrierDesc> = {
  cdek: { enabledCol: 'cdek_pickup_enabled', tariffCol: 'cdek_pickup_delivery_kopecks', idCol: 'cdek_client_id', encCol: 'cdek_client_secret_enc', aad: 'cdek:client_secret' },
  ozon: { enabledCol: 'ozon_pickup_enabled', tariffCol: 'ozon_pickup_delivery_kopecks', idCol: 'ozon_client_id', encCol: 'ozon_api_key_enc', aad: 'ozon:api_key' },
}

type SettingsRow = {
  cdek_pickup_enabled: boolean; cdek_pickup_delivery_kopecks: number | string | null; cdek_client_id: string | null; cdek_client_secret_enc: Buffer | null
  ozon_pickup_enabled: boolean; ozon_pickup_delivery_kopecks: number | string | null; ozon_client_id: string | null; ozon_api_key_enc: Buffer | null
  updated_at: Date | string; updated_by_actor_login_at: number | string
}
const ALL_COLS = 'cdek_pickup_enabled, cdek_pickup_delivery_kopecks, cdek_client_id, cdek_client_secret_enc, ozon_pickup_enabled, ozon_pickup_delivery_kopecks, ozon_client_id, ozon_api_key_enc, updated_at, updated_by_actor_login_at'

function rawEnabled(row: SettingsRow, c: Carrier): boolean { return Boolean(row[DESC[c].enabledCol as keyof SettingsRow]) }
function rawClientId(row: SettingsRow, c: Carrier): string | null { const v = row[DESC[c].idCol as keyof SettingsRow]; return typeof v === 'string' ? v : null }
function rawEnc(row: SettingsRow, c: Carrier): Buffer | null { const v = row[DESC[c].encCol as keyof SettingsRow]; return Buffer.isBuffer(v) ? v : null }
function rawTariff(row: SettingsRow, c: Carrier): number | null { const v = row[DESC[c].tariffCol as keyof SettingsRow]; return v == null ? null : Number(v) }

function fingerprint(clientId: string, secret: string): string { return createHash('sha256').update(`${clientId}:${secret}`).digest('hex') }

/** Расшифровать credentials перевозчика из строки. Бросает при ошибке расшифровки. */
function decryptCredentials(row: SettingsRow, c: Carrier): RuntimeCredentials {
  const clientId = rawClientId(row, c); const enc = rawEnc(row, c)
  if (!clientId || !enc) throw new DeliveryConfigurationError(`Ключи ${CARRIER_LABEL[c]} не заданы`)
  const secret = decryptSecret(enc, DESC[c].aad)
  return { clientId, secret, fingerprint: fingerprint(clientId, secret) }
}

// ── DTO для админки (маски, без открытого секрета) ───────────────────────────
function carrierDto(row: SettingsRow | null, c: Carrier): CarrierSettings {
  if (!row) return { enabled: false, hasSecret: false, secretMask: null, clientId: null, deliveryKopecks: null }
  const enc = rawEnc(row, c)
  let secretMask: string | null = null
  if (enc) { try { secretMask = maskSecret(decryptSecret(enc, DESC[c].aad)) } catch { secretMask = null } }
  return { enabled: rawEnabled(row, c), hasSecret: Boolean(enc), secretMask, clientId: rawClientId(row, c), deliveryKopecks: rawTariff(row, c) }
}
function settingsDto(row: SettingsRow | null): DeliverySettings {
  return {
    carriers: { cdek: carrierDto(row, 'cdek'), ozon: carrierDto(row, 'ozon') },
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    updatedByActorLoginAt: row ? Number(row.updated_by_actor_login_at) : null,
  }
}

async function readRow(): Promise<SettingsRow | null> {
  const rows = await query<SettingsRow>(`SELECT ${ALL_COLS} FROM store_settings WHERE singleton = true`)
  return rows[0] ?? null
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  if (!isDbConfigured()) return settingsDto(null)
  return settingsDto(await readRow())
}

// ── Резолвер режима доставки (чистая функция над строкой + аварийный флаг) ────
function emergencyOff(): boolean { return process.env.DELIVERY_ENABLED === 'false' }

/** Вычислить режим из уже прочитанной строки. error, если включённый перевозчик сломан. */
function resolveFromRow(row: SettingsRow | null): DeliveryResolution {
  if (emergencyOff()) return { mode: 'disabled', carriers: [] }
  if (!row) return { mode: 'disabled', carriers: [] }
  const active: ActiveCarrier[] = []
  for (const c of CARRIERS) {
    if (!rawEnabled(row, c)) continue
    const tariff = rawTariff(row, c)
    if (rawClientId(row, c) == null || rawEnc(row, c) == null || tariff == null) return { mode: 'error', carriers: [] }
    try { decryptCredentials(row, c) } catch { return { mode: 'error', carriers: [] } }
    active.push({ carrier: c, deliveryKopecks: tariff })
  }
  return { mode: active.length ? 'pickup_required' : 'disabled', carriers: active }
}

/**
 * Режим доставки для checkout/витрины. Ошибку чтения/расшифровки не глотает —
 * она становится error (→503), а не «заказ без ПВЗ».
 */
export async function resolveDeliveryMode(): Promise<DeliveryResolution> {
  if (emergencyOff()) return { mode: 'disabled', carriers: [] }
  // Fail closed: «заказ без ПВЗ» легитимен только при глобальном выключателе или при
  // отсутствии валидных carrier в ЧИТАЕМОЙ БД. Нет DATABASE_URL = настройки прочитать
  // нельзя → error (503), а не молчаливый disabled (иначе UI обещает оплату без
  // доставки, а createOrder затем падает).
  if (!isDbConfigured()) return { mode: 'error', carriers: [] }
  let row: SettingsRow | null
  try { row = await readRow() } catch { return { mode: 'error', carriers: [] } }
  const resolution = resolveFromRow(row)
  // Ozon предлагаем покупателю, только если каталог ПВЗ свеж (успешная полная
  // синхронизация в окне). Иначе способ показался бы, но ПВЗ не нашлись бы.
  // Несвежий каталог не роняет весь checkout — лишь убирает Ozon, СДЭК остаётся.
  if (resolution.mode === 'pickup_required' && resolution.carriers.some((c) => c.carrier === 'ozon')) {
    let fresh = false
    try { fresh = await isOzonCatalogFresh() } catch { fresh = false }
    if (!fresh) {
      const carriers = resolution.carriers.filter((c) => c.carrier !== 'ozon')
      return { mode: carriers.length ? 'pickup_required' : 'disabled', carriers }
    }
  }
  return resolution
}

/**
 * Credentials для рантайма (провайдеры, checkout). Только для enabled и полностью
 * настроенного перевозчика. Выключенный → undefined; включённый, но сломанный →
 * DeliveryConfigurationError. fingerprint используется для кэша OAuth-токена.
 */
export async function getRuntimeCredentials(carrier: Carrier): Promise<RuntimeCredentials | undefined> {
  if (!isDbConfigured()) return undefined
  const row = await readRow()
  if (!row || !rawEnabled(row, carrier)) return undefined
  return decryptCredentials(row, carrier) // бросит DeliveryConfigurationError при неполноте/ошибке
}

/**
 * Сохранённые credentials НЕЗАВИСИМО от enabled — для endpoint-а «Проверить связь».
 * Серверный модуль, не вызывается из публичных route. Бросает при ошибке расшифровки.
 */
export async function getStoredCredentials(carrier: Carrier): Promise<{ clientId: string; secret: string } | undefined> {
  if (!isDbConfigured()) return undefined
  const row = await readRow()
  if (!row || rawClientId(row, carrier) == null || rawEnc(row, carrier) == null) return undefined
  const { clientId, secret } = decryptCredentials(row, carrier)
  return { clientId, secret }
}

/**
 * Снимок настроек под совместимой блокировкой строки внутри транзакции createOrder.
 * Защищает от TOCTOU: настройки нельзя поменять между проверкой ПВЗ и INSERT заказа.
 */
export type LockedDeliverySnapshot = { mode: DeliveryMode; carrier: (c: Carrier) => { deliveryKopecks: number; credentials: RuntimeCredentials } | undefined }
export async function getLockedDeliverySnapshot(client: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Promise<LockedDeliverySnapshot> {
  const row = (await client.query<SettingsRow>(`SELECT ${ALL_COLS} FROM store_settings WHERE singleton = true FOR SHARE`)).rows[0] ?? null
  let resolution = resolveFromRow(row)
  // Тот же гейт свежести, что и в resolveDeliveryMode: иначе прямой POST в init с
  // ozon_pickup после протухания каталога создал бы заказ (live re-confirm ≠ свежий
  // каталог). Снимок — авторитет создания заказа, поэтому проверяем и здесь.
  if (resolution.mode === 'pickup_required' && resolution.carriers.some((c) => c.carrier === 'ozon') && !(await isOzonCatalogFresh())) {
    const carriers = resolution.carriers.filter((c) => c.carrier !== 'ozon')
    resolution = { mode: carriers.length ? 'pickup_required' : 'disabled', carriers }
  }
  return {
    mode: resolution.mode,
    carrier: (c: Carrier) => {
      if (resolution.mode !== 'pickup_required' || !row) return undefined
      const active = resolution.carriers.find((a) => a.carrier === c)
      if (!active) return undefined
      return { deliveryKopecks: active.deliveryKopecks, credentials: decryptCredentials(row, c) }
    },
  }
}

// ── Запись настроек (атомарно, проверка ИТОГОВОГО состояния) ──────────────────
export type CarrierPatch = { enabled?: boolean; clientId?: string; secret?: string; deliveryKopecks?: number }

export async function saveCarrierSettings(carrier: Carrier, patch: CarrierPatch, actorLoginAt: number): Promise<DeliverySettings> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set')
  const d = DESC[carrier]
  return withTransaction(async (client) => {
    const current = (await client.query<SettingsRow>(`SELECT ${ALL_COLS} FROM store_settings WHERE singleton = true FOR UPDATE`)).rows[0] ?? null
    const enabled = patch.enabled ?? (current ? rawEnabled(current, carrier) : false)
    const clientId = patch.clientId !== undefined ? patch.clientId : current ? rawClientId(current, carrier) : null
    const enc = patch.secret !== undefined ? encryptSecret(patch.secret, d.aad) : current ? rawEnc(current, carrier) : null
    const tariff = patch.deliveryKopecks !== undefined ? patch.deliveryKopecks : current ? rawTariff(current, carrier) : null
    // Проверяем ИТОГ, а не отдельные поля: секрет+тариф+enabled в одном запросе ОК.
    if (enabled && (!clientId || !enc || tariff == null)) throw new DeliveryConfigurationError('Чтобы включить перевозчика — задайте ключи и тариф')
    // Ozon включается только при свежей успешной полной синхронизации каталога ПВЗ
    // (не операторское «N>0»): иначе способ доставки без рабочего поиска ПВЗ.
    if (enabled && carrier === 'ozon' && !(await isOzonCatalogFresh())) {
      throw new DeliveryConfigurationError('Включение Ozon требует свежей синхронизации каталога ПВЗ — выполните npm run delivery:sync-ozon')
    }
    const rows = await client.query<SettingsRow>(
      `INSERT INTO store_settings (singleton, ${d.enabledCol}, ${d.tariffCol}, ${d.idCol}, ${d.encCol}, updated_at, updated_by_actor_login_at)
       VALUES (true, $1, $2, $3, $4, now(), $5)
       ON CONFLICT (singleton) DO UPDATE SET
         ${d.enabledCol} = EXCLUDED.${d.enabledCol},
         ${d.tariffCol} = EXCLUDED.${d.tariffCol},
         ${d.idCol} = EXCLUDED.${d.idCol},
         ${d.encCol} = EXCLUDED.${d.encCol},
         updated_at = now(), updated_by_actor_login_at = EXCLUDED.updated_by_actor_login_at
       RETURNING ${ALL_COLS}`,
      [enabled, tariff, clientId, enc, actorLoginAt],
    )
    return settingsDto(rows.rows[0])
  })
}

/** Удалить скомпрометированные ключи: выключить + стереть id/ciphertext, тариф оставить. */
export async function clearCarrierCredentials(carrier: Carrier, actorLoginAt: number): Promise<DeliverySettings> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set')
  const d = DESC[carrier]
  return withTransaction(async (client) => {
    const rows = await client.query<SettingsRow>(
      `UPDATE store_settings SET ${d.enabledCol} = false, ${d.idCol} = NULL, ${d.encCol} = NULL, updated_at = now(), updated_by_actor_login_at = $1 WHERE singleton = true RETURNING ${ALL_COLS}`,
      [actorLoginAt],
    )
    return settingsDto(rows.rows[0] ?? null)
  })
}
