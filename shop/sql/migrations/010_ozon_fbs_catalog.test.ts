import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 010 contract', () => {
  it('создаёт профиль FBS-каталога и поля склада идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/010_ozon_fbs_catalog.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ozon_product_profiles')
    expect(sql).toMatch(/product_id\s+INTEGER PRIMARY KEY REFERENCES products\(id\) ON DELETE CASCADE/)
    expect(sql).toContain('offer_id                TEXT NOT NULL UNIQUE')
    expect(sql).toMatch(/fbs_stock_quantity\s+INTEGER NOT NULL DEFAULT 0/)
    expect(sql).toMatch(/CHECK \(fbs_stock_quantity >= 0\)/)
    // Допустимые состояния карточки.
    expect(sql).toMatch(/remote_state IN \('not_synced','pending','awaiting_moderation','awaiting_manual_hide','hidden_confirmed','invalid','failed','disabled'\)/)
    expect(sql).toMatch(/compliance_status IN \('not_checked','ready','blocked'\)/)
    expect(sql).toMatch(/hidden_verification_method IN \('api','operator'\)/)
    // Категория — пара leaf-типа: оба NULL или оба заданы.
    expect(sql).toMatch(/\(description_category_id IS NULL\) = \(type_id IS NULL\)/)
    // updated_at trigger.
    expect(sql).toContain('CREATE TRIGGER trg_ozon_product_profiles_set_updated_at')
    // Индексы и частичный уникальный по barcode.
    expect(sql).toContain('idx_ozon_product_profiles_state')
    expect(sql).toMatch(/uq_ozon_product_profiles_barcode ON ozon_product_profiles \(barcode\) WHERE barcode IS NOT NULL/)
    // Выбор существующего FBS-склада в store_settings.
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS ozon_fbs_warehouse_id BIGINT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS ozon_fbs_warehouse_name TEXT')
  })
})
