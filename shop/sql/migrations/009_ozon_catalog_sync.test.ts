import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 009 contract', () => {
  it('создаёт состояние синхронизации и метку прохода идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/009_ozon_catalog_sync.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ozon_catalog_sync')
    expect(sql).toMatch(/status IN \('idle','running','success','failed'\)/)
    // Свежесть по последнему успешному проходу — отдельные поля от текущего run.
    expect(sql).toContain('last_success_at')
    expect(sql).toContain('last_success_count')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_seen_run_id UUID')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS missed_runs INTEGER NOT NULL DEFAULT 0')
    // soft-disable: флаг активности + частичный индекс по активным
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true')
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_ozon_pickup_points_city ON ozon_pickup_points \(lower\(city\)\) WHERE active/)
  })
})
