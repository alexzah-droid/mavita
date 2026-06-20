import { createHash, timingSafeEqual } from 'crypto'

export function isRobokassaConfigured(): boolean {
  return !!(
    process.env.ROBOKASSA_LOGIN &&
    process.env.ROBOKASSA_PASSWORD1 &&
    process.env.ROBOKASSA_PASSWORD2
  )
}

function md5hex(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex').toUpperCase()
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
 * MD5(MerchantLogin:OutSum:InvId:Receipt:Password1), где Receipt — URL-encoded JSON.
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
  const sig = md5hex(`${login}:${outSum}:${invId}:${receiptEncoded}:${password1}`)

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
 * Эталон: MD5(OutSum:InvId:Password2)
 */
export function verifyResultSignature(
  outSum: string,
  invId: string,
  signature: string,
): boolean {
  const password2 = process.env.ROBOKASSA_PASSWORD2!
  const expected = md5hex(`${outSum}:${invId}:${password2}`)
  // Постоянное по времени сравнение (TD-12): не утекаем длину/совпадение префикса.
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.toUpperCase())
  return a.length === b.length && timingSafeEqual(a, b)
}
