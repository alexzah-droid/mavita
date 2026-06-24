// Провайдер ПВЗ СДЭК. Credentials приходят ЯВНО (из зашифрованных настроек, не из
// env) — модуль их не читает из БД сам. OAuth-токен кэшируется по fingerprint
// credentials: смена ключа в админке автоматически инвалидирует токен на каждом
// воркере, без pm2 reload.
import type { CarrierProvider, DeliveryCredentials, PickupPoint } from '@/lib/delivery/types'
import { DeliveryProviderError } from '@/lib/delivery/types'

export type { PickupPoint }
// Город СДЭК: code — числовой city_code (им фильтруется /deliverypoints), а НЕ название.
export type CdekCity = { code: number; city: string; region: string | null }
// Сохраняем исторический класс ошибки СДЭК (его ловят robokassa/init и /api/cdek),
// теперь как наследника общего DeliveryProviderError.
export class CdekValidationError extends DeliveryProviderError {
  constructor(message = 'Пункт выдачи СДЭК недоступен', unavailable = false, authFailed = false) { super(message, unavailable, authFailed); this.name = 'CdekValidationError' }
}
function isAuthStatus(status: number) { return status === 401 || status === 403 }

let tokenCache: { token: string; expiresAt: number; fingerprint: string } | undefined
function baseUrl() { return (process.env.CDEK_API_BASE || 'https://api.cdek.ru/v2').replace(/\/$/, '') }
function fingerprintOf(creds: DeliveryCredentials) { return creds.fingerprint ?? `${creds.clientId}:${creds.secret}` }

async function accessToken(creds: DeliveryCredentials): Promise<string> {
  const fp = fingerprintOf(creds)
  if (tokenCache && tokenCache.fingerprint === fp && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.secret })
  let response: Response
  try { response = await fetch(`${baseUrl()}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  if (!response.ok || !data?.access_token) throw new CdekValidationError('Доставка временно недоступна', true, isAuthStatus(response.status))
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000, fingerprint: fp }
  return tokenCache.token
}

function normalize(raw: unknown): PickupPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>; const location = value.location as Record<string, unknown> | undefined
  const code = String(value.code ?? '').trim(); const city = String(location?.city ?? value.city ?? '').trim()
  const name = String(value.name ?? value.address_full ?? '').trim(); const address = String(location?.address ?? value.address ?? value.address_full ?? '').trim()
  const workTime = value.work_time != null && String(value.work_time).trim() ? String(value.work_time).trim() : undefined
  return code && city && name && address ? { code, city, name, address, workTime } : undefined
}

export async function getPickupPoint(creds: DeliveryCredentials, code: string): Promise<PickupPoint> {
  if (!code || code.length > 128) throw new CdekValidationError()
  // Токен получаем ВНЕ try: иначе CdekValidationError(authFailed) из accessToken
  // была бы перехвачена и заменена на generic «недоступна» без флага auth_failed.
  const token = await accessToken(creds)
  let response: Response
  try { response = await fetch(`${baseUrl()}/deliverypoints?code=${encodeURIComponent(code)}&is_active=true`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null)
  const point = Array.isArray(data) ? data.map(normalize).find((item) => item?.code === code) : normalize(data)
  if (response.status === 401 || response.status === 403) throw new CdekValidationError('Доставка временно недоступна', true, true)
  if (!response.ok || !point) throw new CdekValidationError()
  return point
}

// Аутентифицированный GET к API СДЭК с едиными правилами ошибок списочных
// методов (auth → authFailed; сеть/не-2xx/не-массив → unavailable). Токен берём
// ВНЕ try — иначе CdekValidationError(authFailed) из accessToken была бы съедена.
async function authedGetArray(creds: DeliveryCredentials, path: string, params: URLSearchParams): Promise<unknown[]> {
  const token = await accessToken(creds)
  let response: Response
  try { response = await fetch(`${baseUrl()}${path}?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  if (response.status === 401 || response.status === 403) throw new CdekValidationError('Доставка временно недоступна', true, true)
  const data = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(data)) throw new CdekValidationError('Доставка временно недоступна', true)
  return data
}

function normalizeCity(raw: unknown): CdekCity | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const code = Number(value.code); const city = String(value.city ?? '').trim()
  if (!Number.isInteger(code) || code <= 0 || !city) return undefined
  const region = value.region != null && String(value.region).trim() ? String(value.region).trim() : null
  return { code, city, region }
}

// Поиск города по названию (/v2/location/cities фильтрует по name, отдаёт числовой code).
// Используется и автокомплитом, и резолвом IP-города → city_code. Возвращает [] на
// пустой/слишком длинный ввод, не дёргая API.
async function fetchCities(creds: DeliveryCredentials, query: string, size: number): Promise<CdekCity[]> {
  const q = query.trim(); if (!q || q.length > 128) return []
  const params = new URLSearchParams({ country_codes: 'RU', size: String(size), city: q })
  const data = await authedGetArray(creds, '/location/cities', params)
  return data.map(normalizeCity).filter((c): c is CdekCity => Boolean(c))
}

export async function suggestCities(creds: DeliveryCredentials, query: string): Promise<CdekCity[]> {
  return fetchCities(creds, query, 20)
}

// Город → один city_code. Предпочитаем точное совпадение названия (тёзки/префиксы),
// иначе первый ответ СДЭК. null, если город не найден.
export async function resolveCity(creds: DeliveryCredentials, name: string): Promise<CdekCity | null> {
  const cities = await fetchCities(creds, name, 10); if (!cities.length) return null
  const needle = name.trim().toLowerCase()
  return cities.find((c) => c.city.toLowerCase() === needle) ?? cities[0]
}

// ПВЗ по СТАБИЛЬНОМУ city_code — единственный корректный фильтр СДЭК.
export async function listPickupPointsByCityCode(creds: DeliveryCredentials, cityCode: number): Promise<PickupPoint[]> {
  if (!Number.isInteger(cityCode) || cityCode <= 0) throw new CdekValidationError()
  const params = new URLSearchParams({ is_active: 'true', type: 'PVZ', city_code: String(cityCode) })
  const data = await authedGetArray(creds, '/deliverypoints', params)
  return data.map(normalize).filter((point): point is PickupPoint => Boolean(point))
}

// Совместимость с CarrierProvider (admin «Проверить связь», name-based вызовы):
// резолвим название → city_code → ПВЗ. БЕЗ города возвращаем [], а НЕ весь
// национальный список (прежний баг: `city`-параметр СДЭК игнорировал и отдавал всё).
export async function listPickupPoints(creds: DeliveryCredentials, city?: string): Promise<PickupPoint[]> {
  if (!city?.trim()) return []
  const resolved = await resolveCity(creds, city)
  return resolved ? listPickupPointsByCityCode(creds, resolved.code) : []
}

/** Провайдер с привязанными credentials — реализация общего CarrierProvider. */
export function cdekProvider(creds: DeliveryCredentials): CarrierProvider {
  return { listPickupPoints: (city) => listPickupPoints(creds, city), getPickupPoint: (code) => getPickupPoint(creds, code) }
}

export type CdekProxyResult = { status: number; body: string }

// Сырой проксированный вызов СДЭК для виджета `@cdek-it/widget`. Тело ответа СДЭК
// возвращаем КАК ЕСТЬ (виджет ждёт нативный JSON, без обёртки) — точная калька
// эталонного dist/service.php: offices → GET /deliverypoints; calculate →
// POST /calculator/tarifflist (JSON). Авторизация — наш accessToken (вне try,
// чтобы authFailed не превратился в generic unavailable).
export async function cdekWidgetProxy(creds: DeliveryCredentials, action: 'offices' | 'calculate', params: Record<string, unknown>): Promise<CdekProxyResult> {
  const token = await accessToken(creds)
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-App-Name': 'widget_pvz' }
  let response: Response
  try {
    if (action === 'offices') {
      const qs = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) if (value != null) qs.set(key, String(value))
      response = await fetch(`${baseUrl()}/deliverypoints?${qs}`, { headers, cache: 'no-store' })
    } else {
      response = await fetch(`${baseUrl()}/calculator/tarifflist`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store' })
    }
  } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  if (response.status === 401 || response.status === 403) throw new CdekValidationError('Доставка временно недоступна', true, true)
  return { status: response.status, body: await response.text() }
}
