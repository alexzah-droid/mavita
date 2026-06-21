// Провайдер ПВЗ СДЭК. Credentials приходят ЯВНО (из зашифрованных настроек, не из
// env) — модуль их не читает из БД сам. OAuth-токен кэшируется по fingerprint
// credentials: смена ключа в админке автоматически инвалидирует токен на каждом
// воркере, без pm2 reload.
import type { CarrierProvider, DeliveryCredentials, PickupPoint } from '@/lib/delivery/types'
import { DeliveryProviderError } from '@/lib/delivery/types'

export type { PickupPoint }
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
  return code && city && name && address ? { code, city, name, address } : undefined
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

export async function listPickupPoints(creds: DeliveryCredentials, city?: string): Promise<PickupPoint[]> {
  const params = new URLSearchParams({ is_active: 'true', type: 'PVZ' }); if (city?.trim()) params.set('city', city.trim())
  const token = await accessToken(creds) // вне try — см. getPickupPoint
  let response: Response
  try { response = await fetch(`${baseUrl()}/deliverypoints?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null)
  if (response.status === 401 || response.status === 403) throw new CdekValidationError('Доставка временно недоступна', true, true)
  if (!response.ok || !Array.isArray(data)) throw new CdekValidationError('Доставка временно недоступна', true)
  return data.map(normalize).filter((point): point is PickupPoint => Boolean(point))
}

/** Провайдер с привязанными credentials — реализация общего CarrierProvider. */
export function cdekProvider(creds: DeliveryCredentials): CarrierProvider {
  return { listPickupPoints: (city) => listPickupPoints(creds, city), getPickupPoint: (code) => getPickupPoint(creds, code) }
}
