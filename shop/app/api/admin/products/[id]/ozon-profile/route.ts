import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { getAdminProduct } from '@/lib/admin-products-db'
import { ensureOzonProfile, getOzonProfile, updateOzonProfileFields, validateOzonProfileInput } from '@/lib/ozon-fbs-profile'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/** Профиль и статус без секретов (создаёт дефолтный при первом обращении). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  if (!(await getAdminProduct(id))) return err('NOT_FOUND', ['Товар не найден'], 404)
  const profile = (await getOzonProfile(id)) ?? (await ensureOzonProfile(id))
  return NextResponse.json(profile, { headers: noStore })
}

/** Валидация и сохранение технических полей профиля. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  if (!(await getAdminProduct(id))) return err('NOT_FOUND', ['Товар не найден'], 404)
  const parsed = validateOzonProfileInput(await request.json().catch(() => null))
  if (!parsed.value) return err('VALIDATION_ERROR', parsed.errors, 400)
  try {
    const profile = await updateOzonProfileFields(id, parsed.value)
    return profile ? NextResponse.json(profile, { headers: noStore }) : err('NOT_FOUND', ['Профиль не найден'], 404)
  } catch (e) {
    // 23505 — конфликт уникального штрихкода между карточками.
    if ((e as { code?: string }).code === '23505') return err('CONFLICT', ['Штрихкод уже используется другим товаром'], 409)
    throw e
  }
}
