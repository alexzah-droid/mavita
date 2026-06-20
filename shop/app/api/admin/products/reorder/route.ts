import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { reorderPublicProducts } from '@/lib/admin-products-db'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.productIds) || body.productIds.some((id: unknown) => !Number.isInteger(id))) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Ожидается полный список productIds'] } }, { status: 400 })
  return (await reorderPublicProducts(body.productIds)) === 'ok' ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { code: 'CONFLICT', messages: ['Список витрины изменился'] } }, { status: 409 })
}
