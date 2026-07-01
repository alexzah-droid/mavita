// Fail-fast проверки конфигурации — ЕДИНСТВЕННЫЙ источник правды и для
// instrumentation.ts, и для серверных модулей (lib/auth, lib/robokassa, secret-box).
// Раньше instrumentation дублировал их вручную, и любое ужесточение проверки в lib/*
// легко было забыть продублировать.
//
// ВАЖНО: instrumentation.ts собирается и для Edge runtime, поэтому сюда нельзя
// импортировать node:crypto / iron-session / server-only. Buffer в edge есть.

type Env = Record<string, string | undefined>

/** ADMIN_PASSWORD + SESSION_SECRET (длина строки ≥32 символов). Пусто = ок. */
export function authConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = []
  if (!env.ADMIN_PASSWORD?.trim()) problems.push('ADMIN_PASSWORD must be set')
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET must contain at least 32 characters')
  return problems
}

// Node поддерживает эти алгоритмы; должны совпадать с настройкой «Хэш-алгоритм»
// в ЛК Робокассы (TD-20). MD5 — дефолт Робокассы, но кабинет можно перевести на
// SHA-256/512 — тогда выставить ROBOKASSA_HASH_ALGO ОДНОВРЕМЕННО с настройкой в ЛК.
export const ROBOKASSA_ALLOWED_HASH_ALGOS: readonly string[] = ['md5', 'sha1', 'sha256', 'sha384', 'sha512']

/** Алгоритм подписи Робокассы из env. Бросает при недопустимом значении. */
export function robokassaHashAlgo(env: Env = process.env): string {
  const algo = (env.ROBOKASSA_HASH_ALGO ?? 'md5').toLowerCase()
  if (!ROBOKASSA_ALLOWED_HASH_ALGOS.includes(algo)) {
    throw new Error(
      `ROBOKASSA_HASH_ALGO="${algo}" не поддерживается (допустимо: ${ROBOKASSA_ALLOWED_HASH_ALGOS.join(', ')})`,
    )
  }
  return algo
}

/**
 * Проверка безопасности конфигурации платежей (TD-21.1). Главное: в production
 * ROBOKASSA_TEST_MODE='true' означал бы оплату с IsTest=1 — заказы помечались бы
 * paid без реального движения денег. Также ловим опечатку в ROBOKASSA_HASH_ALGO
 * до первого платежа.
 */
export function paymentConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = []
  const isProd = env.NODE_ENV === 'production'

  // Тестовый платёж на production допустим только с отдельным явным opt-in.
  if (
    isProd &&
    env.ROBOKASSA_TEST_MODE === 'true' &&
    env.ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION !== 'true'
  ) {
    problems.push(
      'ROBOKASSA_TEST_MODE=true в production без ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION=true: платежи уходили бы с IsTest=1 и помечались оплаченными без реальных денег',
    )
  }
  if (env.ROBOKASSA_LOGIN && env.ROBOKASSA_PASSWORD1 && env.ROBOKASSA_PASSWORD2) {
    try {
      robokassaHashAlgo(env) // бросит при недопустимом ROBOKASSA_HASH_ALGO
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  return problems
}

/**
 * Разобрать мастер-ключ шифрования настроек (SETTINGS_ENC_KEY и его ротационные
 * варианты). Декодированная длина — РОВНО 32 байта (AES-256): строго 64 hex-символа
 * либо canonical base64 (Buffer.from('base64') игнорирует мусор — сверяем round-trip).
 */
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

/**
 * SETTINGS_ENC_KEY не обязателен (доставка может быть выключена), но если задан —
 * должен разбираться parseEncKey, иначе кривой ключ доживёт до первой расшифровки.
 */
export function settingsEncKeyProblems(env: Env = process.env): string[] {
  const raw = env.SETTINGS_ENC_KEY?.trim()
  if (!raw) return []
  try {
    parseEncKey(raw, 'SETTINGS_ENC_KEY')
    return []
  } catch (e) {
    return [(e as Error).message]
  }
}
