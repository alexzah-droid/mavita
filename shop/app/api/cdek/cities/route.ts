import { NextResponse } from 'next/server'
import { suggestCities, type CdekCity } from '@/lib/cdek'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { DeliveryConfigurationError, getRuntimeCredentials } from '@/lib/store-settings'
import { allowRequest, clientIp } from '@/lib/public-rate-limit'
import { pruneTtlMap } from '@/lib/bounded-map'

const noStore = { 'Cache-Control': 'no-store' }
const cityCacheHeaders = { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' }
// Кэш подсказок ограничен по числу записей: уникальные q — новые ключи навсегда,
// иначе перебор строк раздувал бы Map (см. pruneTtlMap).
const suggestCache = new Map<string, { cities: CdekCity[]; expiresAt: number }>()
const SUGGEST_TTL_MS = 10 * 60 * 1000
const SUGGEST_CACHE_MAX = 1000
const unavailable = () => NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Доставка временно недоступна'] } }, { status: 503, headers: noStore })

// Автокомплит города СДЭК: q (≥2 символа) → [{ code, city, region }]. code —
// стабильный city_code, которым потом фильтруется /api/cdek?cityCode=. Публичный,
// проксирует квотируемую операцию СДЭК — поэтому IP-лимит + минимальная длина.
export async function GET(request: Request) {
  if (!allowRequest(`cdek:cities:${clientIp(request)}`, 90, 60_000)) return NextResponse.json({ error: { code: 'RATE_LIMITED', messages: ['Слишком много запросов'] } }, { status: 429, headers: noStore })
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ cities: [] }, { headers: cityCacheHeaders })
  const cacheKey = q.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
  const cached = suggestCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json({ cities: cached.cities }, { headers: cityCacheHeaders })
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch (error) { if (error instanceof DeliveryConfigurationError) return unavailable(); throw error }
  if (!creds) return unavailable()
  try {
    const cities = await suggestCities(creds, q)
    pruneTtlMap(suggestCache, SUGGEST_CACHE_MAX)
    suggestCache.set(cacheKey, { cities, expiresAt: Date.now() + SUGGEST_TTL_MS })
    return NextResponse.json({ cities }, { headers: cityCacheHeaders })
  } catch (error) {
    const message = error instanceof DeliveryProviderError ? error.message : 'Доставка временно недоступна'
    return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [message] } }, { status: 503, headers: noStore })
  }
}
