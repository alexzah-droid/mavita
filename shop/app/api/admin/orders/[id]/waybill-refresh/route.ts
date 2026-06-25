import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { parseOrderId } from '@/lib/admin-orders'
import { getRuntimeCredentials } from '@/lib/store-settings'
import { refreshWaybillUrls } from '@/lib/cdek-shipment'
import { query } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })

  const id = parseOrderId((await params).id)
  if (!id) return NextResponse.json({ error: { messages: ['Некорректный id'] } }, { status: 400 })

  const rows = await query<{ cdek_order_uuid: string | null }>(
    'SELECT cdek_order_uuid FROM orders WHERE id = $1',
    [id],
  )
  if (!rows[0]) return NextResponse.json({ error: { messages: ['Заказ не найден'] } }, { status: 404 })

  const orderUuid = rows[0].cdek_order_uuid
  if (!orderUuid) return NextResponse.json({ error: { messages: ['Отправление в СДЭК ещё не создано'] } }, { status: 409 })

  const creds = await getRuntimeCredentials('cdek')
  if (!creds) return NextResponse.json({ error: { messages: ['Ключи СДЭК не настроены'] } }, { status: 503 })

  const { waybillUrl, barcodeUrl } = await refreshWaybillUrls(orderUuid, creds)

  if (waybillUrl || barcodeUrl) {
    await query(
      `UPDATE orders SET
         cdek_waybill_url = COALESCE($1, cdek_waybill_url),
         cdek_barcode_url = COALESCE($2, cdek_barcode_url)
       WHERE id = $3`,
      [waybillUrl, barcodeUrl, id],
    )
  }

  return NextResponse.json({ waybillUrl, barcodeUrl })
}
