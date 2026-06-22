import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { catalogSyncEnabled, enqueueBulk, selectHiddenConfirmedProductIds } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Массовый stock-only run только для подтверждённо скрытых карточек. */
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  if (!catalogSyncEnabled()) return err('CATALOG_SYNC_DISABLED', ['Синхронизация каталога Ozon выключена'], 409)
  const ids = await selectHiddenConfirmedProductIds()
  if (!ids.length) return err('VALIDATION_ERROR', ['Нет подтверждённо скрытых карточек'], 400)
  const run = await enqueueBulk('stock_update', ids, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
