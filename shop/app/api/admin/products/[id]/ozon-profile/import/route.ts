import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { canImport, getOzonProfile } from '@/lib/ozon-fbs-profile'
import { catalogSyncEnabled, enqueueSingle } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/**
 * Ручной single-item import. Карточка станет публичной с остатком 0; скрытие —
 * ручной шаг оператора в ЛК. Требует включённого OZON_CATALOG_SYNC_ENABLED.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  if (!catalogSyncEnabled()) return err('CATALOG_SYNC_DISABLED', ['Синхронизация каталога Ozon выключена (OZON_CATALOG_SYNC_ENABLED)'], 409)
  const profile = await getOzonProfile(id)
  if (!profile) return err('NOT_FOUND', ['Профиль Ozon не найден'], 404)
  if (!canImport(profile)) return err('CONFLICT', ['Импорт недоступен в текущем состоянии (выключен или уже выполняется)'], 409)
  // Endpoint только ставит run; исполняет worker/CLI по lease-модели.
  const run = await enqueueSingle('content_import', id, auth.loginAt)
  return NextResponse.json({ run }, { headers: noStore })
}
