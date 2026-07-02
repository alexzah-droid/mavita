import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 021 contract', () => {
  it('добавляет комментарий покупателя с ограничением длины идемпотентно', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/021_order_customer_comment.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS customer_comment TEXT/)
    expect(sql).toMatch(/orders_customer_comment_length CHECK \(customer_comment IS NULL OR char_length\(customer_comment\) <= 500\)/)
  })
})
