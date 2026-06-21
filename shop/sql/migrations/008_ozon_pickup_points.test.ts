import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 008 contract', () => {
  it('создаёт каталог ПВЗ Ozon с индексом по городу идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/008_ozon_pickup_points.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ozon_pickup_points')
    expect(sql).toContain('map_point_id BIGINT PRIMARY KEY')
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_ozon_pickup_points_city ON ozon_pickup_points \(lower\(city\)\)/)
  })
})
