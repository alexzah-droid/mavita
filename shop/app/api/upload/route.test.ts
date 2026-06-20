import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/db', () => ({ withTransaction: mocks.transaction }))
beforeEach(() => { mocks.auth.mockReset(); mocks.csrf.mockReset(); mocks.transaction.mockReset(); mocks.auth.mockResolvedValue({ isAdmin: true, loginAt: 1 }); mocks.csrf.mockReturnValue(null) })
describe('POST /api/upload guard', () => {
  it('does not parse or write an anonymous upload', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 })); const { POST } = await import('@/app/api/upload/route')
    const response = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: 'not-a-form' }))
    expect(response.status).toBe(401); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('rejects cross-origin upload before filesystem and DB work', async () => {
    mocks.csrf.mockReturnValue(NextResponse.json({}, { status: 403 })); const { POST } = await import('@/app/api/upload/route')
    const response = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: 'not-a-form' }))
    expect(response.status).toBe(403); expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
