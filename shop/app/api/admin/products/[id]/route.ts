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
  catch (err) {
    // SALE_PRICE_INVALID — наша проверка итогового состояния; 23514 — та же
    // защита на уровне DB CHECK (products_sale_below_price). Оба → один 400, без
    // деталей PostgreSQL. 23505 — дубль slug.
    if ((err as Error).message === 'SALE_PRICE_INVALID' || (err as { code?: string }).code === '23514') return error('VALIDATION_ERROR', ['Цена скидки должна быть ниже обычной'], 400)
    if ((err as { code?: string }).code === '23505') return error('CONFLICT', ['Slug уже используется'], 409); throw err
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf; const id = await idOf(params); if (!id) return error('VALIDATION_ERROR', ['Некорректный id'], 400)
  const body = await request.json().catch(() => null)
  // confirmationName обязателен, string, сравнивается без trim/нормализации. Пустой
  // или некорректный JSON → 400 до удаления (серверная проверка обязательна, §4).
  if (!body || typeof body.confirmationName !== 'string') return error('VALIDATION_ERROR', ['Подтвердите удаление точным названием товара'], 400)
  const result = await deleteAdminProduct(id, body.confirmationName)
  if (result === 'not_found') return error('NOT_FOUND', ['Товар не найден'], 404)
  if (result === 'name_mismatch') return error('VALIDATION_ERROR', ['Название для подтверждения не совпадает'], 400)
  return NextResponse.json({ ok: true })
}
