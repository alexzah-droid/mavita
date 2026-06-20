import { markOrderPaid } from '@/lib/orders'
import { isAllowedResultIp, verifyResultSignature } from '@/lib/robokassa'

// За Nginx реальный IP — в X-Forwarded-For (первый хоп) либо X-Real-IP.
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

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
  // Робокасса перестанет повторять колбэк. При несовпадении суммы / неизвестном /
  // отменённом заказе НЕ подтверждаем: возвращаем ошибку, чтобы рассинхрон стал
  // заметен (ретраи Робокассы + лог), а деньги на «битый» заказ не потерялись молча.
  if (result === 'paid' || result === 'already_paid') {
    return new Response(`OK${invId}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // cancelled — деньги пришли на отменённый заказ: критично, нужен ручной разбор.
  console.error(`[robokassa/result] InvId=${invId} OutSum=${outSum} → ${result}`)
  const message: Record<string, string> = {
    amount_mismatch: 'Amount mismatch',
    cancelled: 'Order cancelled',
  }
  return new Response(message[result] ?? 'Unknown order', { status: 400 })
}

export async function POST(req: Request) {
  // TD-19: IP-allowlist Робокассы (если настроен) — второй рубеж к подписи.
  if (!isAllowedResultIp(clientIp(req))) {
    return new Response('Forbidden', { status: 403 })
  }

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
  if (!isAllowedResultIp(clientIp(req))) {
    return new Response('Forbidden', { status: 403 })
  }

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
