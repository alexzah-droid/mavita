export type PickupPoint = { code: string; city: string; name: string; address: string }
export class CdekValidationError extends Error { constructor(message = 'Пункт выдачи СДЭК недоступен', public unavailable = false) { super(message); this.name = 'CdekValidationError' } }

let tokenCache: { token: string; expiresAt: number } | undefined
function baseUrl() { return (process.env.CDEK_API_BASE || 'https://api.cdek.ru/v2').replace(/\/$/, '') }
function credentials() { return { id: process.env.CDEK_CLIENT_ID?.trim(), secret: process.env.CDEK_CLIENT_SECRET?.trim() } }

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token
  const { id, secret } = credentials()
  if (!id || !secret) throw new CdekValidationError('Доставка временно недоступна', true)
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret })
  let response: Response
  try { response = await fetch(`${baseUrl()}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  if (!response.ok || !data?.access_token) throw new CdekValidationError('Доставка временно недоступна', true)
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 }
  return tokenCache.token
}

function normalize(raw: unknown): PickupPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>; const location = value.location as Record<string, unknown> | undefined
  const code = String(value.code ?? '').trim(); const city = String(location?.city ?? value.city ?? '').trim()
  const name = String(value.name ?? value.address_full ?? '').trim(); const address = String(location?.address ?? value.address ?? value.address_full ?? '').trim()
  return code && city && name && address ? { code, city, name, address } : undefined
}

export async function getPickupPoint(code: string): Promise<PickupPoint> {
  if (!code || code.length > 128) throw new CdekValidationError()
  let response: Response
  try { response = await fetch(`${baseUrl()}/deliverypoints?code=${encodeURIComponent(code)}&is_active=true`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null)
  const point = Array.isArray(data) ? data.map(normalize).find((item) => item?.code === code) : normalize(data)
  if (!response.ok || !point) throw new CdekValidationError()
  return point
}

export async function listPickupPoints(city?: string): Promise<PickupPoint[]> {
  const params = new URLSearchParams({ is_active: 'true', type: 'PVZ' }); if (city?.trim()) params.set('city', city.trim())
  let response: Response
  try { response = await fetch(`${baseUrl()}/deliverypoints?${params}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: 'no-store' }) } catch { throw new CdekValidationError('Доставка временно недоступна', true) }
  const data = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(data)) throw new CdekValidationError('Доставка временно недоступна', true)
  return data.map(normalize).filter((point): point is PickupPoint => Boolean(point))
}
