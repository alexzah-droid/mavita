import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildPaymentUrl,
  verifyResultSignature,
  kopecksToOutSum,
  isRobokassaConfigured,
} from '@/lib/robokassa'

const LOGIN = 'mavita'
const PW1 = 'password_one'
const PW2 = 'password_two'

function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex').toUpperCase()
}

beforeAll(() => {
  process.env.ROBOKASSA_LOGIN = LOGIN
  process.env.ROBOKASSA_PASSWORD1 = PW1
  process.env.ROBOKASSA_PASSWORD2 = PW2
})

afterEach(() => {
  delete process.env.ROBOKASSA_TEST_MODE
})

describe('kopecksToOutSum', () => {
  it('форматирует копейки как рубли с 2 знаками', () => {
    expect(kopecksToOutSum(180000)).toBe('1800.00')
    expect(kopecksToOutSum(90050)).toBe('900.50')
    expect(kopecksToOutSum(0)).toBe('0.00')
  })
})

describe('isRobokassaConfigured', () => {
  it('true когда заданы логин и оба пароля', () => {
    expect(isRobokassaConfigured()).toBe(true)
  })
})

// I1: подпись считается на сервере как MD5(login:OutSum:InvId:Receipt:Password1).
describe('buildPaymentUrl (I1)', () => {
  const ITEMS = [{ name: 'Свеча A', priceKopecks: 180000, quantity: 1 }]
  // Извлекает Receipt в исходном (URL-encoded) виде — именно он входит в подпись.
  const rawReceipt = (rawUrl: string) => rawUrl.match(/[?&]Receipt=([^&]*)/)![1]

  it('кладёт в URL OutSum, InvId и корректную подпись на Password1 (с Receipt)', () => {
    const raw = buildPaymentUrl(5, 180000, ITEMS, 'a@b.ru', 'Заказ №5')
    const url = new URL(raw)
    expect(url.origin + url.pathname).toBe('https://auth.robokassa.ru/Merchant/Index.aspx')
    expect(url.searchParams.get('MerchantLogin')).toBe(LOGIN)
    expect(url.searchParams.get('OutSum')).toBe('1800.00')
    expect(url.searchParams.get('InvId')).toBe('5')
    expect(url.searchParams.get('SignatureValue')).toBe(
      md5(`${LOGIN}:1800.00:5:${rawReceipt(raw)}:${PW1}`),
    )
  })

  it('формирует Receipt с tax=none и суммой позиции для самозанятого', () => {
    const url = new URL(buildPaymentUrl(5, 360000, [{ name: 'Свеча A', priceKopecks: 180000, quantity: 2 }]))
    const receipt = JSON.parse(url.searchParams.get('Receipt')!)
    expect(receipt.items).toHaveLength(1)
    expect(receipt.items[0]).toMatchObject({ name: 'Свеча A', quantity: 2, sum: 3600, tax: 'none' })
  })

  it('подпись детерминирована для одних и тех же входных данных', () => {
    const a = new URL(buildPaymentUrl(7, 90000, ITEMS)).searchParams.get('SignatureValue')
    const b = new URL(buildPaymentUrl(7, 90000, ITEMS)).searchParams.get('SignatureValue')
    expect(a).toBe(b)
  })

  it('добавляет IsTest=1 только в тестовом режиме', () => {
    expect(new URL(buildPaymentUrl(1, 1000, ITEMS)).searchParams.has('IsTest')).toBe(false)
    process.env.ROBOKASSA_TEST_MODE = 'true'
    expect(new URL(buildPaymentUrl(1, 1000, ITEMS)).searchParams.get('IsTest')).toBe('1')
  })
})

// I3: result принимается только при корректной подписи на Password2.
describe('verifyResultSignature (I3)', () => {
  it('true для корректной подписи (регистр не важен)', () => {
    const sig = md5(`1800.00:5:${PW2}`)
    expect(verifyResultSignature('1800.00', '5', sig)).toBe(true)
    expect(verifyResultSignature('1800.00', '5', sig.toLowerCase())).toBe(true)
  })

  it('false для битой подписи или подмены суммы/номера', () => {
    const sig = md5(`1800.00:5:${PW2}`)
    expect(verifyResultSignature('1800.00', '5', 'DEADBEEF')).toBe(false)
    expect(verifyResultSignature('9999.00', '5', sig)).toBe(false) // подмена суммы
    expect(verifyResultSignature('1800.00', '6', sig)).toBe(false) // подмена InvId
  })
})
