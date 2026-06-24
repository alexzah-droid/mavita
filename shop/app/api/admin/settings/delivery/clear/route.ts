import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { type Carrier, clearCarrierCredentials } from '@/lib/store-settings'

function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }

// «Удалить ключи»: выключает перевозчика и стирает client_id + ciphertext (тариф
// сохраняется). Единственный способ удалить скомпрометированный ключ; пустое поле
// формы никогда не означает clear.
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'carrier') || (body as Record<string, unknown>).carrier !== 'cdek') {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Ожидается { carrier: cdek }'] } }, { status: 400, headers: noStore })
  }
  const settings = await clearCarrierCredentials((body as { carrier: Carrier }).carrier, auth.loginAt)
  return NextResponse.json(settings, { headers: noStore })
}
