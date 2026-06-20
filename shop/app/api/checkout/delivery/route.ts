import { NextResponse } from 'next/server'
import { getDeliverySettings } from '@/lib/store-settings'
import { isDeliveryEnabled } from '@/lib/orders'
const noStore = { 'Cache-Control': 'no-store' }
export async function GET() {
  // СДЭК не подключён: доставка отключена, checkout оформляет заказ без ПВЗ.
  if (!isDeliveryEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore })
  const settings = await getDeliverySettings()
  return settings
    ? NextResponse.json({ enabled: true, cdekPickupDeliveryKopecks: settings.cdekPickupDeliveryKopecks }, { headers: noStore })
    : NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Оформление временно недоступно'] } }, { status: 503, headers: noStore })
}
