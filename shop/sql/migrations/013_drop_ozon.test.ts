import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 013 contract', () => {
  it('убирает все объекты Ozon и ужесточает delivery-constraint до СДЭК идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/013_drop_ozon.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    // Таблицы Ozon — через IF EXISTS / CASCADE.
    for (const t of ['ozon_catalog_product_sync_run_items', 'ozon_catalog_product_sync_runs', 'ozon_product_profiles', 'ozon_catalog_sync', 'ozon_pickup_points']) {
      expect(sql).toMatch(new RegExp(`DROP TABLE IF EXISTS ${t} CASCADE`))
    }
    // Триггеры/функции инвалидции профиля сняты до удаления таблиц.
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_product ON products')
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_image ON product_images')
    expect(sql).toContain('DROP FUNCTION IF EXISTS ozon_profile_invalidate(INTEGER)')
    expect(sql).toContain('DROP FUNCTION IF EXISTS ozon_product_profiles_set_updated_at()')
    // store_settings: колонки Ozon и табличный CHECK сняты.
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS store_settings_ozon_complete_check')
    for (const c of ['ozon_pickup_enabled', 'ozon_client_id', 'ozon_api_key_enc', 'ozon_fbs_warehouse_id']) {
      expect(sql).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${c}`))
    }
    // orders: способ доставки ограничен cdek_pickup, без ветки ozon_pickup в новом CHECK.
    expect(sql).toContain("delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek'")
    expect(sql).not.toMatch(/delivery_method = 'ozon_pickup'/)
  })
})
