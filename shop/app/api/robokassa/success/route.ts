import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOrderTokenByInvId } from '@/lib/orders'
import { verifySuccessSignature } from '@/lib/robokassa'
import { ORDER_REF_COOKIE, parseOrderRef } from '@/lib/order-ref-cookie'

// GET /api/robokassa/success — редирект покупателя после успешной оплаты.
// Реальное подтверждение статуса — сервер→сервер в /result; здесь только ведём
// покупателя на его заказ по token. НО: token — единственная защита /order/<token>
// (email, состав, адрес ПВЗ), а InvId — перебираемое число. Поэтому редирект на
// токен-страницу получает только доказуемый покупатель: order-ref cookie этого
// браузера ЛИБО валидная подпись Робокассы (OutSum:InvId:Пароль#1). Иначе
// перебором InvId=1..N утекали бы токены (и PII) всех заказов.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invIdRaw = searchParams.get('InvId') ?? ''
  const invId = Number(invIdRaw)
  if (!Number.isInteger(invId) || invId <= 0) redirect('/')

  const token = await getOrderTokenByInvId(invId)
  if (!token) redirect('/')

  const ref = parseOrderRef((await cookies()).get(ORDER_REF_COOKIE)?.value)
  // Токен из cookie сверяем с БД: подделанная cookie не должна открывать чужой заказ.
  const cookieOk = ref?.invId === invId && ref.token === token
  const signatureOk = verifySuccessSignature(
    searchParams.get('OutSum') ?? '',
    invIdRaw,
    searchParams.get('SignatureValue') ?? '',
  )

  redirect(cookieOk || signatureOk ? `/order/${token}?paid=1` : '/')
}
