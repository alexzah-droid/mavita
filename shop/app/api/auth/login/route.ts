import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { assertAuthConfig, assertSameOrigin, sessionOptions, verifyPassword, type AdminSession } from '@/lib/auth'

const WINDOW_MS = 60_000; const MAX_FAILURES = 5; const LIMIT = 10_000
const attempts = new Map<string, { count: number; started: number }>()
function ip(request: Request) { return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local' }
function prune(now: number) { for (const [key, item] of attempts) if (now - item.started >= WINDOW_MS) attempts.delete(key); while (attempts.size > LIMIT) attempts.delete(attempts.keys().next().value!) }
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const now = Date.now(); prune(now); const key = ip(request); const current = attempts.get(key)
  if (current && current.count >= MAX_FAILURES) return NextResponse.json({ error: { code: 'RATE_LIMITED', messages: ['Попробуйте позже'] } }, { status: 429, headers: { 'Retry-After': String(Math.ceil((WINDOW_MS - (now - current.started)) / 1000)) } })
  try {
    assertAuthConfig(); const body = await request.json().catch(() => null)
    if (!body || typeof body.password !== 'string' || !verifyPassword(body.password, process.env.ADMIN_PASSWORD!)) {
      const next = !current || now - current.started >= WINDOW_MS ? { count: 1, started: now } : { ...current, count: current.count + 1 }; attempts.set(key, next)
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', messages: ['Неверный пароль'] } }, { status: 401 })
    }
    attempts.delete(key); const session = await getIronSession<AdminSession>(await cookies(), sessionOptions); session.destroy(); session.isAdmin = true; session.loginAt = now; await session.save()
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: { code: 'UNAUTHORIZED', messages: ['Не удалось выполнить вход'] } }, { status: 401 }) }
}
