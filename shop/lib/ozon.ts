// Провайдер ПВЗ Ozon (Ozon Логистика). Реальный контракт API (проверено живым
// ключом):
//  - POST v1/delivery/point/list  → { points:[{ map_point_id, coordinate }] } —
//    ТОЛЬКО id+координаты, ~90 000 точек, без города/адреса/названия.
//  - POST v1/delivery/point/info  → body { map_point_ids:[int] } (1…100 за раз) →
//    { points:[{ map_point_id, delivery_method:{ address, address_details{city,region,
//    street,house}, coordinates, name, ... } }] }. city часто пустой → берём из region.
//
// Поэтому поиск ПВЗ по городу для клиента строится по ЛОКАЛЬНОМУ каталогу
// (lib/ozon-catalog.ts, наполняет scripts/sync-ozon-pickup-points.ts), а не живым
// запросом. Здесь — только HTTP к Ozon: re-confirm одного кода и наполнение каталога.
import type { CarrierProvider, DeliveryCredentials, PickupPoint } from '@/lib/delivery/types'
import { DeliveryProviderError } from '@/lib/delivery/types'

export class OzonValidationError extends DeliveryProviderError {
  constructor(message = 'Пункт выдачи ОЗОН недоступен', unavailable = false, authFailed = false) { super(message, unavailable, authFailed); this.name = 'OzonValidationError' }
}

/** Детальная точка для локального каталога (с координатами). */
export type OzonPickupDetail = { code: string; city: string; name: string; address: string; lat: number | null; lng: number | null }

function baseUrl() { return (process.env.OZON_API_BASE || 'https://api-seller.ozon.ru').replace(/\/$/, '') }
function isAuthStatus(status: number) { return status === 401 || status === 403 }

async function ozonPost(creds: DeliveryCredentials, path: string, body: unknown, timeoutMs = 20_000): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Client-Id': creds.clientId, 'Api-Key': creds.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch { throw new OzonValidationError('Доставка временно недоступна', true) } // сеть/таймаут
  if (!response.ok) throw new OzonValidationError('Доставка временно недоступна', true, isAuthStatus(response.status))
  return response.json().catch(() => null)
}

const LOCALITY_PREFIX = /^(город|г|село|с|посёлок|поселок|пос|пгт|рабочий посёлок|рп|деревня|д|станица|ст|хутор|х|аул)\.?\s+(.+)$/i
const STREET = /(улиц|ул\.|просп|пр-кт|пр\.|переул|пер\.|бульвар|шоссе|площад|набереж|проезд|тупик|аллея|микрорайон|мкр|квартал|линия|тракт)/i
const ADMIN = /(район|область|обл\.|край|республик|округ|^Россия$)/i

/**
 * Город из деталей Ozon. Приоритет:
 *  1) address_details.city (заполнен для городов: Москва, Воронеж, Сатка);
 *  2) сегмент с явным префиксом «село/город/посёлок X»;
 *  3) сегмент ПЕРЕД улицей (для сёл без префикса: «…, Осьмино, улица Ленина, 50»);
 *  4) region; 5) 'РФ'. Всегда непустой — snapshot заказа требует pickup_point_city.
 */
export function cityOf(addressDetails: Record<string, unknown> | undefined, address: string): string {
  const detailCity = String(addressDetails?.city ?? '').trim()
  if (detailCity) return detailCity
  const segs = address.split(',').map((s) => s.trim()).filter(Boolean)
  for (const seg of segs) { const m = seg.match(LOCALITY_PREFIX); if (m) return m[2].trim() }
  // Сегмент перед первым «уличным» — обычно населённый пункт.
  const streetIdx = segs.findIndex((s) => STREET.test(s))
  if (streetIdx > 0) { const cand = segs[streetIdx - 1]; if (cand && !ADMIN.test(cand)) return cand }
  const region = String(addressDetails?.region ?? '').trim()
  return region || 'РФ'
}

/** Элемент ответа point/info → детальная точка. undefined, если нет id/адреса. */
export function normalizeInfoPoint(raw: unknown): OzonPickupDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  const dm = v.delivery_method as Record<string, unknown> | undefined
  if (!dm) return undefined
  // map_point_id у point/info лежит ВНУТРИ delivery_method (проверено живым API);
  // на верхнем уровне точки его нет. Берём из dm, с фоллбэком на верхний уровень.
  const code = String(dm.map_point_id ?? v.map_point_id ?? '').trim()
  const address = String(dm.address ?? '').trim()
  if (!code || !address) return undefined
  const city = cityOf(dm.address_details as Record<string, unknown> | undefined, address)
  const name = String(dm.name ?? '').trim() || 'Пункт Ozon'
  const coords = dm.coordinates as Record<string, unknown> | undefined
  const lat = coords?.lat != null ? Number(coords.lat) : null
  const lng = coords?.long != null ? Number(coords.long) : null
  return { code, city, name, address, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null }
}

function pointsArray(data: unknown): unknown[] {
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).points)) return (data as Record<string, unknown>).points as unknown[]
  return []
}

/** Все УНИКАЛЬНЫЕ map_point_id из point/list (только id, ~90k). Для синхронизации. */
export async function fetchAllPointIds(creds: DeliveryCredentials): Promise<number[]> {
  const data = await ozonPost(creds, '/v1/delivery/point/list', { filter: {} })
  const ids = pointsArray(data)
    .map((p) => (p && typeof p === 'object' ? Number((p as Record<string, unknown>).map_point_id) : NaN))
    .filter((n) => Number.isFinite(n))
  return [...new Set(ids)] // дедуп: дубль/битый список не должен искажать overlap-проверку
}

/** Детали для пачки id (≤100). received — сколько точек реально вернул Ozon (до
 *  normalize), для контроля полноты; points — распознанные. */
export async function fetchPointBatch(creds: DeliveryCredentials, ids: number[]): Promise<{ received: number; points: OzonPickupDetail[] }> {
  if (!ids.length) return { received: 0, points: [] }
  if (ids.length > 100) throw new OzonValidationError('point/info принимает не более 100 id за раз')
  const data = await ozonPost(creds, '/v1/delivery/point/info', { map_point_ids: ids })
  const raw = pointsArray(data)
  return { received: raw.length, points: raw.map(normalizeInfoPoint).filter((p): p is OzonPickupDetail => Boolean(p)) }
}

/** Распознанные детали для пачки id. */
export async function fetchPointDetails(creds: DeliveryCredentials, ids: number[]): Promise<OzonPickupDetail[]> {
  return (await fetchPointBatch(creds, ids)).points
}

/** Повторное подтверждение одного ПВЗ перед созданием заказа (live point/info). */
export async function getPickupPoint(creds: DeliveryCredentials, code: string): Promise<PickupPoint> {
  const id = Number(code)
  if (!code || !Number.isFinite(id)) throw new OzonValidationError()
  const [detail] = await fetchPointDetails(creds, [id])
  if (!detail || detail.code !== code) throw new OzonValidationError()
  return { code: detail.code, city: detail.city, name: detail.name, address: detail.address }
}

/**
 * Пинг связи для админского «Проверить связь»: тянет список id и обогащает первые
 * ≤100 через point/info. НЕ для клиентского поиска (тот идёт по локальному каталогу),
 * поэтому фильтр по городу здесь — лучшее усилие на выборке. Вызывается редко
 * (rate-limit), допускает крупный ответ point/list.
 */
export async function listPickupPoints(creds: DeliveryCredentials, city?: string): Promise<PickupPoint[]> {
  const ids = await fetchAllPointIds(creds)
  if (!ids.length) return []
  const details = await fetchPointDetails(creds, ids.slice(0, 100))
  const points = details.map((d) => ({ code: d.code, city: d.city, name: d.name, address: d.address }))
  const needle = city?.trim().toLowerCase()
  return needle ? points.filter((p) => p.city.toLowerCase().includes(needle)) : points
}

export function ozonProvider(creds: DeliveryCredentials): CarrierProvider {
  return { listPickupPoints: (city) => listPickupPoints(creds, city), getPickupPoint: (code) => getPickupPoint(creds, code) }
}
