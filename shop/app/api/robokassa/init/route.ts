import { NextResponse } from 'next/server'
import { createOrder, DeliveryUnavailableError, OrderValidationError, PriceChangedError, type OrderInput } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { query } from '@/lib/db'
import { CdekValidationError } from '@/lib/cdek'

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
    delivery: { method: body.delivery?.method === 'cdek_pickup' ? 'cdek_pickup' : 'invalid' as never, pickupPointCode: String(body.delivery?.pickupPointCode ?? ''), expectedDeliveryKopecks: Number(body.delivery?.expectedDeliveryKopecks) },
    expectedTotalKopecks: Number(body.expectedTotalKopecks),
    items: Array.isArray(body.items)
      ? body.items.map((i) => ({ slug: String(i?.slug ?? ''), quantity: Number(i?.quantity) }))
      : [],
  }

  try {
    const { id, token, totalKopecks, lines, deliveryKopecks } = await createOrder(input)

    if (!isRobokassaConfigured()) {
      return NextResponse.json({ id, token, paymentUrl: null }, { status: 201 })
    }

    await query('UPDATE orders SET inv_id = $1 WHERE id = $1', [id])

    const paymentUrl = buildPaymentUrl(
      id,
      totalKopecks,
      [...lines.map((l) => ({ name: l.productName, priceKopecks: l.priceKopecks, quantity: l.quantity })), ...(deliveryKopecks ? [{ name: 'Доставка СДЭК до ПВЗ', priceKopecks: deliveryKopecks, quantity: 1 }] : [])],
      input.customerEmail.trim(),
      `Заказ №${id} — МАВИТА`,
    )

    return NextResponse.json({ id, token, paymentUrl }, { status: 201 })
  } catch (err) {
    if (err instanceof DeliveryUnavailableError) {
      return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [err.message] } }, { status: 503 })
    }
    if (err instanceof PriceChangedError) {
      return NextResponse.json({ error: { code: 'PRICE_CHANGED', messages: ['Цена товаров или доставки изменилась'] }, ...err.amounts }, { status: 409 })
    }
    if (err instanceof CdekValidationError) {
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
