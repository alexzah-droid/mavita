import { NextResponse } from 'next/server'
import { cdekWidgetProxy } from '@/lib/cdek'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { DeliveryConfigurationError, getRuntimeCredentials } from '@/lib/store-settings'
import { allowRequest, clientIp } from '@/lib/public-rate-limit'

const noStore = { 'Cache-Control': 'no-store' }
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: noStore })

// servicePath виджета СДЭК (`@cdek-it/widget`). Калька эталонного dist/service.php:
// merge(query, JSON-body) → обязателен `action` → offices|calculate проксируются в
// СДЭК нашим OAuth, тело отдаётся виджету verbatim. Ключи СДЭК на клиент не уходят.
async function handle(request: Request) {
  if (!allowRequest(`cdek:widget:${clientIp(request)}`, 120, 60_000)) return fail('Слишком много запросов', 429)
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch (error) { if (error instanceof DeliveryConfigurationError) return fail('Доставка временно недоступна', 503); throw error }
  if (!creds) return fail('Доставка временно недоступна', 503)

  const params: Record<string, unknown> = {}
  for (const [key, value] of new URL(request.url).searchParams) params[key] = value
  if (request.method === 'POST') { const body = await request.json().catch(() => null); if (body && typeof body === 'object' && !Array.isArray(body)) Object.assign(params, body) }
  const action = params.action
  delete params.action
  if (action !== 'offices' && action !== 'calculate') return fail('Unknown action', 400)

  // Разрешаем только ПВЗ — постаматы исключены на уровне данных.
  if (action === 'offices') params.type = 'PVZ'

  try {
    const { status, body } = await cdekWidgetProxy(creds, action, params)
    return new NextResponse(body, { status, headers: { 'Content-Type': 'application/json', ...noStore } })
  } catch (error) {
    return fail(error instanceof DeliveryProviderError ? error.message : 'Доставка временно недоступна', 503)
  }
}

export const GET = handle
export const POST = handle
