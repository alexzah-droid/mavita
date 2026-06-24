// GeoIP-определение города по IP для префилла на чекауте. Источник — локальная
// база MaxMind GeoLite2-City (GEOIP_DB_PATH), без внешних вызовов: IP покупателя
// никуда не уходит. Всё опционально и degrade'ит мягко: нет базы/ошибка → null,
// и чекаут просто не подставляет город (автокомплит работает в любом случае).
import 'server-only'
import maxmind, { type CityResponse, type Reader } from 'maxmind'

type Loaded = { reader: Reader<CityResponse> | null }
let loading: Promise<Loaded> | null = null

async function getReader(): Promise<Reader<CityResponse> | null> {
  const path = process.env.GEOIP_DB_PATH?.trim()
  if (!path) return null
  if (!loading) loading = maxmind.open<CityResponse>(path).then((reader) => ({ reader })).catch(() => ({ reader: null }))
  return (await loading).reader
}

// Название города по IP (ru, иначе en). null — база недоступна, IP приватный или
// город неизвестен. Возвращаем только название: city_code резолвит уже СДЭК.
export async function cityNameByIp(ip: string): Promise<string | null> {
  if (!ip || ip === 'unknown') return null
  let reader: Reader<CityResponse> | null
  try { reader = await getReader() } catch { return null }
  if (!reader) return null
  let record: CityResponse | null
  try { record = reader.get(ip) } catch { return null }
  const names = record?.city?.names
  const name = names?.ru ?? names?.en
  return name && name.trim() ? name.trim() : null
}
