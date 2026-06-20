import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), list: vi.fn(), detail: vi.fn(), cancel: vi.fn(), transition: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdminApi: mocks.auth, assertSameOrigin: mocks.csrf }))
vi.mock('@/lib/admin-orders-db', () => ({ listAdminOrders: mocks.list, getAdminOrderById: mocks.detail, cancelAdminOrder: mocks.cancel, transitionFulfillment: mocks.transition }))
const admin = { isAdmin: true as const, loginAt: 7 }
const order = { id: 9, status: 'pending', fulfillmentStatus: 'awaiting_payment' }
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.auth.mockResolvedValue(admin); mocks.csrf.mockReturnValue(null) })

describe('admin orders API', () => {
  it('rejects an unauthenticated list before reading filters or DB', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }))
    const { GET } = await import('@/app/api/admin/orders/route')
    expect((await GET(new Request('http://localhost/api/admin/orders?cursor=broken'))).status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('validates filters and returns a paginated list with no-store', async () => {
    const { GET } = await import('@/app/api/admin/orders/route')
    expect((await GET(new Request('http://localhost/api/admin/orders?limit=101'))).status).toBe(400)
    mocks.list.mockResolvedValue({ orders: [], nextCursor: null })
    const response = await GET(new Request('http://localhost/api/admin/orders?status=paid&q=79991234567'))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid', q: '79991234567' }))
  })

  it('guards cancellation with same-origin, validates its audit reason and maps conflicts', async () => {
    const { POST } = await import('@/app/api/admin/orders/[id]/cancel/route')
    mocks.csrf.mockReturnValue(NextResponse.json({}, { status: 403 }))
    expect((await POST(post('http://localhost/api/admin/orders/9/cancel', { reason: 'Нет товара' }), { params: Promise.resolve({ id: '9' }) })).status).toBe(403)
    expect(mocks.cancel).not.toHaveBeenCalled()
    mocks.csrf.mockReturnValue(null)
    expect((await POST(post('http://localhost/api/admin/orders/9/cancel', { reason: 'нет' }), { params: Promise.resolve({ id: '9' }) })).status).toBe(400)
    mocks.cancel.mockResolvedValue('not_pending')
    expect((await POST(post('http://localhost/api/admin/orders/9/cancel', { reason: 'Оплата уже получена' }), { params: Promise.resolve({ id: '9' }) })).status).toBe(409)
    expect(mocks.cancel).toHaveBeenCalledWith(9, 'Оплата уже получена', 7)
  })

  it('only allows exact fulfillment payloads and maps invalid transitions', async () => {
    const { POST } = await import('@/app/api/admin/orders/[id]/fulfillment/route')
    expect((await POST(post('http://localhost/api/admin/orders/9/fulfillment', { status: 'handed_to_carrier' }), { params: Promise.resolve({ id: '9' }) })).status).toBe(400)
    mocks.transition.mockResolvedValue('invalid')
    expect((await POST(post('http://localhost/api/admin/orders/9/fulfillment', { status: 'handed_to_carrier', trackingNumber: '12345' }), { params: Promise.resolve({ id: '9' }) })).status).toBe(409)
    expect(mocks.transition).toHaveBeenCalledWith(9, 'handed_to_carrier', '12345', 7)
  })
})
