import { NextResponse } from 'next/server'
import { searchOzonPickupPoints } from '@/lib/ozon-catalog'
import { resolveDeliveryMode } from '@/lib/store-settings'

const noStore = { 'Cache-Control': 'no-store' }
const unavailable = () => NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Доставка временно недоступна'] } }, { status: 503, headers: noStore })

// Публичный поиск ПВЗ Ozon ПО ГОРОДУ из локального каталога (point/list живого API
// отдаёт только id+координаты; детали синхронизируются в ozon_pickup_points).
// Доступен только когда Ozon — активный перевозчик; ключи/секреты тут не нужны.
export async function GET(request: Request) {
  try {
    const { mode, carriers } = await resolveDeliveryMode()
    if (mode === 'error') return unavailable()
    if (mode !== 'pickup_required' || !carriers.some((c) => c.carrier === 'ozon')) return unavailable()
    const city = new URL(request.url).searchParams.get('city') ?? undefined
    const pickupPoints = await searchOzonPickupPoints(city)
    return NextResponse.json({ pickupPoints }, { headers: noStore })
  } catch {
    // Ошибка БД/каталога не должна давать generic 500 — это та же недоступность доставки.
    return unavailable()
  }
}
