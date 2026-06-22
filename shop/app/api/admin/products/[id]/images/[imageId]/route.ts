import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { deleteProductImage } from '@/lib/admin-products-db'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const p = await params; const productId = Number(p.id); const imageId = Number(p.imageId); if (!Number.isInteger(productId) || !Number.isInteger(imageId)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Некорректный id'] } }, { status: 400 })
  const result = await deleteProductImage(productId, imageId)
  if (!result) return NextResponse.json({ error: { code: 'NOT_FOUND', messages: ['Фото не найдено'] } }, { status: 404 })
  // DB-запись удаляется первой; неудачное удаление файла оставляет безопасный orphan
  // для cleanup job, но не отменяет успешное удаление.
  const base = path.basename(result.filename); await unlink(path.join(process.cwd(), 'public', 'uploads', 'products', base)).catch(() => undefined)
  return NextResponse.json({ images: result.images })
}
