import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 023 contract', () => {
  it('creates singleton content storage with a bounded about text', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/023_site_content.sql'), 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS site_content/)
    expect(sql).toMatch(/CHECK \(singleton\)/)
    expect(sql).toMatch(/BETWEEN 1 AND 5000/)
  })
})
