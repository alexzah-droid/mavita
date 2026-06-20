import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'

// markOrderPaid обращается к БД — мокаем, чтобы тестировать только HTTP-границу
// и проверку подписи (real verifyResultSignature).
vi.mock('@/lib/orders', () => ({ markOrderPaid: vi.fn() }))

import { POST, GET } from '@/app/api/robokassa/result/route'
import { markOrderPaid } from '@/lib/orders'

const PW2 = 'password_two'
function sign(outSum: string, invId: string): string {
  return createHash('md5').update(`${outSum}:${invId}:${PW2}`, 'utf8').digest('hex').toUpperCase()
}

function postReq(fields: Record<string, string>): Request {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return new Request('http://localhost/api/robokassa/result', { method: 'POST', body: fd })
}

function getReq(fields: Record<string, string>): Request {
  const u = new URL('http://localhost/api/robokassa/result')
  for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v)
  return new Request(u, { method: 'GET' })
}

beforeAll(() => {
  process.env.ROBOKASSA_PASSWORD2 = PW2
})

beforeEach(() => {
  vi.mocked(markOrderPaid).mockReset()
})

describe('POST /api/robokassa/result', () => {
  // I3: статус не меняется без корректной подписи.
  it('битая подпись → 400 и markOrderPaid не вызывается', async () => {
    const res = await POST(postReq({ OutSum: '1800.00', InvId: '5', SignatureValue: 'BADBAD' }))
    expect(res.status).toBe(400)
    expect(markOrderPaid).not.toHaveBeenCalled()
  })

  it('нет обязательных параметров → 400', async () => {
    const res = await POST(postReq({ OutSum: '1800.00' }))
    expect(res.status).toBe(400)
    expect(markOrderPaid).not.toHaveBeenCalled()
  })

  // I4 + сверка суммы: при валидной подписи зовём markOrderPaid с суммой в копейках.
  it('валидная подпись → 200 OK{InvId}, сумма передана в копейках', async () => {
    vi.mocked(markOrderPaid).mockResolvedValue('paid')
    const res = await POST(
      postReq({ OutSum: '1800.00', InvId: '5', SignatureValue: sign('1800.00', '5') }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK5')
    expect(markOrderPaid).toHaveBeenCalledWith(5, 180000, expect.objectContaining({ InvId: '5' }))
  })

  it('повторный колбэк по оплаченному заказу → 200 (идемпотентность)', async () => {
    vi.mocked(markOrderPaid).mockResolvedValue('already_paid')
    const res = await POST(
      postReq({ OutSum: '1800.00', InvId: '5', SignatureValue: sign('1800.00', '5') }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK5')
  })

  it('несовпадение суммы → 400, заказ не подтверждаем', async () => {
    vi.mocked(markOrderPaid).mockResolvedValue('amount_mismatch')
    const res = await POST(
      postReq({ OutSum: '1.00', InvId: '5', SignatureValue: sign('1.00', '5') }),
    )
    expect(res.status).toBe(400)
  })

  it('неизвестный заказ → 400', async () => {
    vi.mocked(markOrderPaid).mockResolvedValue('not_found')
    const res = await POST(
      postReq({ OutSum: '1800.00', InvId: '999', SignatureValue: sign('1800.00', '999') }),
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/robokassa/result (тестовый режим Робокассы)', () => {
  it('валидная подпись через query → 200 OK{InvId}', async () => {
    vi.mocked(markOrderPaid).mockResolvedValue('paid')
    const res = await GET(
      getReq({ OutSum: '900.00', InvId: '8', SignatureValue: sign('900.00', '8') }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK8')
    expect(markOrderPaid).toHaveBeenCalledWith(8, 90000, expect.any(Object))
  })
})
