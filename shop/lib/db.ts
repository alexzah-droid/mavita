import { Pool, type PoolClient, type QueryResultRow } from 'pg'

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

/**
 * Сессионный advisory-lock на отдельном соединении, удерживаемый на ВСЁ время fn
 * (в т.ч. через несколько транзакций fn на пуле). Если лок занят другим процессом —
 * fn не выполняется, возвращается { acquired:false }. Используется как singleton
 * worker-lease: «одна активная задача одновременно» поверх pool-запросов внутри fn.
 */
export async function tryWithAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const client = await getPool().connect()
  try {
    const got = (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS locked', [key])).rows[0]?.locked
    if (!got) return { acquired: false }
    try {
      return { acquired: true, value: await fn() }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [key])
    }
  } finally {
    client.release()
  }
}

/**
 * Выполнить набор запросов в одной транзакции. При исключении — ROLLBACK,
 * иначе COMMIT. Используется для атомарного создания заказа + позиций.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
