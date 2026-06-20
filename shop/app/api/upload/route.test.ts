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

function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
  const size = kind === 'VP8L' ? 25 : 30; const data = Buffer.alloc(size)
  data.write('RIFF'); data.writeUInt32LE(size - 8, 4); data.write('WEBP', 8); data.write(kind, 12)
  if (kind === 'VP8 ') { data.writeUInt32LE(10, 16); data.set([0x9d, 0x01, 0x2a], 23); data.writeUInt16LE(width, 26); data.writeUInt16LE(height, 28) }
  if (kind === 'VP8L') { data.writeUInt32LE(5, 16); data[20] = 0x2f; data.writeUInt32LE((width - 1) | ((height - 1) << 14), 21) }
  if (kind === 'VP8X') { data.writeUInt32LE(10, 16); data.writeUIntLE(width - 1, 24, 3); data.writeUIntLE(height - 1, 27, 3) }
  return data
}
describe('WebP dimensions', () => {
  it.each(['VP8 ', 'VP8L', 'VP8X'] as const)('accepts %s WebP', async (kind) => {
    const { imageDimensions } = await import('@/lib/upload-image')
    expect(imageDimensions(webp(kind, 640, 480), 'image/webp')).toEqual([640, 480])
  })
})
