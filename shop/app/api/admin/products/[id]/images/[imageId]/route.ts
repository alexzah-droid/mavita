import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { withTransaction } from '@/lib/db'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const p = await params; const productId = Number(p.id); const imageId = Number(p.imageId); if (!Number.isInteger(productId) || !Number.isInteger(imageId)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Некорректный id'] } }, { status: 400 })
  const filename = await withTransaction(async (client) => { const result = await client.query<{ filename: string; is_cover: boolean }>('DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING filename, is_cover', [imageId, productId]); const image = result.rows[0]; if (!image) return null; if (image.is_cover) await client.query(`UPDATE product_images SET is_cover = true WHERE id = (SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order, id LIMIT 1)`, [productId]); return image.filename })
  if (!filename) return NextResponse.json({ error: { code: 'NOT_FOUND', messages: ['Фото не найдено'] } }, { status: 404 })
  const base = path.basename(filename); await unlink(path.join(process.cwd(), 'public', 'uploads', 'products', base)).catch(() => undefined)
  return NextResponse.json({ ok: true })
}
