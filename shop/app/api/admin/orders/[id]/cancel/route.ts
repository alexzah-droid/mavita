import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { parseCancelBody, parseOrderId } from '@/lib/admin-orders'
import { cancelAdminOrder } from '@/lib/admin-orders-db'
import { annulCdekShipment } from '@/lib/cdek-shipment'
import { getStoredCredentials } from '@/lib/store-settings'

function ok(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (!ok(auth)) return auth
  const csrf = assertSameOrigin(request)
  if (csrf) return csrf

  const id = parseOrderId((await params).id)
  const parsed = parseCancelBody(await request.json().catch(() => null))
  if (!id || !parsed.value) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', messages: id ? parsed.errors : ['Некорректный номер заказа'] } },
      { status: 400 },
    )
  }

  const result = await cancelAdminOrder(id, parsed.value.reason, auth.loginAt)

  if (result === 'not_found') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', messages: ['Заказ не найден'] } }, { status: 404 })
  }
  if (result === 'not_cancellable') {
    return NextResponse.json(
      { error: { code: 'ORDER_NOT_CANCELLABLE', messages: ['Нельзя отменить — заказ уже передан перевозчику или выдан'] } },
      { status: 409 },
    )
  }

  // Если у отменённого заказа было отправление в СДЭК — аннулируем (best-effort).
  let cdekAnnulError: string | null = null
  if (result.cdekOrderUuid) {
    const creds = await getStoredCredentials('cdek').catch(() => null)
    if (creds) {
      const annul = await annulCdekShipment(creds, result.cdekOrderUuid)
      if (!annul.ok) cdekAnnulError = annul.error
    } else {
      cdekAnnulError = 'Ключи СДЭК не найдены — аннулируйте отправление вручную в ЛК СДЭК'
    }
  }

  return NextResponse.json(
    { ...result.order, cdekAnnulError },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
