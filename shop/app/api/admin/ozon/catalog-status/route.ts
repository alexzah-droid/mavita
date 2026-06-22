import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { getOzonSyncState } from '@/lib/ozon-catalog'
import { getOzonFbsWarehouse } from '@/lib/store-settings'
import { getCatalogSummary, listRecentRuns } from '@/lib/ozon-fbs-sync'
import { catalogSyncEnabled } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }

/** Сводка каталога товаров + статус ПВЗ + выбранный склад + последние run-ы. Без секретов. */
export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const [summary, warehouse, pickup, recentRuns] = await Promise.all([getCatalogSummary(), getOzonFbsWarehouse(), getOzonSyncState(), listRecentRuns(8)])
  return NextResponse.json({
    summary, warehouse, pickup, recentRuns,
    catalogSyncEnabled: catalogSyncEnabled(),
    orderFlowEnabled: process.env.OZON_LOGISTICS_ORDER_FLOW_ENABLED === 'true',
  }, { headers: noStore })
}
