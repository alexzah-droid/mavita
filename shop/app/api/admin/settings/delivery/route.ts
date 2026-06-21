import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { type Carrier, type CarrierPatch, DeliveryConfigurationError, getDeliverySettings, saveCarrierSettings } from '@/lib/store-settings'

function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const bad = (messages: string[], status = 400) => NextResponse.json({ error: { code: status === 409 ? 'CARRIER_INCOMPLETE' : 'VALIDATION_ERROR', messages } }, { status, headers: noStore })

const ALLOWED = new Set(['carrier', 'enabled', 'clientId', 'secret', 'deliveryKopecks'])

// Строгий разбор PATCH. Пустое/отсутствующее поле секрета = «не менять»; присланная
// маска отвергается; clientId/deliveryKopecks обязаны быть валидными, если присланы.
function parsePatch(body: unknown): { carrier: Carrier; patch: CarrierPatch } | { error: string[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: ['Некорректное тело запроса'] }
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) if (!ALLOWED.has(key)) return { error: [`Неизвестное поле: ${key}`] }
  if (b.carrier !== 'cdek' && b.carrier !== 'ozon') return { error: ['Неизвестный перевозчик'] }
  const patch: CarrierPatch = {}
  if ('enabled' in b) { if (typeof b.enabled !== 'boolean') return { error: ['enabled должно быть boolean'] }; patch.enabled = b.enabled }
  if ('clientId' in b) {
    if (typeof b.clientId !== 'string') return { error: ['clientId должен быть строкой'] }
    const id = b.clientId.trim(); if (id.length < 1 || id.length > 256) return { error: ['clientId: 1…256 символов'] }
    patch.clientId = id
  }
  if ('secret' in b) {
    if (typeof b.secret !== 'string') return { error: ['secret должен быть строкой'] }
    const s = b.secret.trim()
    if (s.startsWith('••••')) return { error: ['Маска не принимается как новый секрет'] }
    if (s.length > 512) return { error: ['secret: до 512 символов'] }
    if (s.length > 0) patch.secret = s // пустая строка = «не менять»
  }
  if ('deliveryKopecks' in b) {
    if (typeof b.deliveryKopecks !== 'number' || !Number.isSafeInteger(b.deliveryKopecks) || b.deliveryKopecks < 0) return { error: ['deliveryKopecks должно быть целым ≥ 0'] }
    patch.deliveryKopecks = b.deliveryKopecks
  }
  return { carrier: b.carrier as Carrier, patch }
}

export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  return NextResponse.json(await getDeliverySettings(), { headers: noStore })
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (body === null) return bad(['Некорректный JSON'])
  const parsed = parsePatch(body)
  if ('error' in parsed) return bad(parsed.error)
  try {
    const settings = await saveCarrierSettings(parsed.carrier, parsed.patch, auth.loginAt)
    return NextResponse.json(settings, { headers: noStore })
  } catch (error) {
    if (error instanceof DeliveryConfigurationError) return bad([error.message], 409)
    throw error
  }
}
