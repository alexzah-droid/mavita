import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { catalogSyncEnabled, confirmHidden } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/**
 * Аудируемо подтвердить ручное скрытие в ЛК после модерации. НЕ вызывает
 * visibility/set — лишь записывает actor/time и переводит в hidden_confirmed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  if (!catalogSyncEnabled()) return err('CATALOG_SYNC_DISABLED', ['Синхронизация каталога Ozon выключена'], 409)
  const result = await confirmHidden(id, auth.loginAt)
  if (result.ok) return NextResponse.json({ profile: result.profile }, { headers: noStore })
  if (result.reason === 'not_found') return err('NOT_FOUND', ['Профиль Ozon не найден'], 404)
  if (result.reason === 'wrong_state') return err('CONFLICT', ['Подтвердить скрытие можно только после прохождения модерации'], 409)
  return err('VALIDATION_ERROR', ['Не удалось подтвердить скрытие'], 400)
}
