import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/db', () => ({ withTransaction: mocks.transaction }))
beforeEach(() => { mocks.auth.mockReset(); mocks.csrf.mockReset(); mocks.transaction.mockReset(); mocks.auth.mockResolvedValue({ isAdmin: true, loginAt: 1 }); mocks.csrf.mockReturnValue(null) })
function request(body: unknown) { return new Request('http://localhost/api/admin/products/42/images', { method: 'PATCH', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
describe('PATCH /api/admin/products/[id]/images', () => {
  it('clears the old cover before assigning a new earlier image', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }).mockResolvedValue({ rows: [] }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { PATCH } = await import('@/app/api/admin/products/[id]/images/route')
    const response = await PATCH(request({ orderedImageIds: [2, 1], coverImageId: 2 }), { params: Promise.resolve({ id: '42' }) })
    expect(response.status).toBe(200)
    expect(client.query.mock.calls[1]).toEqual(['UPDATE product_images SET is_cover = false WHERE product_id = $1 AND is_cover = true', [42]])
    expect(client.query.mock.calls[2]).toEqual(['UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [10, true, 2]])
    expect(client.query.mock.calls[3]).toEqual(['UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [20, false, 1]])
  })
  it('does not update images when their full set does not match', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) }
    mocks.transaction.mockImplementation(async (callback) => callback(client))
    const { PATCH } = await import('@/app/api/admin/products/[id]/images/route')
    expect((await PATCH(request({ orderedImageIds: [1], coverImageId: 1 }), { params: Promise.resolve({ id: '42' }) })).status).toBe(409)
    expect(client.query).toHaveBeenCalledTimes(1)
  })
})
