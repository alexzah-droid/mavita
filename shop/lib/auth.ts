import { createHash, timingSafeEqual } from 'node:crypto'
import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

export type AdminSession = { isAdmin: true; loginAt: number }
export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || 'invalid-session-secret-not-for-use',
  cookieName: 'mavita_admin', ttl: 60 * 60 * 8,
  cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 - 60 },
}

export function assertAuthConfig(): void {
  if (!process.env.ADMIN_PASSWORD?.trim()) throw new Error('ADMIN_PASSWORD must be set')
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
}
export function verifyPassword(input: string, expected: string): boolean {
  const a = createHash('sha256').update(input, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}
export async function getAdminSession(): Promise<AdminSession | null> {
  assertAuthConfig()
  const session = await getIronSession<AdminSession>(await cookies(), sessionOptions)
  return session.isAdmin === true ? { isAdmin: true, loginAt: session.loginAt } : null
}
export async function requireAdminPage(): Promise<AdminSession> {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')
  return session
}
export async function requireAdminApi(): Promise<AdminSession | NextResponse> {
  const session = await getAdminSession()
  return session ?? NextResponse.json({ error: { code: 'UNAUTHORIZED', messages: ['Требуется вход'] } }, { status: 401 })
}
export function assertSameOrigin(request: Request): NextResponse | null {
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return null
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: { code: 'FORBIDDEN', messages: ['Неверный Origin'] } }, { status: 403 })
  return null
}
