import { NextResponse } from 'next/server'
import { createOrder, DeliveryUnavailableError, OrderValidationError, PriceChangedError, type OrderInput } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { CARRIER_LABEL } from '@/lib/store-settings'
import { ORDER_REF_COOKIE, orderRefCookieOptions, orderRefValue } from '@/lib/order-ref-cookie'

// POST /api/robokassa/init
// Создаёт заказ (pending), при наличии конфига Робокассы — возвращает URL оплаты.
export async function POST(req: Request) {
  let body: Partial<OrderInput>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  const input: OrderInput = {
    customerName: String(body.customerName ?? ''),
    customerEmail: String(body.customerEmail ?? ''),
    customerPhone: String(body.customerPhone ?? ''),
    // Доставку принимаем, только если клиент её прислал. createOrder сам решает по
    // режиму доставки (resolveDeliveryMode), обязательна она или нет, и валиден ли способ.
    delivery: body.delivery
      ? { method: body.delivery.method === 'cdek_pickup' ? body.delivery.method : 'invalid' as never, pickupPointCode: String(body.delivery.pickupPointCode ?? ''), expectedDeliveryKopecks: Number(body.delivery.expectedDeliveryKopecks) }
      : null,
    expectedTotalKopecks: Number(body.expectedTotalKopecks),
    items: Array.isArray(body.items)
      ? body.items.map((i) => ({ slug: String(i?.slug ?? ''), quantity: Number(i?.quantity) }))
      : [],
  }

  try {
    const { id, token, totalKopecks, lines, deliveryKopecks, deliveryCarrier } = await createOrder(input)

    // order-ref cookie доказывает success/fail-роутам, что этот браузер оформил
    // заказ (см. lib/order-ref-cookie) — только ему можно отдать /order/<token>.
    const withOrderRef = (res: NextResponse) => {
      res.cookies.set(ORDER_REF_COOKIE, orderRefValue(id, token), orderRefCookieOptions())
      return res
    }

    if (!isRobokassaConfigured()) {
      return withOrderRef(NextResponse.json({ id, token, paymentUrl: null }, { status: 201 }))
    }

    const deliveryName = deliveryCarrier ? `Доставка ${CARRIER_LABEL[deliveryCarrier]} до ПВЗ` : 'Доставка до ПВЗ'
    const paymentUrl = buildPaymentUrl(
      id,
      totalKopecks,
      [...lines.map((l) => ({ name: l.productName, priceKopecks: l.priceKopecks, quantity: l.quantity })), ...(deliveryKopecks ? [{ name: deliveryName, priceKopecks: deliveryKopecks, quantity: 1 }] : [])],
      input.customerEmail.trim(),
      `Заказ №${id} — МАВИТА`,
    )

    return withOrderRef(NextResponse.json({ id, token, paymentUrl }, { status: 201 }))
  } catch (err) {
    if (err instanceof DeliveryUnavailableError) {
      return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [err.message] } }, { status: 503 })
    }
    if (err instanceof PriceChangedError) {
      return NextResponse.json({ error: { code: 'PRICE_CHANGED', messages: ['Цена товаров или доставки изменилась'] }, ...err.amounts }, { status: 409 })
    }
    if (err instanceof DeliveryProviderError) {
      return NextResponse.json({ error: { code: err.unavailable ? 'DELIVERY_UNAVAILABLE' : 'DELIVERY_VALIDATION_ERROR', messages: [err.message] } }, { status: err.unavailable ? 503 : 400 })
    }
    if (err instanceof OrderValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 })
    }
    console.error('[robokassa/init] failed:', err)
    return NextResponse.json(
      { error: 'Не удалось оформить заказ. Попробуйте позже.' },
      { status: 500 },
    )
  }
}
