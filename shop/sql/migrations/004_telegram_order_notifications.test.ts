import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 004 contract', () => {
  it('creates encrypted Telegram settings and a durable idempotent outbox', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/004_telegram_order_notifications.sql'), 'utf8')
    expect(sql).toMatch(/BEGIN;/); expect(sql).toMatch(/COMMIT;/)
    for (const name of ['telegram_notification_settings', 'bot_token_ciphertext', 'bot_token_iv', 'bot_token_auth_tag', 'order_notification_outbox', 'event_key TEXT NOT NULL UNIQUE', 'idx_order_notification_outbox_ready']) expect(sql).toContain(name)
  })
})
