import { markOrderPaid } from '@/lib/orders'
import { verifyResultSignature } from '@/lib/robokassa'

// Робокасса в тестовом режиме может слать GET вместо POST.
// Оба метода обрабатываем одинаково.
async function handleResult(outSum: string, invId: string, signature: string, rawData: Record<string, string>) {
  if (!outSum || !invId || !signature) {
    return new Response('Missing params', { status: 400 })
  }

  if (!verifyResultSignature(outSum, invId, signature)) {
    return new Response('Bad signature', { status: 400 })
  }

  // OutSum в рублях («1800.00») → копейки. Сверяется с total_kopecks заказа.
  const paidKopecks = Math.round(parseFloat(outSum) * 100)
  if (!Number.isFinite(paidKopecks)) {
    return new Response('Bad OutSum', { status: 400 })
  }

  const result = await markOrderPaid(Number(invId), paidKopecks, rawData)

  // OK{InvId} только когда заказ действительно оплачен (или уже был) — тогда
  // Робокасса перестанет повторять колбэк. При несовпадении суммы / неизвестном
  // заказе НЕ подтверждаем: возвращаем ошибку, чтобы рассинхрон стал заметен.
  if (result === 'paid' || result === 'already_paid') {
    return new Response(`OK${invId}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  console.error(`[robokassa/result] InvId=${invId} OutSum=${outSum} → ${result}`)
  return new Response(result === 'amount_mismatch' ? 'Amount mismatch' : 'Unknown order', {
    status: 400,
  })
}

export async function POST(req: Request) {
  let body: FormData
  try {
    body = await req.formData()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const rawData: Record<string, string> = {}
  body.forEach((value, key) => { rawData[key] = String(value) })

  return handleResult(
    String(body.get('OutSum') ?? ''),
    String(body.get('InvId') ?? ''),
    String(body.get('SignatureValue') ?? ''),
    rawData,
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = url.searchParams

  const rawData: Record<string, string> = {}
  p.forEach((value, key) => { rawData[key] = value })

  return handleResult(
    p.get('OutSum') ?? '',
    p.get('InvId') ?? '',
    p.get('SignatureValue') ?? '',
    rawData,
  )
}
