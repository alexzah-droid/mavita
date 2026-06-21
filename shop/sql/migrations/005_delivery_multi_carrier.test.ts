import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 005 contract', () => {
  it('allows the ozon carrier and adds per-carrier tariffs/flags idempotently', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/005_delivery_multi_carrier.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    // orders: оба перевозчика разрешены, мусорные комбинации — нет
    expect(sql).toContain("delivery_method = 'ozon_pickup' AND delivery_carrier = 'ozon'")
    expect(sql).toContain("delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek'")
    // ПВЗ-snapshot обобщён на любой *_pickup
    expect(sql).toMatch(/delivery_method LIKE '%\\_pickup'/)
    // тариф СДЭК становится nullable; флаги по умолчанию false
    expect(sql).toContain('ALTER COLUMN cdek_pickup_delivery_kopecks DROP NOT NULL')
    expect(sql).toContain('cdek_pickup_enabled BOOLEAN NOT NULL DEFAULT false')
    expect(sql).toContain('ozon_pickup_enabled BOOLEAN NOT NULL DEFAULT false')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS ozon_pickup_delivery_kopecks')
    // идемпотентность по именам constraints
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS orders_delivery_method_check')
    expect(sql).toContain('store_settings_ozon_delivery_nonnegative')
  })
})
