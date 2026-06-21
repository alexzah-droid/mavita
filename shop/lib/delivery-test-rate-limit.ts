// Общий между инстансами лимит «Проверить связь»: 5 попыток / 10 мин на пару
// (actor loginAt + IP). Хранится в PostgreSQL, не в process-local Map.
import { isDbConfigured, withTransaction } from '@/lib/db'

const LIMIT = 5
const WINDOW = "interval '10 minutes'"

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

/**
 * Зарегистрировать попытку. Возвращает ok=false и Retry-After при превышении.
 *
 * Гонку «SELECT → count → INSERT» закрываем transaction-level advisory-блокировкой
 * по ключу (actor, ip): параллельные транзакции для одной пары сериализуются, иначе
 * шесть одновременных запросов увидели бы <5 строк и все вставились бы.
 */
export async function registerDeliveryTestAttempt(actorLoginAt: number, ip: string): Promise<RateLimitResult> {
  if (!isDbConfigured()) return { ok: true }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`delivery_test:${actorLoginAt}:${ip}`])
    const recent = await client.query<{ created_at: Date | string }>(
      `SELECT created_at FROM delivery_test_attempts
       WHERE actor_login_at = $1 AND ip = $2 AND created_at > now() - ${WINDOW}
       ORDER BY created_at ASC`,
      [actorLoginAt, ip],
    )
    if (recent.rows.length >= LIMIT) {
      const oldest = new Date(recent.rows[0].created_at).getTime()
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 10 * 60_000 - Date.now()) / 1000))
      return { ok: false, retryAfterSeconds }
    }
    await client.query('INSERT INTO delivery_test_attempts (actor_login_at, ip) VALUES ($1, $2)', [actorLoginAt, ip])
    return { ok: true }
  })
}
