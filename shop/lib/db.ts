import { Pool, type QueryResultRow } from 'pg'

// Пул соединений PostgreSQL (singleton). Создаётся лениво, чтобы импорт модуля
// не падал, когда DATABASE_URL не задан (локальная разработка / CI-сборка без БД).
// В таких случаях data-слой (lib/products.ts) деградирует на seed-данные.

let pool: Pool | null = null

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set')
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return pool
}

/** Выполнить запрос и вернуть строки. Параметры — только через placeholders ($1, $2…). */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as never[])
  return result.rows
}
