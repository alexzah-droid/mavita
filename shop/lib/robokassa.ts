import { createHash, timingSafeEqual } from 'crypto'

export function isRobokassaConfigured(): boolean {
  return !!(
    process.env.ROBOKASSA_LOGIN &&
    process.env.ROBOKASSA_PASSWORD1 &&
    process.env.ROBOKASSA_PASSWORD2
  )
}

// Node поддерживает эти алгоритмы; должны совпадать с настройкой «Хэш-алгоритм»
// в ЛК Робокассы (TD-20). MD5 — дефолт Робокассы, но кабинет можно перевести на
// SHA-256/512 — тогда выставить ROBOKASSA_HASH_ALGO ОДНОВРЕМЕННО с настройкой в ЛК.
const ALLOWED_HASH_ALGOS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])

function hashAlgo(): string {
  const algo = (process.env.ROBOKASSA_HASH_ALGO ?? 'md5').toLowerCase()
  if (!ALLOWED_HASH_ALGOS.has(algo)) {
    throw new Error(
      `ROBOKASSA_HASH_ALGO="${algo}" не поддерживается (допустимо: ${[...ALLOWED_HASH_ALGOS].join(', ')})`,
    )
  }
  return algo
}

/** Подпись Робокассы в верхнем регистре hex выбранным алгоритмом (по умолчанию MD5). */
function signHex(s: string): string {
  return createHash(hashAlgo()).update(s, 'utf8').digest('hex').toUpperCase()
}

/**
 * Проверка безопасности конфигурации платежей (TD-21.1). Возвращает список
 * проблем (пусто = всё ок). Главное: в production ROBOKASSA_TEST_MODE='true'
 * означал бы оплату с IsTest=1 — заказы помечались бы paid без реального движения
 * денег. Также ловим опечатку в ROBOKASSA_HASH_ALGO до первого платежа.
 */
export function checkPaymentConfig(): string[] {
  const problems: string[] = []
  const isProd = process.env.NODE_ENV === 'production'

  // Тестовый платёж на production допустим только с отдельным явным opt-in.
  // Это позволяет подготовить витрину до старта продаж, не превращая test mode
  // в молчаливую небезопасную настройку.
  if (
    isProd &&
    process.env.ROBOKASSA_TEST_MODE === 'true' &&
    process.env.ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION !== 'true'
  ) {
    problems.push(
      'ROBOKASSA_TEST_MODE=true в production без ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION=true: платежи уходили бы с IsTest=1 и помечались оплаченными без реальных денег',
    )
  }
  if (isRobokassaConfigured()) {
    try {
      hashAlgo() // бросит при недопустимом ROBOKASSA_HASH_ALGO
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  return problems
}

/** Бросает, если конфигурация платежей небезопасна — вызывается при старте сервера. */
export function assertPaymentConfigSafe(): void {
  const problems = checkPaymentConfig()
  if (problems.length) {
    throw new Error(`Небезопасная конфигурация платежей:\n- ${problems.join('\n- ')}`)
  }
}

/** Копейки → строка с 2 знаками после запятой для параметра OutSum */
export function kopecksToOutSum(kopecks: number): string {
  return (kopecks / 100).toFixed(2)
}

/** Позиция чека (Робочеки СМЗ). Цена в копейках, как везде в проекте. */
export type ReceiptItem = { name: string; priceKopecks: number; quantity: number }

/**
 * Состав чека для фискализации (Робочеки СМЗ — самозанятый).
 * tax: 'none' — НПД не облагается НДС. payment_object/payment_method заданы явно,
 * чтобы не зависеть от дефолтов ЛК. sum — итог по позиции (цена×кол-во) в рублях.
 */
function buildReceipt(items: ReceiptItem[]): string {
  return JSON.stringify({
    items: items.map((it) => ({
      name: it.name.slice(0, 128),
      quantity: it.quantity,
      sum: Number(((it.priceKopecks * it.quantity) / 100).toFixed(2)),
      payment_method: 'full_payment',
      payment_object: 'commodity',
      tax: 'none',
    })),
  })
}

/**
 * Сформировать URL для редиректа покупателя на страницу оплаты Робокассы.
 * При включённой фискализации Receipt обязателен и входит в подпись:
 * HASH(MerchantLogin:OutSum:InvId:Receipt:Password1), где Receipt — URL-encoded JSON.
 * Инвариант: в подпись и в URL идёт ОДНА И ТА ЖЕ закодированная строка.
 */
export function buildPaymentUrl(
  invId: number,
  totalKopecks: number,
  items: ReceiptItem[],
  email?: string,
  description?: string,
): string {
  const login = process.env.ROBOKASSA_LOGIN!
  const password1 = process.env.ROBOKASSA_PASSWORD1!
  const testMode = process.env.ROBOKASSA_TEST_MODE === 'true'

  const outSum = kopecksToOutSum(totalKopecks)
  const receiptEncoded = encodeURIComponent(buildReceipt(items))
  const sig = signHex(`${login}:${outSum}:${invId}:${receiptEncoded}:${password1}`)

  const params = new URLSearchParams({
    MerchantLogin: login,
    OutSum: outSum,
    InvId: String(invId),
    SignatureValue: sig,
    Culture: 'ru',
    Encoding: 'utf-8',
  })

  if (description) params.set('Description', description.slice(0, 100))
  if (email) params.set('Email', email)
  if (testMode) params.set('IsTest', '1')

  // Receipt дописываем вручную уже в URL-encoded виде — той же строкой, что в подписи.
  // Через URLSearchParams нельзя: он повторно закодирует %-последовательности и подпись разойдётся.
  return `https://auth.robokassa.ru/Merchant/Index.aspx?${params}&Receipt=${receiptEncoded}`
}

/**
 * Проверить подпись ResultURL от Робокассы.
 * Эталон: HASH(OutSum:InvId:Password2) — алгоритм из ROBOKASSA_HASH_ALGO.
 */
export function verifyResultSignature(
  outSum: string,
  invId: string,
  signature: string,
): boolean {
  const password2 = process.env.ROBOKASSA_PASSWORD2!
  const expected = signHex(`${outSum}:${invId}:${password2}`)
  // Постоянное по времени сравнение (TD-12): не утекаем длину/совпадение префикса.
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.toUpperCase())
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Разрешён ли IP источника колбэка /result (TD-19, defense-in-depth).
 * Диапазоны берутся из ROBOKASSA_RESULT_IPS (CIDR/одиночные IP через запятую,
 * актуальный список — из ЛК/поддержки Робокассы). Если переменная пуста — проверка
 * выключена: полагаемся на подпись Password2. IPv6-mapped IPv4 (::ffff:1.2.3.4)
 * нормализуется. Только IPv4 (источники Робокассы — IPv4).
 */
export function isAllowedResultIp(ip: string | null | undefined): boolean {
  const raw = process.env.ROBOKASSA_RESULT_IPS?.trim()
  if (!raw) return true // allowlist не настроен — не блокируем
  if (!ip) return false
  const addr = normalizeIp(ip)
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((cidr) => ipInCidr(addr, cidr))
}

function normalizeIp(ip: string): string {
  const t = ip.trim()
  return t.startsWith('::ffff:') ? t.slice(7) : t
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1, 5).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  const bits = bitsStr === undefined ? 32 : Number(bitsStr)
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null) return false
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}
