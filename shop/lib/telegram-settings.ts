import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { isDbConfigured, query, withTransaction } from '@/lib/db'

export type TelegramSettings = { enabled: boolean; chatId: string | null; configured: boolean; tokenLast4: string | null; updatedAt: string | null; lastDeliveryError: string | null; lastDeliveryErrorAt: string | null }
type Stored = { enabled: boolean; chat_id: string | null; bot_token_ciphertext: Buffer | null; bot_token_iv: Buffer | null; bot_token_auth_tag: Buffer | null; token_last4: string | null; updated_at: Date | string; last_delivery_error: string | null; last_delivery_error_at: Date | string | null }

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/
const CHAT_RE = /^-?\d{1,20}$/

export function validateTelegramToken(value: unknown): string | undefined { return typeof value === 'string' && TOKEN_RE.test(value.trim()) ? value.trim() : undefined }
export function validateTelegramChatId(value: unknown): string | undefined { return typeof value === 'string' && CHAT_RE.test(value.trim()) ? value.trim() : undefined }

function encryptionKey(): Buffer {
  const raw = process.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY
  if (!raw) throw new Error('TELEGRAM_SETTINGS_ENCRYPTION_KEY must be set to enable Telegram notifications')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('TELEGRAM_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes')
  return key
}

export function encryptTelegramToken(token: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv); return { ciphertext: Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]), iv, authTag: cipher.getAuthTag() } }
export function decryptTelegramToken(row: Pick<Stored, 'bot_token_ciphertext' | 'bot_token_iv' | 'bot_token_auth_tag'>): string {
  if (!row.bot_token_ciphertext || !row.bot_token_iv || !row.bot_token_auth_tag) throw new Error('Telegram credentials are not configured')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), row.bot_token_iv); decipher.setAuthTag(row.bot_token_auth_tag)
  return Buffer.concat([decipher.update(row.bot_token_ciphertext), decipher.final()]).toString('utf8')
}
function dto(row: Stored): TelegramSettings { return { enabled: row.enabled, chatId: row.chat_id, configured: Boolean(row.bot_token_ciphertext), tokenLast4: row.token_last4, updatedAt: new Date(row.updated_at).toISOString(), lastDeliveryError: row.last_delivery_error, lastDeliveryErrorAt: row.last_delivery_error_at ? new Date(row.last_delivery_error_at).toISOString() : null } }
const cols = 'enabled, chat_id, bot_token_ciphertext, bot_token_iv, bot_token_auth_tag, token_last4, updated_at, last_delivery_error, last_delivery_error_at'

export async function getTelegramSettings(): Promise<TelegramSettings> { if (!isDbConfigured()) return { enabled: false, chatId: null, configured: false, tokenLast4: null, updatedAt: null, lastDeliveryError: null, lastDeliveryErrorAt: null }; const rows = await query<Stored>(`SELECT ${cols} FROM telegram_notification_settings WHERE singleton = true`); return rows[0] ? dto(rows[0]) : { enabled: false, chatId: null, configured: false, tokenLast4: null, updatedAt: null, lastDeliveryError: null, lastDeliveryErrorAt: null } }
export async function getTelegramDeliveryCredentials(): Promise<{ chatId: string; token: string } | undefined> { if (!isDbConfigured()) return undefined; const rows = await query<Stored>(`SELECT ${cols} FROM telegram_notification_settings WHERE singleton = true`); const row = rows[0]; return row?.enabled && row.chat_id && row.bot_token_ciphertext ? { chatId: row.chat_id, token: decryptTelegramToken(row) } : undefined }

export async function saveTelegramSettings(input: { enabled: boolean; chatId?: string; botToken?: string }, actorLoginAt: number): Promise<TelegramSettings> {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set')
  return withTransaction(async (client) => {
    const current = (await client.query<Stored>(`SELECT ${cols} FROM telegram_notification_settings WHERE singleton = true FOR UPDATE`)).rows[0]
    const token = input.botToken ? encryptTelegramToken(input.botToken) : undefined
    const chatId = input.chatId ?? current?.chat_id ?? null
    // Эффективные значения токена: новый, иначе уже сохранённый. Кладём их прямо в
    // INSERT VALUES — иначе строка-кандидат INSERT (enabled=true + ciphertext=NULL)
    // нарушает enabled_check, а PostgreSQL проверяет CHECK на кандидате ДО разрешения
    // ON CONFLICT → UPDATE. Поэтому включение без повторного ввода токена падало.
    const ciphertext = token?.ciphertext ?? current?.bot_token_ciphertext ?? null
    const iv = token?.iv ?? current?.bot_token_iv ?? null
    const authTag = token?.authTag ?? current?.bot_token_auth_tag ?? null
    const tokenLast4 = input.botToken?.slice(-4) ?? current?.token_last4 ?? null
    const configured = Boolean(ciphertext)
    if (input.enabled && (!chatId || !configured)) throw new Error('Для включения укажите токен бота и ID чата')
    if (input.enabled) encryptionKey()
    const rows = await client.query<Stored>(
      `INSERT INTO telegram_notification_settings (singleton, enabled, chat_id, bot_token_ciphertext, bot_token_iv, bot_token_auth_tag, token_last4, updated_at, updated_by_actor_login_at)
       VALUES (true, $1, $2, $3, $4, $5, $6, now(), $7)
       ON CONFLICT (singleton) DO UPDATE SET enabled = EXCLUDED.enabled, chat_id = EXCLUDED.chat_id, bot_token_ciphertext = EXCLUDED.bot_token_ciphertext, bot_token_iv = EXCLUDED.bot_token_iv, bot_token_auth_tag = EXCLUDED.bot_token_auth_tag, token_last4 = EXCLUDED.token_last4, updated_at = now(), updated_by_actor_login_at = EXCLUDED.updated_by_actor_login_at
       RETURNING ${cols}`,
      [input.enabled, chatId, ciphertext, iv, authTag, tokenLast4, actorLoginAt],
    )
    return dto(rows.rows[0])
  })
}

export async function clearTelegramCredentials(actorLoginAt: number): Promise<void> {
  if (!isDbConfigured()) return
  await withTransaction(async (client) => {
    await client.query(`UPDATE telegram_notification_settings SET enabled = false, chat_id = NULL, bot_token_ciphertext = NULL, bot_token_iv = NULL, bot_token_auth_tag = NULL, token_last4 = NULL, updated_at = now(), updated_by_actor_login_at = $1 WHERE singleton = true`, [actorLoginAt])
    await client.query(`UPDATE order_notification_outbox SET status = 'failed', last_error = 'credentials_removed' WHERE status = 'pending'`)
  })
}

export async function recordTelegramDeliveryError(message: string, disable = false): Promise<void> { if (!isDbConfigured()) return; await query(`UPDATE telegram_notification_settings SET ${disable ? 'enabled = false,' : ''} last_delivery_error = $1, last_delivery_error_at = now() WHERE singleton = true`, [message.slice(0, 300)]) }
