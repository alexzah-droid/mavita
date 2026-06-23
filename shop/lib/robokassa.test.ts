import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildPaymentUrl,
  verifyResultSignature,
  kopecksToOutSum,
  isRobokassaConfigured,
  isAllowedResultIp,
  checkPaymentConfig,
} from '@/lib/robokassa'

const LOGIN = 'mavita'
const PW1 = 'password_one'
const PW2 = 'password_two'

function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex').toUpperCase()
}
function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase()
}

beforeAll(() => {
  process.env.ROBOKASSA_LOGIN = LOGIN
  process.env.ROBOKASSA_PASSWORD1 = PW1
  process.env.ROBOKASSA_PASSWORD2 = PW2
})

afterEach(() => {
  delete process.env.ROBOKASSA_TEST_MODE
  delete process.env.ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION
  delete process.env.ROBOKASSA_HASH_ALGO
  delete process.env.ROBOKASSA_RESULT_IPS
  vi.unstubAllEnvs()
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

// I1: подпись считается на сервере как MD5(login:OutSum:InvId:Receipt:Password1),
// где Receipt — ИСХОДНЫЙ JSON (а в URL он же URL-encoded). Проверено вживую 2026-06-23:
// подпись по URL-encoded строке Робокасса отвергает с кодом 29.
describe('buildPaymentUrl (I1)', () => {
  const ITEMS = [{ name: 'Свеча A', priceKopecks: 180000, quantity: 1 }]
  // Receipt, который входит в подпись = исходный JSON (Receipt из URL, раскодированный).
  const signedReceipt = (rawUrl: string) =>
    decodeURIComponent(rawUrl.match(/[?&]Receipt=([^&]*)/)![1])

  it('кладёт в URL OutSum, InvId и корректную подпись на Password1 (с Receipt)', () => {
    const raw = buildPaymentUrl(5, 180000, ITEMS, 'a@b.ru', 'Заказ №5')
    const url = new URL(raw)
    expect(url.origin + url.pathname).toBe('https://auth.robokassa.ru/Merchant/Index.aspx')
    expect(url.searchParams.get('MerchantLogin')).toBe(LOGIN)
    expect(url.searchParams.get('OutSum')).toBe('1800.00')
    expect(url.searchParams.get('InvId')).toBe('5')
    expect(url.searchParams.get('SignatureValue')).toBe(
      md5(`${LOGIN}:1800.00:5:${signedReceipt(raw)}:${PW1}`),
    )
  })

  it('подпись считается по ИСХОДНОМУ JSON Receipt, а не по URL-encoded (регресс кода 29)', () => {
    // Имя с пробелом → encoded (%20) и сырой JSON различаются, тест осмыслен.
    const raw = buildPaymentUrl(10, 10000, [{ name: 'Горная вершина', priceKopecks: 10000, quantity: 1 }])
    const url = new URL(raw)
    const encodedReceipt = raw.match(/[?&]Receipt=([^&]*)/)![1]
    const rawJsonReceipt = url.searchParams.get('Receipt')! // декодированный JSON
    expect(rawJsonReceipt).not.toBe(encodedReceipt) // sanity: формы реально разные
    const sig = url.searchParams.get('SignatureValue')
    expect(sig).toBe(md5(`${LOGIN}:100.00:10:${rawJsonReceipt}:${PW1}`)) // верный вариант
    expect(sig).not.toBe(md5(`${LOGIN}:100.00:10:${encodedReceipt}:${PW1}`)) // старый баг
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

// TD-20: алгоритм подписи конфигурируется и должен совпадать с настройкой ЛК.
describe('ROBOKASSA_HASH_ALGO (TD-20)', () => {
  it('по умолчанию MD5', () => {
    expect(verifyResultSignature('1800.00', '5', md5(`1800.00:5:${PW2}`))).toBe(true)
  })

  it('sha256 → подпись считается SHA-256, MD5 больше не проходит', () => {
    process.env.ROBOKASSA_HASH_ALGO = 'sha256'
    expect(verifyResultSignature('1800.00', '5', sha256(`1800.00:5:${PW2}`))).toBe(true)
    expect(verifyResultSignature('1800.00', '5', md5(`1800.00:5:${PW2}`))).toBe(false)
    // и исходящая подпись тоже на SHA-256 (Receipt в подписи — исходный JSON)
    const items = [{ name: 'Свеча A', priceKopecks: 180000, quantity: 1 }]
    const raw = buildPaymentUrl(5, 180000, items)
    const receipt = decodeURIComponent(raw.match(/[?&]Receipt=([^&]*)/)![1])
    expect(new URL(raw).searchParams.get('SignatureValue')).toBe(
      sha256(`${LOGIN}:1800.00:5:${receipt}:${PW1}`),
    )
  })

  it('неизвестный алгоритм → ошибка (не молчим)', () => {
    process.env.ROBOKASSA_HASH_ALGO = 'crc32'
    expect(() => verifyResultSignature('1800.00', '5', 'x')).toThrow(/не поддерживается/)
  })
})

// TD-21.1: fail-fast на запуске прода в тест-режиме Робокассы.
describe('checkPaymentConfig (TD-21.1)', () => {
  it('production + TEST_MODE=true → проблема', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.ROBOKASSA_TEST_MODE = 'true'
    const problems = checkPaymentConfig()
    expect(problems.some((p) => /TEST_MODE=true в production/.test(p))).toBe(true)
  })

  it('production + TEST_MODE=true с явным временным разрешением → допустимо', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.ROBOKASSA_TEST_MODE = 'true'
    process.env.ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION = 'true'
    expect(checkPaymentConfig()).toEqual([])
  })

  it('production + боевой режим → проблем нет', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(checkPaymentConfig()).toEqual([])
  })

  it('dev + TEST_MODE=true → допустимо (не блокируем локальную разработку)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.ROBOKASSA_TEST_MODE = 'true'
    expect(checkPaymentConfig()).toEqual([])
  })

  it('недопустимый HASH_ALGO попадает в список проблем', () => {
    process.env.ROBOKASSA_HASH_ALGO = 'crc32'
    expect(checkPaymentConfig().some((p) => /не поддерживается/.test(p))).toBe(true)
  })
})

// TD-19: allowlist IP колбэка /result.
describe('isAllowedResultIp (TD-19)', () => {
  it('пустой список → проверка выключена (любой IP разрешён)', () => {
    expect(isAllowedResultIp('8.8.8.8')).toBe(true)
    expect(isAllowedResultIp(null)).toBe(true)
  })

  it('одиночный IP: совпадение разрешено, остальное нет', () => {
    process.env.ROBOKASSA_RESULT_IPS = '185.59.216.10'
    expect(isAllowedResultIp('185.59.216.10')).toBe(true)
    expect(isAllowedResultIp('185.59.216.11')).toBe(false)
  })

  it('CIDR-диапазон и IPv6-mapped IPv4', () => {
    process.env.ROBOKASSA_RESULT_IPS = '185.59.216.0/22, 1.2.3.4'
    expect(isAllowedResultIp('185.59.218.200')).toBe(true) // внутри /22
    expect(isAllowedResultIp('185.59.220.1')).toBe(false) // вне /22
    expect(isAllowedResultIp('::ffff:1.2.3.4')).toBe(true) // mapped → 1.2.3.4
    expect(isAllowedResultIp(null)).toBe(false) // список задан, IP нет
  })
})
