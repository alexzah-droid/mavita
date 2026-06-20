import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
describe('migration 002 contract', () => {
  it('is transactionally idempotent and contains all named constraints', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/002_admin_visibility_discount.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/); expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4)
    for (const name of ['products_visibility_check', 'products_sale_price_nonnegative', 'products_sale_below_price', 'products_sale_window', 'trg_products_set_updated_at']) expect(sql).toContain(name)
    expect(sql).toContain("visibility IN ('public', 'unlisted', 'hidden')")
  })
})
