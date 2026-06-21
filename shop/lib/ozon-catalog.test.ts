import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isDb: vi.fn(() => true), query: vi.fn(), withTx: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: mocks.isDb, query: mocks.query, withTransaction: mocks.withTx }))

beforeEach(() => { mocks.isDb.mockReturnValue(true); mocks.query.mockReset(); mocks.withTx.mockReset() })

describe('ozon-catalog search', () => {
  it('ищет по городу префиксом (использует индекс lower(city)) и маппит в PickupPoint', async () => {
    mocks.query.mockResolvedValue([{ map_point_id: 100, city: 'Москва', name: 'Пункт Ozon', address: 'ул. 1' }])
    const { searchOzonPickupPoints } = await import('@/lib/ozon-catalog')
    const res = await searchOzonPickupPoints('моск')
    expect(res).toEqual([{ code: '100', city: 'Москва', name: 'Пункт Ozon', address: 'ул. 1' }])
    // только активные; префикс без ведущего % → sargable по частичному индексу
    expect(mocks.query.mock.calls[0][0]).toMatch(/WHERE active AND lower\(city\) LIKE lower\(\$1\) \|\| '%'/)
  })
  it('пустой город → [] без запроса', async () => {
    const { searchOzonPickupPoints } = await import('@/lib/ozon-catalog')
    expect(await searchOzonPickupPoints('  ')).toEqual([])
    expect(mocks.query).not.toHaveBeenCalled()
  })
})

// Клиент транзакции: первый вызов — assertOwner SELECT … FOR UPDATE.
function ownerClient(owner: { run_id: string | null; status: string } | null, rest: { rows?: unknown[]; rowCount?: number }[] = []) {
  const q = vi.fn()
  q.mockResolvedValueOnce({ rows: owner ? [owner] : [] }) // assertOwner
  for (const r of rest) q.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? 0 })
  q.mockResolvedValue({ rows: [], rowCount: 0 })
  return { query: q }
}

describe('ozon-catalog recordOzonBatch (fencing + list-keyed marking)', () => {
  it('помечает ВСЕ запрошенные id виденными и upsert-ит распознанные', async () => {
    const client = ownerClient({ run_id: 'run-xyz', status: 'running' }, [{}, { rows: [{ map_point_id: 1 }] }, {}])
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { recordOzonBatch } = await import('@/lib/ozon-catalog')
    const processed = await recordOzonBatch('run-xyz', [1, 2, 3], [{ code: '1', city: 'Москва', name: 'A', address: 'a', lat: 1, lng: 2 }])
    expect(processed).toBe(1)
    expect(client.query.mock.calls[0][0]).toMatch(/FOR UPDATE/)
    // помечаем все запрошенные id (в т.ч. нераспознанные 2,3) как виденные
    expect(client.query.mock.calls[1][0]).toMatch(/SET last_seen_run_id = \$1 WHERE map_point_id = ANY\(\$2::bigint\[\]\)/)
    expect(client.query.mock.calls[1][1]).toEqual(['run-xyz', [1, 2, 3]])
    const insertSql = client.query.mock.calls[2][0]
    expect(insertSql).toContain('ON CONFLICT (map_point_id) DO UPDATE')
    // НОВЫЕ строки вставляются НЕАКТИВНЫМИ (active=false) и не видны до финализации
    expect(insertSql).toMatch(/last_seen_run_id, active, updated_at/)
    expect(insertSql).toMatch(/\$1, false, now\(\)/)
    // active существующих НЕ трогаем в DO UPDATE
    expect(insertSql).not.toMatch(/active = EXCLUDED\.active/)
  })
  it('коллапс normalize (0 распознанных) всё равно помечает все id → каталог не выкосится', async () => {
    const client = ownerClient({ run_id: 'r', status: 'running' }, [{}, {}])
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { recordOzonBatch } = await import('@/lib/ozon-catalog')
    const processed = await recordOzonBatch('r', [1, 2, 3], []) // ничего не распозналось
    expect(processed).toBe(0)
    expect(client.query.mock.calls[1][0]).toMatch(/SET last_seen_run_id/) // но id всё равно помечены
    expect(client.query.mock.calls.some((c) => /INSERT INTO ozon_pickup_points/.test(c[0]))).toBe(false)
  })
  it('перехвачен другим запуском → OzonSyncOwnershipLost, ничего не пишет', async () => {
    const client = ownerClient({ run_id: 'run-B', status: 'running' })
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { recordOzonBatch, OzonSyncOwnershipLost } = await import('@/lib/ozon-catalog')
    await expect(recordOzonBatch('run-A', [1], [{ code: '1', city: 'A', name: 'A', address: 'a', lat: null, lng: null }])).rejects.toBeInstanceOf(OzonSyncOwnershipLost)
    expect(client.query.mock.calls.length).toBe(1) // только assertOwner
  })
})

describe('ozon-catalog complete (overlap guard + soft-disable, in-txn denominator)', () => {
  it('overlap ок → reset+active подтверждённым, +1 отсутствующим, СКРЫТИЕ (не DELETE) при missed>=2', async () => {
    // call0 owner, call1 base/absent (одним запросом), call2 reset, call3 bump, call4 deactivate, call5 count, call6 success
    const client = ownerClient({ run_id: 'r1', status: 'running' }, [{ rows: [{ base: '90000', absent: '100' }] }, {}, {}, { rowCount: 5 }, { rows: [{ count: '89995' }] }, {}])
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { completeOzonSync } = await import('@/lib/ozon-catalog')
    const res = await completeOzonSync('r1')
    expect(res).toEqual({ ok: true, deactivated: 5, catalogCount: 89995 })
    // знаменатель и числитель overlap — в ОДНОМ запросе этой транзакции (под FOR UPDATE)
    expect(client.query.mock.calls[1][0]).toMatch(/count\(\*\) FILTER \(WHERE active\)[\s\S]*FILTER \(WHERE active AND last_seen_run_id IS DISTINCT FROM/)
    expect(client.query.mock.calls[2][0]).toMatch(/missed_runs = 0, active = true WHERE last_seen_run_id = /)
    expect(client.query.mock.calls[3][0]).toMatch(/missed_runs = missed_runs \+ 1 WHERE active AND last_seen_run_id IS DISTINCT FROM/)
    // СКРЫТИЕ, не удаление; grace = 2 пропуска
    expect(client.query.mock.calls[4][0]).toMatch(/SET active = false WHERE active AND missed_runs >= \$1/)
    expect(client.query.mock.calls[4][1]).toEqual([2])
    expect(client.query.mock.calls.some((c) => /DELETE FROM/.test(c[0]))).toBe(false) // ничего не удаляем
  })
  it('низкий overlap (отсутствует >2% активных) → low_overlap, БЕЗ изменений каталога', async () => {
    const client = ownerClient({ run_id: 'r1', status: 'running' }, [{ rows: [{ base: '90000', absent: '9000' }] }]) // 10%
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { completeOzonSync } = await import('@/lib/ozon-catalog')
    const res = await completeOzonSync('r1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('low_overlap')
    // никакой активации/изменений: новые строки, вставленные recordOzonBatch как
    // active=false, остаются невидимыми для клиентов
    expect(client.query.mock.calls.some((c) => /UPDATE ozon_pickup_points|active = true|DELETE FROM/.test(c[0]))).toBe(false)
    expect(client.query.mock.calls.length).toBe(2) // owner + overlap-подсчёт, ничего больше
  })
  it('перехвачен → ok:false ownership_lost, без изменений', async () => {
    const client = ownerClient({ run_id: 'r2', status: 'running' })
    mocks.withTx.mockImplementation(async (fn: (c: unknown) => unknown) => fn(client))
    const { completeOzonSync } = await import('@/lib/ozon-catalog')
    const res = await completeOzonSync('r1')
    expect(res).toEqual({ ok: false, reason: 'ownership_lost' })
    expect(client.query.mock.calls.length).toBe(1)
  })
})

describe('ozon-catalog sync state', () => {
  it('beginOzonSync: захват true, занятость false', async () => {
    const { beginOzonSync } = await import('@/lib/ozon-catalog')
    mocks.query.mockResolvedValueOnce([{ run_id: 'r1' }])
    expect(await beginOzonSync('r1', 100)).toBe(true)
    mocks.query.mockResolvedValueOnce([])
    expect(await beginOzonSync('r2', 100)).toBe(false)
  })
  it('isOzonCatalogFresh считается по last_success_at', async () => {
    const { isOzonCatalogFresh } = await import('@/lib/ozon-catalog')
    mocks.query.mockResolvedValueOnce([{ fresh: true }])
    expect(await isOzonCatalogFresh()).toBe(true)
    expect(mocks.query.mock.calls[0][0]).toMatch(/last_success_at > now\(\)/)
  })
})
