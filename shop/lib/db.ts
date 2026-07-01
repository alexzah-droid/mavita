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
    // pg эмитит 'error' на простаивающих клиентах (рестарт PostgreSQL, обрыв сети).
    // Без слушателя это unhandled 'error' → падение всего процесса Node.
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err)
    })
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
