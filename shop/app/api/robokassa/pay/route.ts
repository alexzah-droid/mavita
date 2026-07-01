import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOrderByToken } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { CARRIER_LABEL } from '@/lib/store-settings'
import { ORDER_REF_COOKIE, orderRefCookieOptions, orderRefValue } from '@/lib/order-ref-cookie'

// GET /api/robokassa/pay?token=… — повторная оплата pending-заказа со страницы
// /order/<token>. Оплата идёт через этот роут (а не прямой href на Робокассу),
// чтобы поставить order-ref cookie: без неё возврат на fail не смог бы доказать,
// что покупатель — владелец заказа (см. lib/order-ref-cookie). Заодно платёжный
// URL со свежим чеком строится в момент клика, а не при каждом рендере страницы.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  const order = token ? await getOrderByToken(token) : undefined
  if (!order) redirect('/')
  if (order.status !== 'pending' || !isRobokassaConfigured()) redirect(`/order/${token}`)

  const carrierLabel = order.deliveryCarrier ? CARRIER_LABEL[order.deliveryCarrier] : null
  const deliveryName = carrierLabel ? `Доставка ${carrierLabel} до ПВЗ` : 'Доставка до ПВЗ'
  const paymentUrl = buildPaymentUrl(
    order.id,
    order.totalKopecks,
    [
      ...order.items.map((it) => ({ name: it.productName, priceKopecks: it.priceKopecks, quantity: it.quantity })),
      ...(order.deliveryKopecks ? [{ name: deliveryName, priceKopecks: order.deliveryKopecks, quantity: 1 }] : []),
    ],
    order.customerEmail,
    `Заказ №${order.id} — МАВИТА`,
  )

  const jar = await cookies()
  jar.set(ORDER_REF_COOKIE, orderRefValue(order.id, token), orderRefCookieOptions())
  redirect(paymentUrl)
}
