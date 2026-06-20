import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/admin-products-db', () => ({ listAdminProducts: mocks.list, createAdminProduct: mocks.create, updateAdminProduct: mocks.update, deleteAdminProduct: mocks.remove, reorderPublicProducts: mocks.reorder }))
const admin = { isAdmin: true as const, loginAt: 1 }
const item = { id: 1, name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null) })
const json = (body: unknown) => new Request('http://localhost/api/admin/products', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('admin products API guards and validation', () => {
  it('returns 401 before parsing a POST body', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 })); const { POST } = await import('@/app/api/admin/products/route')
    const response = await POST(new Request('http://localhost/api/admin/products', { method: 'POST', body: '{broken' }))
    expect(response.status).toBe(401); expect(mocks.csrf).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled()
  })
  it('returns 403 for rejected Origin before touching body or DB', async () => {
    mocks.csrf.mockReturnValue(NextResponse.json({}, { status: 403 })); const { POST } = await import('@/app/api/admin/products/route')
    const response = await POST(json({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }))
    expect(response.status).toBe(403); expect(mocks.create).not.toHaveBeenCalled()
  })
  it('creates a validated hidden-by-default product and maps duplicate slug to 409', async () => {
    const { POST } = await import('@/app/api/admin/products/route'); mocks.create.mockResolvedValue(item)
    expect((await POST(json({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }))).status).toBe(201)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 })
    mocks.create.mockRejectedValue({ code: '23505' }); expect((await POST(json({ name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }))).status).toBe(409)
  })
  it('lists by a valid visibility filter only', async () => {
    const { GET } = await import('@/app/api/admin/products/route'); mocks.list.mockResolvedValue([item])
    expect((await GET(new Request('http://localhost/api/admin/products?visibility=public'))).status).toBe(200); expect(mocks.list).toHaveBeenCalledWith('public')
    expect((await GET(new Request('http://localhost/api/admin/products?visibility=nope'))).status).toBe(400)
  })
})

describe('admin reorder API', () => {
  it('requires exactly one integer list and reports stale public list', async () => {
    const { POST } = await import('@/app/api/admin/products/reorder/route'); const call = (body: unknown) => POST(new Request('http://localhost/api/admin/products/reorder', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    expect((await call({ productIds: [1, '2'] })).status).toBe(400)
    mocks.reorder.mockResolvedValue('conflict'); expect((await call({ productIds: [1, 2] })).status).toBe(409)
    mocks.reorder.mockResolvedValue('ok'); expect((await call({ productIds: [1, 2] })).status).toBe(200)
  })
})
