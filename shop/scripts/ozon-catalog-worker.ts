// Фоновый worker FBS-каталога Ozon (по расписанию). Делает ТОЛЬКО:
//  - read-only moderation_poll профилей awaiting_moderation (даже при выключенном
//    dark-gate): MODERATED → awaiting_manual_hide, отклонение/таймаут → failed;
//  - при OZON_CATALOG_SYNC_ENABLED=true — stock_update подтверждённо скрытых
//    карточек (stock_dirty) и zero_stock ранее импортированных disabled-профилей.
// НЕ делает content-import и НЕ меняет видимость (visibility/set не вызывается).
// Ключ читает из зашифрованных настроек БД через secret-box-core (не server-only —
// для запуска под tsx).
//   SETTINGS_ENC_KEY=... DATABASE_URL=... NEXT_PUBLIC_BASE_URL=... npx tsx scripts/ozon-catalog-worker.ts
import { query } from '@/lib/db'
import { decryptSecret } from '@/lib/secret-box-core'
import type { DeliveryCredentials } from '@/lib/delivery/types'
import { createOzonFbsClient, type OzonFbsClient } from '@/lib/ozon-fbs-client'
import {
  catalogSyncEnabled, enqueueRun, processQueuedRuns, selectModerationPollProductIds,
  selectStockUpdateProductIds, selectZeroStockProductIds, type SyncOperation, type WorkerDeps,
} from '@/lib/ozon-fbs-sync'
import { sendOpsAlert } from '@/lib/ops-alert'

async function loadCredentials(): Promise<DeliveryCredentials | undefined> {
  const rows = await query<{ ozon_client_id: string | null; ozon_api_key_enc: Buffer | null }>('SELECT ozon_client_id, ozon_api_key_enc FROM store_settings WHERE singleton = true')
  const row = rows[0]
  if (!row?.ozon_client_id || !row.ozon_api_key_enc) return undefined
  return { clientId: row.ozon_client_id, secret: decryptSecret(row.ozon_api_key_enc, 'ozon:api_key') }
}
async function loadWarehouseId(): Promise<number | null> {
  const rows = await query<{ ozon_fbs_warehouse_id: string | number | null }>('SELECT ozon_fbs_warehouse_id FROM store_settings WHERE singleton = true')
  const id = rows[0]?.ozon_fbs_warehouse_id
  return id == null ? null : Number(id)
}
async function requiredAttributeIds(client: OzonFbsClient, categoryId: number, typeId: number): Promise<number[]> {
  return (await client.listCategoryAttributes(categoryId, typeId)).filter((a) => a.isRequired).map((a) => a.id)
}

const deps: WorkerDeps = { loadCredentials, loadWarehouseId, baseUrl: () => process.env.NEXT_PUBLIC_BASE_URL, requiredAttributeIds, makeClient: (c) => createOzonFbsClient(c) }

// Поставить в очередь кандидатов фоновой операции (по расписанию).
async function enqueueScheduled(operation: SyncOperation, productIds: number[]): Promise<void> {
  if (!productIds.length) return
  const warehouseId = await loadWarehouseId()
  await enqueueRun({ kind: 'bulk', operation, warehouseId, actorLoginAt: 0, productIds })
}

async function main() {
  // 1) Поставить расписанием: модерация read-only всегда; мутации только при dark-gate.
  await enqueueScheduled('moderation_poll', await selectModerationPollProductIds())
  if (catalogSyncEnabled()) {
    await enqueueScheduled('stock_update', await selectStockUpdateProductIds())
    await enqueueScheduled('zero_stock', await selectZeroStockProductIds())
  } else {
    console.log(JSON.stringify({ note: 'OZON_CATALOG_SYNC_ENABLED не включён — ставится только moderation_poll' }))
  }

  // 2) Слить очередь под глобальным worker-локом (одна активная задача
  // одновременно): исполнить ВСЕ свободные queued/running run-ы (включая
  // admin-созданные content_import — оператор их инициировал кнопкой, worker исполняет).
  const { busy, runs } = await processQueuedRuns(deps)
  if (busy) { console.log(JSON.stringify({ note: 'другой worker уже выполняет очередь — выход' })); return }
  let failed = 0
  for (const run of runs) {
    console.log(JSON.stringify({ runId: run.id, operation: run.operation, status: run.status, succeeded: run.succeededItems, failed: run.failedItems, summary: run.summary }))
    failed += run.failedItems
  }
  if (failed > 0) {
    const r = await sendOpsAlert(`МАВИТА · worker FBS-каталога Ozon: ${failed} позиций завершились ошибкой`)
    if (!r.delivered) console.error(`Алерт НЕ доставлен (${r.reason}). Эскалируйте через systemd OnFailure.`)
    process.exitCode = 1
  }
}

main().catch((error) => { console.error(JSON.stringify({ fatal: error instanceof Error ? error.message : 'unknown' })); process.exitCode = 1 })
