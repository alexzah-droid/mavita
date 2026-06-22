import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 012 contract', () => {
  it('сбрасывает подтверждение скрытия при изменении контента товара/фото', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/012_ozon_profile_content_invalidation.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    // Сброс подтверждения и dirty-флагов.
    expect(sql).toContain('manual_hidden_confirmed_at = NULL')
    expect(sql).toContain('hidden_verification_method = NULL')
    expect(sql).toMatch(/content_dirty = true/); expect(sql).toMatch(/stock_dirty = true/)
    // Триггер на импортируемые колонки товара (без visibility).
    expect(sql).toMatch(/AFTER UPDATE OF name, description, price_kopecks, sale_price_kopecks, sale_starts_at, sale_ends_at ON products/)
    expect(sql).not.toMatch(/UPDATE OF[^;]*visibility/)
    // Триггер на любые изменения фото.
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON product_images')
  })
})
