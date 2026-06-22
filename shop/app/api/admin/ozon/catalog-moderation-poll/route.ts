import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { selectModerationPollProductIds } from '@/lib/ozon-fbs-sync'
import { enqueueBulk } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Массовый read-only moderation poll (доступен и при выключенном dark-gate). */
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const ids = await selectModerationPollProductIds()
  if (!ids.length) return err('VALIDATION_ERROR', ['Нет карточек, ожидающих модерации'], 400)
  const run = await enqueueBulk('moderation_poll', ids, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
