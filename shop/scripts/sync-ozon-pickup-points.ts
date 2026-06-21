// Синхронизация локального каталога ПВЗ Ozon (ozon_pickup_points). Запускать раз в
// день. Берёт id из point/list, помечает все id текущим проходом, обогащает батчами
// point/info (≤100). НЕ деструктивна: completeOzonSync скрывает (active=false), а не
// удаляет, отсутствующие ≥2 проходов точки, и блокирует финализацию при существенном
// расхождении (overlap). Взаимное исключение и состояние — через ozon_catalog_sync.
// Ключ читает из зашифрованных настроек БД (secret-box-core, не server-only — для tsx).
//   SETTINGS_ENC_KEY=... DATABASE_URL=... npx tsx scripts/sync-ozon-pickup-points.ts [maxBatches]
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { decryptSecret } from '@/lib/secret-box-core'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { fetchAllPointIds, fetchPointBatch } from '@/lib/ozon'
import { beginOzonSync, completeOzonSync, failOzonSync, OzonSyncOwnershipLost, recordOzonBatch } from '@/lib/ozon-catalog'
import { sendOpsAlert } from '@/lib/ops-alert'

const BATCH = 100

async function ozonCredentials() {
  const rows = await query<{ ozon_client_id: string | null; ozon_api_key_enc: Buffer | null }>('SELECT ozon_client_id, ozon_api_key_enc FROM store_settings WHERE singleton = true')
  const row = rows[0]
  if (!row?.ozon_client_id || !row.ozon_api_key_enc) throw new Error('Ключи Ozon не заданы в настройках — введите их в админке/через backfill')
  return { clientId: row.ozon_client_id, secret: decryptSecret(row.ozon_api_key_enc, 'ozon:api_key') }
}

// Алерт оператору. Проверяем ФАКТ доставки: при недоставке (нет Telegram, неверный
// chat id/токен, 429/5xx, сеть) явно логируем — оператор видит, что канал не сработал,
// и должен полагаться на systemd OnFailure / независимый канал. Процесс в любом случае
// выходит с ненулевым кодом на путях, где зовётся alert.
async function alert(text: string) {
  console.error(`⚠️ ${text}`)
  const r = await sendOpsAlert(`МАВИТА · синхронизация ПВЗ Ozon: ${text}`)
  if (!r.delivered) console.error(`Telegram-алерт НЕ доставлен (${r.reason}). Эскалируйте через systemd OnFailure / независимый канал.`)
}

// Ретрай для сетевых/временных сбоев (unavailable). authFailed не ретраим — терминально.
async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) {
      lastError = e
      if (e instanceof DeliveryProviderError && e.authFailed) throw e
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i)) // backoff 1s,2s
    }
  }
  throw lastError
}

async function main() {
  const maxBatches = process.argv[2] ? Number(process.argv[2]) : Infinity
  const creds = await ozonCredentials()
  const runId = randomUUID()

  console.log('Загружаю список точек (point/list)…')
  const ids = await retry(() => fetchAllPointIds(creds))
  console.log(`Получено уникальных id: ${ids.length}`)
  if (!ids.length) throw new Error('point/list вернул пустой список — каталог не трогаю')

  // Взаимное исключение: помечаем running, если другой запуск не активен/не завис.
  if (!(await beginOzonSync(runId, ids.length))) { console.log('Синхронизация уже выполняется (или зависла <2ч назад) — выхожу.'); return }

  try {
    let processed = 0    // распознано normalize (для статистики)
    let received = 0     // вернул Ozon (до normalize) — для логов
    const totalBatches = Math.min(Math.ceil(ids.length / BATCH), maxBatches)
    for (let b = 0; b < totalBatches; b++) {
      const chunk = ids.slice(b * BATCH, b * BATCH + BATCH)
      const batch = await retry(() => fetchPointBatch(creds, chunk))
      received += batch.received
      // Помечаем ВСЕ id чанка виденными (даже нераспознанные) + upsert распознанных.
      processed += await recordOzonBatch(runId, chunk, batch.points) // бросит OwnershipLost, если перехвачен
      if ((b + 1) % 25 === 0 || b + 1 === totalBatches) console.log(`· батч ${b + 1}/${totalBatches} · получено ${received} · распознано ${processed}`)
    }
    const full = maxBatches >= Math.ceil(ids.length / BATCH)
    if (!full) { await failOzonSync(runId, 'частичный прогон (maxBatches)'); console.log(`Частичный прогон: распознано ${processed}, каталог НЕ финализирован.`); return }
    // completeOzonSync: владение + overlap (знаменатель в той же транзакции) + grace-скрытие.
    const res = await completeOzonSync(runId)
    if (!res.ok) {
      if (res.reason === 'ownership_lost') { console.error('Прерван: синхронизацию перехватил другой запуск — без финализации.'); process.exitCode = 1; return }
      await failOzonSync(runId, `low_overlap: ${res.detail}`)
      await alert(`существенное расхождение (${res.detail}). Активная выдача не изменена (новые точки скрыты). Проверьте Ozon point/list.`)
      process.exitCode = 1; return
    }
    console.log(`Готово. Получено ${received}/${ids.length}, распознано ${processed}, скрыто (после ${2} пропусков) ${res.deactivated}. Активных в каталоге: ${res.catalogCount}.`)
  } catch (error) {
    // Перехват — благоприятный исход, не алертим. Остальное помечаем failed для этого
    // run и пробрасываем — алерт шлёт ЕДИНЫЙ обработчик ниже (он же ловит ранние сбои:
    // получение ключей, первый point/list, beginOzonSync — они ВНЕ этого try).
    if (error instanceof OzonSyncOwnershipLost) { console.error('Прерван: синхронизацию перехватил другой запуск — выхожу без записи.'); process.exitCode = 1; return }
    await failOzonSync(runId, error instanceof Error ? error.message : String(error))
    throw error
  }
}

// Единая точка алерта: любая брошенная ошибка (включая ранние — до try в main) шлёт
// уведомление. Benign-исходы (уже идёт / частичный прогон / перехват / low_overlap)
// до сюда не доходят (return) — low_overlap алертит сам.
main().catch(async (error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error('Sync failed:', msg)
  await alert(`синхронизация упала: ${msg}`)
  process.exitCode = 1
})
