import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

// Утилита интеграционных тестов: создаёт уникальную schema на запуск, применяет в
// неё sql/schema.sql и удаляет её в finally. Так каждый прогон изолирован, а
// транзакционный advisory-lock (общий для всей БД) не создаёт межтестовых гонок —
// при условии последовательного запуска (см. vitest.integration.config.ts).

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL обязателен для npm run test:integration')
  return url
}

export type SchemaHandle = { schema: string; dbUrl: string; drop: () => Promise<void> }

export async function createTestSchema(): Promise<SchemaHandle> {
  const baseUrl = requireTestDatabaseUrl()
  const schema = `it_${randomUUID().replace(/-/g, '')}`
  const admin = new Pool({ connectionString: baseUrl })
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const ddl = await readFile(path.join(process.cwd(), 'sql/schema.sql'), 'utf8')
  const scoped = new Pool({ connectionString: baseUrl, options: `-c search_path=${schema}` })
  try { await scoped.query(ddl) } finally { await scoped.end() }
  const sep = baseUrl.includes('?') ? '&' : '?'
  const dbUrl = `${baseUrl}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`
  return { schema, dbUrl, drop: async () => { try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`) } finally { await admin.end() } } }
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
