import { NextResponse } from 'next/server'
import { requireAdminApi, assertSameOrigin } from '@/lib/auth'
import { createAdminProduct, listAdminProducts } from '@/lib/admin-products-db'
import { validateProductInput } from '@/lib/products-admin'
import type { Visibility } from '@/lib/products'
function error(code: string, messages: string[], status: number) { return NextResponse.json({ error: { code, messages } }, { status }) }
function authenticated(result: Awaited<ReturnType<typeof requireAdminApi>>): result is { isAdmin: true; loginAt: number } { return !(result instanceof NextResponse) }
export async function GET(request: Request) {
  const auth = await requireAdminApi(); if (!authenticated(auth)) return auth
  const raw = new URL(request.url).searchParams.get('visibility') ?? 'all'
  if (!['all', 'public', 'unlisted', 'hidden'].includes(raw)) return error('VALIDATION_ERROR', ['Некорректный фильтр видимости'], 400)
  return NextResponse.json({ products: await listAdminProducts(raw as Visibility | 'all') })
}
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authenticated(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const parsed = validateProductInput(await request.json().catch(() => null), 'create')
  if (!parsed.value) return error('VALIDATION_ERROR', parsed.errors, 400)
  try { return NextResponse.json(await createAdminProduct(parsed.value), { status: 201 }) }
  catch (err) { if ((err as { code?: string }).code === '23505') return error('CONFLICT', ['Slug уже используется'], 409); throw err }
}
