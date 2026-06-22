import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), reorder: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/admin-products-db', () => ({ reorderProductImages: mocks.reorder }))
beforeEach(() => { mocks.auth.mockReset(); mocks.csrf.mockReset(); mocks.reorder.mockReset(); mocks.auth.mockResolvedValue({ isAdmin: true, loginAt: 1 }); mocks.csrf.mockReturnValue(null) })
function request(body: unknown) { return new Request('http://localhost/api/admin/products/42/images', { method: 'PATCH', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
describe('PATCH /api/admin/products/[id]/images', () => {
  it('returns the updated image list on success', async () => {
    const images = [{ id: 2, filename: 'b', sortOrder: 10, isCover: true }, { id: 1, filename: 'a', sortOrder: 20, isCover: false }]
    mocks.reorder.mockResolvedValue({ images })
    const { PATCH } = await import('@/app/api/admin/products/[id]/images/route')
    const response = await PATCH(request({ orderedImageIds: [2, 1], coverImageId: 2 }), { params: Promise.resolve({ id: '42' }) })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ images })
    expect(mocks.reorder).toHaveBeenCalledWith(42, [2, 1], 2)
  })
  it('maps a stale set to 409', async () => {
    mocks.reorder.mockResolvedValue('conflict')
    const { PATCH } = await import('@/app/api/admin/products/[id]/images/route')
    expect((await PATCH(request({ orderedImageIds: [1], coverImageId: 1 }), { params: Promise.resolve({ id: '42' }) })).status).toBe(409)
  })
  it('rejects a malformed body before touching the DB', async () => {
    const { PATCH } = await import('@/app/api/admin/products/[id]/images/route')
    expect((await PATCH(request({ orderedImageIds: 'nope', coverImageId: 1 }), { params: Promise.resolve({ id: '42' }) })).status).toBe(400)
    expect(mocks.reorder).not.toHaveBeenCalled()
  })
})
