import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { catalogSyncEnabled, enqueueBulk, selectImportableProductIds } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/**
 * Массовый content-import готовых enabled-профилей с нулевым остатком. Требует
 * явного confirm=true и включённого dark-gate. На Ozon уходит нулевой остаток;
 * каждую карточку оператор затем скрывает в ЛК вручную.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  if (!catalogSyncEnabled()) return err('CATALOG_SYNC_DISABLED', ['Синхронизация каталога Ozon выключена'], 409)
  const body = await request.json().catch(() => null)
  if (!body || (body as { confirm?: unknown }).confirm !== true) return err('VALIDATION_ERROR', ['Подтвердите массовую загрузку: confirm=true'], 400)
  const ids = await selectImportableProductIds()
  if (!ids.length) return err('VALIDATION_ERROR', ['Нет готовых enabled-профилей для загрузки'], 400)
  const run = await enqueueBulk('content_import', ids, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
