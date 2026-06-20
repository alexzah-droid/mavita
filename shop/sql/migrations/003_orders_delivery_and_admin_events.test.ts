import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
describe('migration 003 contract', () => {
  it('backfills legacy orders and defines delivery/audit constraints idempotently', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/003_orders_delivery_and_admin_events.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/); expect(sql).toContain('ADD COLUMN IF NOT EXISTS')
    expect(sql).toContain('SET items_kopecks = total_kopecks'); expect(sql).toContain("WHEN 'paid' THEN 'new'")
    for (const name of ['orders_total_components_check', 'orders_delivery_method_check', 'orders_pickup_point_snapshot_check', 'orders_fulfillment_status_check', 'orders_payment_fulfillment_check', 'orders_tracking_number_check', 'order_admin_events_shape_check']) expect(sql).toContain(name)
  })
})
