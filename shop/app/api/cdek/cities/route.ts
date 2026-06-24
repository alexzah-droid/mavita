import { NextResponse } from 'next/server'
import { suggestCities } from '@/lib/cdek'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { DeliveryConfigurationError, getRuntimeCredentials } from '@/lib/store-settings'
import { allowRequest, clientIp } from '@/lib/public-rate-limit'

const noStore = { 'Cache-Control': 'no-store' }
const unavailable = () => NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Доставка временно недоступна'] } }, { status: 503, headers: noStore })

// Автокомплит города СДЭК: q (≥2 символа) → [{ code, city, region }]. code —
// стабильный city_code, которым потом фильтруется /api/cdek?cityCode=. Публичный,
// проксирует квотируемую операцию СДЭК — поэтому IP-лимит + минимальная длина.
export async function GET(request: Request) {
  if (!allowRequest(`cdek:cities:${clientIp(request)}`, 90, 60_000)) return NextResponse.json({ error: { code: 'RATE_LIMITED', messages: ['Слишком много запросов'] } }, { status: 429, headers: noStore })
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ cities: [] }, { headers: noStore })
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch (error) { if (error instanceof DeliveryConfigurationError) return unavailable(); throw error }
  if (!creds) return unavailable()
  try {
    return NextResponse.json({ cities: await suggestCities(creds, q) }, { headers: noStore })
  } catch (error) {
    const message = error instanceof DeliveryProviderError ? error.message : 'Доставка временно недоступна'
    return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [message] } }, { status: 503, headers: noStore })
  }
}
