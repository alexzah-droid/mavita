import { NextResponse } from 'next/server'
import { cdekProvider, listPickupPointsByCityCode } from '@/lib/cdek'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { DeliveryConfigurationError, getRuntimeCredentials } from '@/lib/store-settings'
import { allowRequest, clientIp } from '@/lib/public-rate-limit'

const noStore = { 'Cache-Control': 'no-store' }
const unavailable = () => NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Доставка временно недоступна'] } }, { status: 503, headers: noStore })

// Публичный прокси ПВЗ СДЭК. Предпочтительно по стабильному `cityCode` (его отдаёт
// автокомплит города); `city` (название) оставлен как fallback — резолвится в код
// на сервере. Ключи остаются на сервере. Свободный текст города больше НЕ отдаёт
// весь национальный список — фильтр идёт по city_code (см. lib/cdek.ts).
export async function GET(request: Request) {
  if (!allowRequest(`cdek:points:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ error: { code: 'RATE_LIMITED', messages: ['Слишком много запросов'] } }, { status: 429, headers: noStore })
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch (error) { if (error instanceof DeliveryConfigurationError) return unavailable(); throw error }
  if (!creds) return unavailable()
  const params = new URL(request.url).searchParams
  const cityCodeRaw = params.get('cityCode')
  try {
    let pickupPoints
    if (cityCodeRaw != null) {
      const code = Number(cityCodeRaw)
      if (!Number.isInteger(code) || code <= 0) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Некорректный код города'] } }, { status: 400, headers: noStore })
      pickupPoints = await listPickupPointsByCityCode(creds, code)
    } else {
      pickupPoints = await cdekProvider(creds).listPickupPoints(params.get('city') ?? undefined)
    }
    return NextResponse.json({ pickupPoints }, { headers: noStore })
  } catch (error) {
    const message = error instanceof DeliveryProviderError ? error.message : 'Доставка временно недоступна'
    return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [message] } }, { status: 503, headers: noStore })
  }
}
