import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 011 contract', () => {
  it('создаёт очередь синхронизации каталога с lease/fencing идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/011_ozon_catalog_product_sync_runs.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ozon_catalog_product_sync_runs')
    expect(sql).toMatch(/kind IN \('single','bulk'\)/)
    expect(sql).toMatch(/operation IN \('content_import','stock_update','zero_stock','moderation_poll'\)/)
    expect(sql).toMatch(/status IN \('queued','running','completed','failed'\)/)
    // Fencing-поля.
    expect(sql).toContain('lease_token        UUID')
    expect(sql).toContain('lease_expires_at   TIMESTAMPTZ')
    // Позиции run с уникальностью (run_id, product_id) и снимками для re-check.
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ozon_catalog_product_sync_run_items')
    expect(sql).toContain('product_updated_at  TIMESTAMPTZ')
    expect(sql).toContain('profile_updated_at  TIMESTAMPTZ')
    expect(sql).toContain('desired_stock       INTEGER')
    expect(sql).toMatch(/status IN \('queued','running','completed','failed','skipped'\)/)
    expect(sql).toContain('CONSTRAINT uq_ozon_sync_run_item UNIQUE (run_id, product_id)')
  })
})
