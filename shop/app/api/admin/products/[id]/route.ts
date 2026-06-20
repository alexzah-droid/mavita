import { NextResponse } from 'next/server'
import { requireAdminApi, assertSameOrigin } from '@/lib/auth'
import { deleteAdminProduct, getAdminProduct, updateAdminProduct } from '@/lib/admin-products-db'
import { validateProductInput } from '@/lib/products-admin'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
function error(code: string, messages: string[], status: number) { return NextResponse.json({ error: { code, messages } }, { status }) }
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const id = await idOf(params); if (!id) return error('VALIDATION_ERROR', ['Некорректный id'], 400)
  const product = await getAdminProduct(id); return product ? NextResponse.json(product) : error('NOT_FOUND', ['Товар не найден'], 404)
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf; const id = await idOf(params); if (!id) return error('VALIDATION_ERROR', ['Некорректный id'], 400)
  const parsed = validateProductInput(await request.json().catch(() => null), 'patch'); if (!parsed.value) return error('VALIDATION_ERROR', parsed.errors, 400)
  try { const product = await updateAdminProduct(id, parsed.value); return product ? NextResponse.json(product) : error('NOT_FOUND', ['Товар не найден'], 404) }
  catch (err) { if ((err as Error).message === 'SALE_PRICE_INVALID') return error('VALIDATION_ERROR', ['Цена скидки должна быть ниже обычной'], 400); if ((err as { code?: string }).code === '23505') return error('CONFLICT', ['Slug уже используется'], 409); throw err }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf; const id = await idOf(params); if (!id) return error('VALIDATION_ERROR', ['Некорректный id'], 400)
  return await deleteAdminProduct(id) ? NextResponse.json({ ok: true }) : error('NOT_FOUND', ['Товар не найден'], 404)
}
