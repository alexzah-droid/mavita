import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { parseOrderId } from '@/lib/admin-orders'
import { requeueShipment } from '@/lib/cdek-shipment'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })

  const id = parseOrderId((await params).id)
  if (!id) return NextResponse.json({ error: { messages: ['Некорректный id'] } }, { status: 400 })

  const result = await requeueShipment(id)
  if (result === 'not_found') return NextResponse.json({ error: { messages: ['Заказ не найден'] } }, { status: 404 })
  if (result === 'already_created') return NextResponse.json({ error: { messages: ['Отправление уже создано в СДЭК'] } }, { status: 409 })

  return NextResponse.json({ ok: true })
}
