import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOrderTokenByInvId } from '@/lib/orders'
import { ORDER_REF_COOKIE, parseOrderRef } from '@/lib/order-ref-cookie'

// GET /api/robokassa/fail — редирект покупателя при отмене или ошибке оплаты.
// FailURL Робокасса НЕ подписывает, поэтому владельца заказа доказывает только
// order-ref cookie (ставится в init и /api/robokassa/pay — покрывает оба пути к
// оплате в том же браузере). Без неё ведём на главную, а не на /order/<token>:
// иначе перебором InvId утекали бы токены заказов (см. success/route.ts).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invId = Number(searchParams.get('InvId'))
  if (!Number.isInteger(invId) || invId <= 0) redirect('/')

  const token = await getOrderTokenByInvId(invId)
  if (!token) redirect('/')

  const ref = parseOrderRef((await cookies()).get(ORDER_REF_COOKIE)?.value)
  const cookieOk = ref?.invId === invId && ref.token === token

  redirect(cookieOk ? `/order/${token}?failed=1` : '/')
}
