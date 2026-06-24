// Лёгкий лимитер публичных проксей к API СДЭК (автокомплит города, IP-город).
// In-memory, per-process — backstop поверх клиентского дебаунса, чтобы случайный
// цикл/абуз не выжигал квоту СДЭК. Достаточно при текущем трафике; при росте —
// заменить на общую таблицу (паттерн rupost_normalize_attempts), общую для PM2.
import 'server-only'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  // Лёгкая уборка протухших корзин, чтобы Map не рос бесконечно.
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

// Доверенный IP из цепочки Nginx: X-Real-IP, иначе ПОСЛЕДНИЙ (ближайший к серверу)
// элемент X-Forwarded-For. Левые элементы XFF клиент может подделать. См. также
// clientIp в app/api/admin/settings/delivery/test/route.ts.
export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) { const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1] }
  return 'unknown'
}
