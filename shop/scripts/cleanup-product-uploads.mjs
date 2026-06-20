// Запускать ежедневно из cron. Удаляет только UUID-orphan старше часа.
import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
const dir = path.join(process.cwd(), 'public', 'uploads', 'products')
const pattern = /^[0-9a-f]{8}-[0-9a-f-]{27}\.(jpg|png|webp)$/i
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
try {
  const result = await pool.query('SELECT filename FROM product_images')
  const attached = new Set(result.rows.map((row) => path.basename(row.filename)))
  for (const filename of await readdir(dir).catch(() => [])) {
    if (!pattern.test(filename) || attached.has(filename)) continue
    const file = path.join(dir, filename); const info = await stat(file)
    if (Date.now() - info.mtimeMs < 60 * 60 * 1000) continue
    await unlink(file); console.log(`[uploads] removed orphan ${filename}`)
  }
} finally { await pool.end() }
