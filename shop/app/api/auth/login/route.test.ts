import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ save: vi.fn(), destroy: vi.fn(), session: {} as Record<string, unknown> }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }))
vi.mock('iron-session', () => ({ getIronSession: vi.fn(async () => state.session) }))

beforeEach(() => { process.env.ADMIN_PASSWORD = 'correct'; process.env.SESSION_SECRET = 's'.repeat(32); state.save.mockReset(); state.destroy.mockReset(); state.session = { save: state.save, destroy: state.destroy } })
function request(password: string, ip = 'test-ip') { return new Request('http://localhost/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ password }) }) }
describe('POST /api/auth/login', () => {
  it('creates a minimal encrypted session after valid password', async () => {
    const { POST } = await import('@/app/api/auth/login/route'); const response = await POST(request('correct'))
    expect(response.status).toBe(200); expect(state.destroy).toHaveBeenCalledOnce(); expect(state.save).toHaveBeenCalledOnce(); expect(state.session).toMatchObject({ isAdmin: true })
  })
  it('rejects wrong password and rate-limits the sixth failure', async () => {
    const { POST } = await import('@/app/api/auth/login/route'); const ip = `limit-${Date.now()}`
    for (let i = 0; i < 5; i++) expect((await POST(request('wrong', ip))).status).toBe(401)
    const response = await POST(request('wrong', ip)); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBeTruthy()
  })
  it('requires same origin before parsing credentials', async () => {
    const { POST } = await import('@/app/api/auth/login/route'); const response = await POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{bad json' }))
    expect(response.status).toBe(403)
  })
  it('logout is idempotent and clears a session cookie', async () => {
    const { POST } = await import('@/app/api/auth/logout/route'); const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST', headers: { origin: 'http://localhost' } }))
    expect(response.status).toBe(200); expect(state.destroy).toHaveBeenCalledOnce()
  })
})
