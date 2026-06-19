import { NextResponse } from 'next/server'
import { createOrder, OrderValidationError, type OrderInput } from '@/lib/orders'

// POST /api/orders — создать заказ (pending). Цены пересчитываются на сервере
// из каталога БД; клиентские цены игнорируются.
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
    const id = await createOrder(input)
    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 })
    }
    console.error('[orders] create failed:', err)
    return NextResponse.json(
      { error: 'Не удалось оформить заказ. Попробуйте позже.' },
      { status: 500 },
    )
  }
}
