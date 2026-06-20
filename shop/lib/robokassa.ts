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

/**
 * Сформировать URL для редиректа покупателя на страницу оплаты Робокассы.
 * Подпись: MD5(MerchantLogin:OutSum:InvId:Password1)
 */
export function buildPaymentUrl(
  invId: number,
  totalKopecks: number,
  email?: string,
  description?: string,
): string {
  const login = process.env.ROBOKASSA_LOGIN!
  const password1 = process.env.ROBOKASSA_PASSWORD1!
  const testMode = process.env.ROBOKASSA_TEST_MODE === 'true'

  const outSum = kopecksToOutSum(totalKopecks)
  const sig = md5hex(`${login}:${outSum}:${invId}:${password1}`)

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

  return `https://auth.robokassa.ru/Merchant/Index.aspx?${params}`
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
