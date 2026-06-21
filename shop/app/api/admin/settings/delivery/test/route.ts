import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { type Carrier, getStoredCredentials } from '@/lib/store-settings'
import { providerFor } from '@/lib/delivery/providers'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { registerDeliveryTestAttempt } from '@/lib/delivery-test-rate-limit'

function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const TEST_CITY = 'Москва'
const ALLOWED = new Set(['carrier', 'clientId', 'secret'])

// IP из trusted-proxy chain, а не из пользовательского значения. Nginx ставит
// X-Real-IP в реальный remote_addr и ДОБАВЛЯЕТ его в конец X-Forwarded-For; клиент
// может подделать только левые элементы XFF. Поэтому берём X-Real-IP, иначе —
// ПОСЛЕДНИЙ (ближайший к серверу), а не первый элемент XFF.
function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) { const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1] }
  return 'unknown'
}

// «Проверить связь»: серверный пинг API перевозчика списком ПВЗ по тестовому городу.
// Источник ключей — сохранённые (даже у выключенного) + наложенные draft из тела;
// можно проверить ключи ДО включения и до сохранения. Тело ответа перевозчика и
// секрет наружу не уходят. Лимит общий между инстансами.
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Некорректное тело'] } }, { status: 400, headers: noStore })
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) if (!ALLOWED.has(key)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: [`Неизвестное поле: ${key}`] } }, { status: 400, headers: noStore })
  const invalid = (m: string) => NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: [m] } }, { status: 400, headers: noStore })
  if (b.carrier !== 'cdek' && b.carrier !== 'ozon') return invalid('Неизвестный перевозчик')
  const carrier = b.carrier as Carrier

  // Строгий draft-контракт. Присланное поле должно быть валидным значением, а не
  // тихо подменяться сохранённым: иначе оператор думает, что проверяет новый ключ,
  // а тестируется старый. «Не присылать поле» (omitted) = тестировать сохранённый.
  let draftClientId: string | undefined
  if ('clientId' in b) {
    if (typeof b.clientId !== 'string') return invalid('clientId должен быть строкой')
    draftClientId = b.clientId.trim()
    if (draftClientId.length < 1 || draftClientId.length > 256) return invalid('clientId: 1…256 символов')
  }
  let draftSecret: string | undefined
  if ('secret' in b) {
    if (typeof b.secret !== 'string') return invalid('secret должен быть строкой')
    draftSecret = b.secret.trim()
    if (draftSecret.startsWith('••••')) return invalid('Маска не принимается — введите новый ключ или уберите поле')
    if (draftSecret.length < 1 || draftSecret.length > 512) return invalid('secret: 1…512 символов')
  }

  const limit = await registerDeliveryTestAttempt(auth.loginAt, clientIp(request))
  if (!limit.ok) return NextResponse.json({ error: { code: 'RATE_LIMITED', messages: ['Слишком много попыток. Попробуйте позже.'] } }, { status: 429, headers: { ...noStore, 'Retry-After': String(limit.retryAfterSeconds) } })

  // Сохранённые ключи + наложенные draft: проверка первого подключения и замены.
  const stored = await getStoredCredentials(carrier).catch(() => undefined)
  const clientId = draftClientId ?? stored?.clientId
  const secret = draftSecret ?? stored?.secret
  if (!clientId || !secret) return NextResponse.json({ error: { code: 'credentials_missing', messages: ['Заполните ключи перед проверкой'] } }, { status: 409, headers: noStore })

  try {
    const provider = providerFor(carrier, { clientId, secret })
    const points = await Promise.race([
      provider.listPickupPoints(TEST_CITY),
      new Promise<never>((_, reject) => setTimeout(() => reject(new DeliveryProviderError('timeout', true)), 5000)),
    ])
    return NextResponse.json({ ok: true, sampleCount: points.length }, { headers: noStore })
  } catch (error) {
    // Без тела ответа перевозчика и без секрета: только классификация.
    // auth_failed — перевозчик ответил 401/403; unavailable — сеть/таймаут/прочее.
    const code = error instanceof DeliveryProviderError && error.authFailed ? 'auth_failed' : 'unavailable'
    return NextResponse.json({ ok: false, code }, { headers: noStore })
  }
}
