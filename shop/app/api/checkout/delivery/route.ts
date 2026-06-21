import { NextResponse } from 'next/server'
import { CARRIER_LABEL, resolveDeliveryMode } from '@/lib/store-settings'

const noStore = { 'Cache-Control': 'no-store' }

// Режим доставки для checkout:
//  - disabled         → заказ без ПВЗ (delivery_kopecks=0);
//  - pickup_required  → список активных перевозчиков с тарифами и подписями;
//  - error            → 503, оформление недоступно (никогда не «заказ без ПВЗ»).
export async function GET() {
  const { mode, carriers } = await resolveDeliveryMode()
  if (mode === 'error') return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Оформление временно недоступно'] } }, { status: 503, headers: noStore })
  if (mode === 'disabled') return NextResponse.json({ mode: 'disabled' }, { headers: noStore })
  return NextResponse.json({
    mode: 'pickup_required',
    carriers: carriers.map((c) => ({ carrier: c.carrier, label: CARRIER_LABEL[c.carrier], deliveryKopecks: c.deliveryKopecks })),
  }, { headers: noStore })
}
