import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 020 contract', () => {
  it('добавляет публичные характеристики свечи идемпотентно и в транзакции', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/020_product_specs.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS burn_time_hours SMALLINT/)
    expect(sql).toMatch(/products_burn_time_positive CHECK \(burn_time_hours IS NULL OR burn_time_hours > 0\)/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS wax TEXT/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS wick TEXT/)
  })
})
