import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 006 contract', () => {
  it('adds encrypted carrier secrets with NOT VALID completeness checks', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/006_delivery_carrier_secrets.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cdek_client_id\s+TEXT/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cdek_client_secret_enc\s+BYTEA/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ozon_client_id\s+TEXT/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ozon_api_key_enc\s+BYTEA/)
    // completeness-CHECK добавляется NOT VALID и проверяет имя (идемпотентность)
    expect(sql).toContain('store_settings_cdek_complete_check')
    expect(sql).toContain('store_settings_ozon_complete_check')
    expect(sql).toMatch(/NOT VALID/)
    expect(sql).toContain("cdek_pickup_enabled = false")
    expect(sql).toContain("ozon_pickup_enabled = false")
  })
})
