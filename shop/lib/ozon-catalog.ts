// Локальный каталог ПВЗ Ozon (таблица ozon_pickup_points) + состояние синхронизации
// (ozon_catalog_sync). Клиентский поиск ПВЗ по городу идёт ОТСЮДА, а не из живого API
// (point/list отдаёт только id+координаты). Наполняет каталог
// scripts/sync-ozon-pickup-points.ts. Только публичные данные ПВЗ — секретов нет,
// поэтому без server-only (нужно и CLI-скрипту под tsx).
import { isDbConfigured, query, withTransaction } from '@/lib/db'
import type { PickupPoint } from '@/lib/delivery/types'
import type { OzonPickupDetail } from '@/lib/ozon'

// Каталог считается свежим, если ПОСЛЕДНЯЯ УСПЕШНАЯ синхронизация не старше окна.
// Синхронизация ежедневная; допускаем один пропущенный запуск.
export const CATALOG_FRESH_HOURS = 48
// Порог РЕАЛЬНОГО overlap (доля прежних активных точек, подтверждённых проходом).
// Меньше — список усечён/битый: финализацию блокируем и шлём алерт.
export const MIN_OVERLAP_RATIO = 0.98
// Точку СКРЫВАЕМ (active=false), а НЕ удаляем, и только после стольких подряд
// проходов её отсутствия (grace). Скрытие обратимо: вернулась в список → снова active.
export const DEACTIVATE_AFTER_MISSED_RUNS = 2

/** Текущий run потерял владение singleton (его перехватил другой запуск). */
export class OzonSyncOwnershipLost extends Error { constructor() { super('Синхронизация потеряла владение (перехвачена другим запуском)'); this.name = 'OzonSyncOwnershipLost' } }

/** Результат финализации (бизнес-исходы НЕ бросаем внутри транзакции — иначе
 *  откат потерял бы запись статуса). low_overlap → существенное расхождение, алерт. */
export type CompleteResult = { ok: true; deactivated: number; catalogCount: number } | { ok: false; reason: 'ownership_lost' | 'low_overlap'; detail?: string }

type Row = { map_point_id: number | string; city: string; name: string; address: string }
function dto(row: Row): PickupPoint { return { code: String(row.map_point_id), city: row.city, name: row.name, address: row.address } }

/** Поиск ПВЗ по городу. Префикс lower(city) LIKE 'q%' — использует индекс
 *  idx_ozon_pickup_points_city (без ведущего %, без full scan). */
export async function searchOzonPickupPoints(city: string | undefined, limit = 50): Promise<PickupPoint[]> {
  if (!isDbConfigured() || !city?.trim()) return []
  const rows = await query<Row>(
    `SELECT map_point_id, city, name, address FROM ozon_pickup_points
     WHERE active AND lower(city) LIKE lower($1) || '%'
     ORDER BY city, name LIMIT $2`,
    [city.trim(), limit],
  )
  return rows.map(dto)
}

export async function countOzonPickupPoints(): Promise<number> {
  if (!isDbConfigured()) return 0
  const rows = await query<{ count: string }>('SELECT count(*)::text AS count FROM ozon_pickup_points')
  return Number(rows[0]?.count ?? 0)
}

// ── Состояние синхронизации ──────────────────────────────────────────────────
export type OzonSyncState = { status: 'idle' | 'running' | 'success' | 'failed'; lastSuccessAt: string | null; lastSuccessCount: number; processedIds: number; expectedIds: number | null; lastError: string | null }
type SyncRow = { status: OzonSyncState['status']; last_success_at: Date | string | null; last_success_count: number | string; processed_ids: number | string; expected_ids: number | string | null; last_error: string | null }
function syncDto(row: SyncRow | undefined): OzonSyncState {
  if (!row) return { status: 'idle', lastSuccessAt: null, lastSuccessCount: 0, processedIds: 0, expectedIds: null, lastError: null }
  return { status: row.status, lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null, lastSuccessCount: Number(row.last_success_count), processedIds: Number(row.processed_ids), expectedIds: row.expected_ids == null ? null : Number(row.expected_ids), lastError: row.last_error }
}

export async function getOzonSyncState(): Promise<OzonSyncState> {
  if (!isDbConfigured()) return syncDto(undefined)
  const rows = await query<SyncRow>('SELECT status, last_success_at, last_success_count, processed_ids, expected_ids, last_error FROM ozon_catalog_sync WHERE singleton = true')
  return syncDto(rows[0])
}

/**
 * Свежесть по ПОСЛЕДНЕМУ УСПЕШНОМУ проходу (last_success_at), а не по текущему
 * статусу: идущая или упавшая синхронизация не обесценивает ещё свежий каталог.
 */
export async function isOzonCatalogFresh(): Promise<boolean> {
  if (!isDbConfigured()) return false
  const rows = await query<{ fresh: boolean }>(
    `SELECT (last_success_count > 0 AND last_success_at > now() - ($1 || ' hours')::interval) AS fresh
     FROM ozon_catalog_sync WHERE singleton = true`,
    [String(CATALOG_FRESH_HOURS)],
  )
  return Boolean(rows[0]?.fresh)
}

/**
 * Захватить запуск синхронизации (взаимное исключение). Помечает running, но только
 * если другой запуск не активен (или завис >2 ч). Возвращает false, если уже идёт.
 */
export async function beginOzonSync(runId: string, expectedIds: number): Promise<boolean> {
  if (!isDbConfigured()) return false
  const rows = await query<{ run_id: string }>(
    `INSERT INTO ozon_catalog_sync (singleton, run_id, status, started_at, completed_at, expected_ids, processed_ids, last_error)
     VALUES (true, $1, 'running', now(), NULL, $2, 0, NULL)
     ON CONFLICT (singleton) DO UPDATE SET run_id = $1, status = 'running', started_at = now(), completed_at = NULL, expected_ids = $2, processed_ids = 0, last_error = NULL
       WHERE ozon_catalog_sync.status <> 'running' OR ozon_catalog_sync.started_at < now() - interval '2 hours'
     RETURNING run_id`,
    [runId, expectedIds],
  )
  return rows.length > 0
}

/** Под блокировкой singleton: владеет ли текущий run синхронизацией. */
async function isOwner(client: { query: <T>(t: string, p?: unknown[]) => Promise<{ rows: T[] }> }, runId: string): Promise<boolean> {
  const row = (await client.query<{ run_id: string | null; status: string }>('SELECT run_id, status FROM ozon_catalog_sync WHERE singleton = true FOR UPDATE')).rows[0]
  return Boolean(row && row.run_id === runId && row.status === 'running')
}

/**
 * Записать пачку прохода. Fencing: блокируем singleton и проверяем владение ДО
 * записи. ВАЖНО для целостности: меткой прохода (last_seen_run_id) помечаем ВСЕ
 * запрошенные id из point/list (`requestedIds`), даже те, что не распознались
 * normalize — иначе при изменении формы ответа Ozon очистка удалила бы рабочие
 * точки. Детали (city/name/address) обновляем/вставляем только для распознанных.
 * Возвращает число распознанных (для статистики).
 */
export async function recordOzonBatch(runId: string, requestedIds: number[], points: OzonPickupDetail[]): Promise<number> {
  if (!isDbConfigured() || !requestedIds.length) return 0
  return withTransaction(async (client) => {
    if (!(await isOwner(client, runId))) throw new OzonSyncOwnershipLost()
    // 1) пометить «виден в этом проходе» все существующие строки запрошенных id.
    await client.query('UPDATE ozon_pickup_points SET last_seen_run_id = $1 WHERE map_point_id = ANY($2::bigint[])', [runId, requestedIds])
    // 2) upsert распознанных (details + метка). НОВЫЕ строки вставляем НЕАКТИВНЫМИ
    //    (active=false): пока проход не финализирован успешно, точки из неполного/
    //    битого/частичного списка НЕ должны быть видны клиентам. Активирует их только
    //    completeOzonSync после overlap-гейта. У существующих строк active НЕ трогаем
    //    (DO UPDATE его не перечисляет) — уже видимая точка остаётся видимой.
    let processed = 0
    if (points.length) {
      const values: string[] = []
      const params: unknown[] = [runId]
      for (const p of points) {
        const i = params.length
        values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $1, false, now())`)
        params.push(Number(p.code), p.city, p.name, p.address, p.lat, p.lng)
      }
      const res = await client.query<{ map_point_id: number }>(
        `INSERT INTO ozon_pickup_points (map_point_id, city, name, address, lat, lng, last_seen_run_id, active, updated_at)
         VALUES ${values.join(', ')}
         ON CONFLICT (map_point_id) DO UPDATE SET
           city = EXCLUDED.city, name = EXCLUDED.name, address = EXCLUDED.address,
           lat = EXCLUDED.lat, lng = EXCLUDED.lng, last_seen_run_id = EXCLUDED.last_seen_run_id, updated_at = now()
         RETURNING map_point_id`,
        params,
      )
      processed = res.rows.length
    }
    await client.query('UPDATE ozon_catalog_sync SET processed_ids = processed_ids + $2 WHERE run_id = $1', [runId, processed])
    return processed
  })
}

/**
 * Финализация (НЕ деструктивная). Под блокировкой singleton (fencing):
 *  1) считает overlap по ФАКТУ среди АКТИВНЫХ точек — сколько прежних активных
 *     не подтверждено этим проходом (id отсутствовал в point/list); знаменатель и
 *     числитель берутся в ОДНОЙ транзакции после проверки владельца;
 *  2) если не подтверждено > (1−MIN_OVERLAP_RATIO) — low_overlap: активную выдачу и
 *     поколение НЕ трогаем (новые точки из recordOzonBatch остаются active=false,
 *     существующие активные не скрываем); усечённый/битый список, снаружи шлём алерт;
 *  3) иначе grace: подтверждённым reset+active, отсутствующим активным +1 к счётчику,
 *     и СКРЫВАЕМ (active=false), кто отсутствовал DEACTIVATE_AFTER_MISSED_RUNS подряд.
 *     Точки не удаляются — скрытие обратимо. Двигаем поколение last_success (счёт активных).
 * Бизнес-исходы возвращаем результатом, а не throw (иначе откат потерял бы статус).
 */
export async function completeOzonSync(runId: string): Promise<CompleteResult> {
  if (!isDbConfigured()) return { ok: false, reason: 'low_overlap', detail: 'no db' }
  return withTransaction(async (client) => {
    if (!(await isOwner(client, runId))) return { ok: false, reason: 'ownership_lost' }
    // Знаменатель (активные) и отсутствующие — одним запросом, в этой же транзакции.
    const counts = (await client.query<{ base: string; absent: string }>(
      `SELECT count(*) FILTER (WHERE active)::text AS base,
              count(*) FILTER (WHERE active AND last_seen_run_id IS DISTINCT FROM $1)::text AS absent
       FROM ozon_pickup_points`, [runId])).rows[0]
    const base = Number(counts?.base ?? 0); const absent = Number(counts?.absent ?? 0)
    if (base > 0 && absent > base * (1 - MIN_OVERLAP_RATIO)) {
      return { ok: false, reason: 'low_overlap', detail: `не подтверждено ${absent} из ${base} активных (> ${Math.round((1 - MIN_OVERLAP_RATIO) * 100)}%)` }
    }
    await client.query('UPDATE ozon_pickup_points SET missed_runs = 0, active = true WHERE last_seen_run_id = $1', [runId])
    await client.query('UPDATE ozon_pickup_points SET missed_runs = missed_runs + 1 WHERE active AND last_seen_run_id IS DISTINCT FROM $1', [runId])
    const deactivated = await client.query('UPDATE ozon_pickup_points SET active = false WHERE active AND missed_runs >= $1', [DEACTIVATE_AFTER_MISSED_RUNS])
    const catalogCount = Number((await client.query<{ count: string }>('SELECT count(*) FILTER (WHERE active)::text AS count FROM ozon_pickup_points')).rows[0]?.count ?? 0)
    await client.query(`UPDATE ozon_catalog_sync SET status = 'success', completed_at = now(), last_success_at = now(), last_success_count = $2 WHERE run_id = $1`, [runId, catalogCount])
    return { ok: true, deactivated: deactivated.rowCount ?? 0, catalogCount }
  })
}

/** Пометить провал. last_success_* НЕ трогаем — прошлый свежий каталог остаётся в силе. */
export async function failOzonSync(runId: string, error: string): Promise<void> {
  if (!isDbConfigured()) return
  await query(`UPDATE ozon_catalog_sync SET status = 'failed', last_error = $2 WHERE run_id = $1`, [runId, error.slice(0, 500)])
}
