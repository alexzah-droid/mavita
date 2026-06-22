import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/admin-products-db', () => ({ getAdminProduct: mocks.get, updateAdminProduct: mocks.update, deleteAdminProduct: mocks.remove }))
const params = { params: Promise.resolve({ id: '42' }) }
const body = (method: string, payload: unknown) => new Request('http://localhost/api/admin/products/42', { method, headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(payload) })
beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); mocks.auth.mockResolvedValue({ isAdmin: true, loginAt: 1 }); mocks.csrf.mockReturnValue(null) })

describe('PATCH /api/admin/products/[id]', () => {
  it('maps the DB CHECK 23514 to a controlled 400 without PostgreSQL details', async () => {
    mocks.update.mockRejectedValue({ code: '23514' })
    const { PATCH } = await import('@/app/api/admin/products/[id]/route')
    const response = await PATCH(body('PATCH', { priceKopecks: 5000 }), params)
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })
  it('maps SALE_PRICE_INVALID to 400', async () => {
    mocks.update.mockRejectedValue(new Error('SALE_PRICE_INVALID'))
    const { PATCH } = await import('@/app/api/admin/products/[id]/route')
    expect((await PATCH(body('PATCH', { priceKopecks: 5000 }), params)).status).toBe(400)
  })
})

describe('DELETE /api/admin/products/[id]', () => {
  it('rejects a missing confirmationName before deleting', async () => {
    const { DELETE } = await import('@/app/api/admin/products/[id]/route')
    expect((await DELETE(body('DELETE', {}), params)).status).toBe(400)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('maps name_mismatch to 400 and not_found to 404', async () => {
    const { DELETE } = await import('@/app/api/admin/products/[id]/route')
    mocks.remove.mockResolvedValue('name_mismatch'); expect((await DELETE(body('DELETE', { confirmationName: 'x' }), params)).status).toBe(400)
    mocks.remove.mockResolvedValue('not_found'); expect((await DELETE(body('DELETE', { confirmationName: 'x' }), params)).status).toBe(404)
  })
  it('passes the exact name and returns ok on deletion', async () => {
    mocks.remove.mockResolvedValue('deleted')
    const { DELETE } = await import('@/app/api/admin/products/[id]/route')
    const response = await DELETE(body('DELETE', { confirmationName: 'Свеча' }), params)
    expect(response.status).toBe(200); expect(mocks.remove).toHaveBeenCalledWith(42, 'Свеча')
  })
})
