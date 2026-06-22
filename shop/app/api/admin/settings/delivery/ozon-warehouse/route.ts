import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { OzonApiError } from '@/lib/ozon-fbs-client'
import { getOzonFbsWarehouse, saveOzonFbsWarehouse } from '@/lib/store-settings'
import { makeReadOnlyOzonClient, OzonCredentialsMissing } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Текущий выбранный FBS-склад. */
export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  return NextResponse.json({ warehouse: await getOzonFbsWarehouse() }, { headers: noStore })
}

/**
 * Выбрать ровно один уже созданный FBS-склад. Перед сохранением — read-only проверка
 * существования и типа `fbs`. Склад приложением не создаётся/не меняется. `null`
 * очищает выбор.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('VALIDATION_ERROR', ['Некорректное тело запроса'], 400)
  const raw = (body as { warehouseId?: unknown }).warehouseId
  if (raw === null) return NextResponse.json({ warehouse: await saveOzonFbsWarehouse(null, null, auth.loginAt) }, { headers: noStore })
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return err('VALIDATION_ERROR', ['warehouseId — целое число > 0 или null'], 400)
  try {
    const warehouse = await (await makeReadOnlyOzonClient()).findWarehouse(raw)
    if (!warehouse) return err('VALIDATION_ERROR', ['Склад не найден среди доступных'], 400)
    if (warehouse.type !== 'fbs') return err('VALIDATION_ERROR', ['Выбранный склад не является FBS'], 400)
    return NextResponse.json({ warehouse: await saveOzonFbsWarehouse(warehouse.warehouseId, warehouse.name, auth.loginAt) }, { headers: noStore })
  } catch (error) {
    if (error instanceof OzonCredentialsMissing) return err('OZON_NOT_CONFIGURED', ['Ключи Ozon не заданы'], 409)
    if (error instanceof OzonApiError) return err('OZON_UPSTREAM', [error.message], 502)
    throw error
  }
}
