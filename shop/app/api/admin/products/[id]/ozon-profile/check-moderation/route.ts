import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { getOzonProfile, isAwaitingModeration } from '@/lib/ozon-fbs-profile'
import { enqueueSingle } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/** Read-only проверка статуса модерации (доступна и при выключенном dark-gate). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  const profile = await getOzonProfile(id)
  if (!profile) return err('NOT_FOUND', ['Профиль Ozon не найден'], 404)
  if (!isAwaitingModeration(profile)) return err('CONFLICT', ['Карточка не ожидает модерации'], 409)
  // read-only poll ставится в очередь; исполняет worker/CLI. UI опрашивает статус run.
  const run = await enqueueSingle('moderation_poll', id, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
