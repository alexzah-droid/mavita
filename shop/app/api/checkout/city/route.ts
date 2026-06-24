import { NextResponse } from 'next/server'
import { resolveCity } from '@/lib/cdek'
import { getRuntimeCredentials } from '@/lib/store-settings'
import { cityNameByIp } from '@/lib/geoip'
import { allowRequest, clientIp } from '@/lib/public-rate-limit'

const noStore = { 'Cache-Control': 'no-store' }
const none = () => NextResponse.json({ city: null }, { headers: noStore })

// Префилл города на чекауте по IP покупателя (MaxMind GeoLite2, локально). Всё
// опционально: нет СДЭК/базы/совпадения → { city: null }, и форма просто не
// подставляет город. Ошибки наружу не светим — это удобство, а не валидация.
export async function GET(request: Request) {
  const ip = clientIp(request)
  if (!allowRequest(`checkout:city:${ip}`, 30, 60_000)) return none()
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch { return none() }
  if (!creds) return none()
  const name = await cityNameByIp(ip)
  if (!name) return none()
  let city
  try { city = await resolveCity(creds, name) } catch { return none() }
  return NextResponse.json({ city }, { headers: noStore })
}
