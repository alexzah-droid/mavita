import { NextResponse } from 'next/server'
import { createOrder, OrderValidationError, type OrderInput } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { query } from '@/lib/db'

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
    customerPhone: body.customerPhone ? String(body.customerPhone) : undefined,
    items: Array.isArray(body.items)
      ? body.items.map((i) => ({ slug: String(i?.slug ?? ''), quantity: Number(i?.quantity) }))
      : [],
  }

  try {
    const { id, token, totalKopecks, lines } = await createOrder(input)

    if (!isRobokassaConfigured()) {
      return NextResponse.json({ id, token, paymentUrl: null }, { status: 201 })
    }

    await query('UPDATE orders SET inv_id = $1 WHERE id = $1', [id])

    const paymentUrl = buildPaymentUrl(
      id,
      totalKopecks,
      lines.map((l) => ({ name: l.productName, priceKopecks: l.priceKopecks, quantity: l.quantity })),
      input.customerEmail.trim(),
      `Заказ №${id} — МАВИТА`,
    )

    return NextResponse.json({ id, token, paymentUrl }, { status: 201 })
  } catch (err) {
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
