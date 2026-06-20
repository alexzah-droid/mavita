import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { withTransaction } from '@/lib/db'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = Number((await params).id); const body = await request.json().catch(() => null)
  if (!Number.isInteger(id) || !body || !Array.isArray(body.orderedImageIds) || !Number.isInteger(body.coverImageId)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Нужны orderedImageIds и coverImageId'] } }, { status: 400 })
  const ok = await withTransaction(async (client) => {
    const rows = await client.query<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 FOR UPDATE', [id]); const actual = rows.rows.map((x) => x.id); const ordered = body.orderedImageIds as number[]
    const actualIds = [...actual].sort((a, b) => a - b); const orderedIds = [...ordered].sort((a, b) => a - b)
    if (actual.length !== ordered.length || new Set(ordered).size !== ordered.length || !ordered.includes(body.coverImageId) || actualIds.some((imageId, index) => imageId !== orderedIds[index])) return false
    // uq_product_cover проверяется PostgreSQL на каждом statement. Сначала
    // освобождаем старую обложку, и только затем назначаем новую — иначе при
    // перемещении новой cover раньше старой возникнет временный дубль и 23505.
    await client.query('UPDATE product_images SET is_cover = false WHERE product_id = $1 AND is_cover = true', [id])
    for (const [index, imageId] of ordered.entries()) await client.query('UPDATE product_images SET sort_order = $1, is_cover = $2 WHERE id = $3', [(index + 1) * 10, imageId === body.coverImageId, imageId])
    return true
  })
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { code: 'CONFLICT', messages: ['Набор изображений изменился'] } }, { status: 409 })
}
