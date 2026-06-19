import { markOrderPaid } from '@/lib/orders'
import { verifyResultSignature } from '@/lib/robokassa'

// POST /api/robokassa/result — серверный callback от Робокассы.
// Проверяет подпись через Password2, ставит статус paid, возвращает "OK{InvId}".
// URL должен быть доступен из интернета и прописан в настройках магазина Робокассы.
export async function POST(req: Request) {
  let body: FormData
  try {
    body = await req.formData()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const outSum = String(body.get('OutSum') ?? '')
  const invId = String(body.get('InvId') ?? '')
  const signature = String(body.get('SignatureValue') ?? '')

  if (!outSum || !invId || !signature) {
    return new Response('Missing params', { status: 400 })
  }

  if (!verifyResultSignature(outSum, invId, signature)) {
    return new Response('Bad signature', { status: 400 })
  }

  const robokassaData: Record<string, string> = {}
  body.forEach((value, key) => {
    robokassaData[key] = String(value)
  })

  await markOrderPaid(Number(invId), robokassaData)

  return new Response(`OK${invId}`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
