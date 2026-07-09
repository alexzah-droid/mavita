import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 024 contract', () => {
  it('adds editable element-tile content without overwriting existing rows', async () => {
    const sql = await readFile(path.join(process.cwd(), 'sql/migrations/024_site_content_stihii.sql'), 'utf8')
    expect(sql).toMatch(/ALTER TABLE site_content/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stihii JSONB NOT NULL DEFAULT/)
    expect(sql).toContain('"gory"')
    expect(sql).toContain('"more"')
    expect(sql).toContain('"les"')
  })
})
