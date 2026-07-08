import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 022 contract', () => {
  it('добавляет вес чистого воска и безопасно заполняет известные значения', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/022_product_wax_weight.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS wax_weight TEXT/)
    expect(sql).toMatch(/AND wax_weight IS NULL/)
    expect(sql).toMatch(/COMMIT;/)
  })
})
