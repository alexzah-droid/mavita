import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { canSetNonZeroStock, getOzonProfile } from '@/lib/ozon-fbs-profile'
import { catalogSyncEnabled, enqueueSingle } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/**
 * Stock-only либо zero-stock задача. Ненулевой остаток требует hidden_confirmed.
 * `{ zero: true }` принудительно обнуляет остаток.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  if (!catalogSyncEnabled()) return err('CATALOG_SYNC_DISABLED', ['Синхронизация каталога Ozon выключена'], 409)
  const body = await request.json().catch(() => ({}))
  const zero = body && typeof body === 'object' && (body as { zero?: unknown }).zero === true
  const profile = await getOzonProfile(id)
  if (!profile) return err('NOT_FOUND', ['Профиль Ozon не найден'], 404)
  if (zero) {
    const run = await enqueueSingle('zero_stock', id, auth.loginAt)
    return NextResponse.json({ run }, { headers: noStore })
  }
  if (profile.fbsStockQuantity > 0 && !canSetNonZeroStock(profile)) {
    return err('CONFLICT', ['Ненулевой остаток доступен только после подтверждённого скрытия карточки'], 409)
  }
  const run = await enqueueSingle(profile.fbsStockQuantity > 0 ? 'stock_update' : 'zero_stock', id, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
