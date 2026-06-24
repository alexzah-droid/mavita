// Шифрование секретов перевозчиков (ключи API СДЭК) для хранения в БД.
// Мастер-ключ SETTINGS_ENC_KEY живёт только в .env — без него дамп БД бесполезен.
//
// Формат шифртекста (один BYTEA): version(1) | iv(12) | authTag(16) | ciphertext.
// - version — первый байт (0x01), позволяет сменить схему без неоднозначности при
//   чтении старых значений.
// - AAD = "<carrier>:<field>" привязывает шифртекст к назначению: GCM проверит его
//   при расшифровке, поэтому шифртекст одного поля нельзя подставить в другое.
//
// Это серверный модуль: его импортируют только серверные слои (store-settings,
// провайдеры, API-route), но не Client Component. Открытый секрет наружу не уходит.

// ВНУТРЕННИЙ crypto-core. Приложение импортирует guarded-обёртку '@/lib/secret-box'
// (server-only). Этот core без guard нужен ТОЛЬКО операционным CLI-скриптам
// (backfill/rotate) под tsx, который не понимает react-server-условие экспорта.
//
// Runtime-страховка: если этот модуль случайно окажется в клиентском бандле и
// выполнится в браузере — падаем сразу, а не молча расшифровываем на клиенте.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

if (typeof window !== 'undefined') throw new Error('secret-box-core нельзя импортировать в клиентский код')

const VERSION = 0x01
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Мастер-ключ из SETTINGS_ENC_KEY. Декодированная длина — РОВНО 32 байта (AES-256),
 * не «≥32 символа» (это про SESSION_SECRET — длину строки, а не ключа). Принимаем
 * строго 64 hex-символа либо canonical base64.
 */
export function settingsEncKey(): Buffer {
  if (!process.env.SETTINGS_ENC_KEY?.trim()) throw new Error('SETTINGS_ENC_KEY must be set to manage delivery carrier secrets')
  return parseEncKey(process.env.SETTINGS_ENC_KEY, 'SETTINGS_ENC_KEY')
}

/** Проверка наличия и формата ключа при старте (fail-fast, как assertAuthConfig). */
export function assertSettingsEncKey(): void { settingsEncKey() }

/**
 * Зашифровать секрет с привязкой к назначению (aad = "<carrier>:<field>").
 * `key` явно передаётся только при ротации мастер-ключа; по умолчанию SETTINGS_ENC_KEY.
 */
export function encryptSecret(plain: string, aad: string, key: Buffer = settingsEncKey()): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext])
}

/** Расшифровать; бросает при неверном tag/version/aad или повреждённом буфере. */
export function decryptSecret(buf: Buffer, aad: string, key: Buffer = settingsEncKey()): string {
  if (!Buffer.isBuffer(buf) || buf.length < 1 + IV_LEN + TAG_LEN) throw new Error('Malformed secret ciphertext')
  if (buf[0] !== VERSION) throw new Error(`Unsupported secret ciphertext version ${buf[0]}`)
  const iv = buf.subarray(1, 1 + IV_LEN)
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(1 + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Разобрать мастер-ключ из произвольной строки (для ротации: OLD/NEW из env). */
export function parseEncKey(raw: string | undefined, label = 'key'): Buffer {
  const value = raw?.trim()
  if (!value) throw new Error(`${label} must be set`)
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex')
  const buf = Buffer.from(value, 'base64')
  if (buf.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '') || buf.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes (64 hex chars or canonical base64)`)
  }
  return buf
}

/** Маска для UI: '••••' + последние 4 символа. Открытый секрет не показываем. */
export function maskSecret(plain: string): string {
  const tail = plain.slice(-4)
  return `••••${tail}`
}
