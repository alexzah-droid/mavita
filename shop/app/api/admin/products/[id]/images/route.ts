import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { reorderProductImages } from '@/lib/admin-products-db'
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = Number((await params).id); const body = await request.json().catch(() => null)
  if (!Number.isInteger(id) || !body || !Array.isArray(body.orderedImageIds) || body.orderedImageIds.some((x: unknown) => !Number.isInteger(x)) || !Number.isInteger(body.coverImageId)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Нужны orderedImageIds и coverImageId'] } }, { status: 400 })
  const result = await reorderProductImages(id, body.orderedImageIds, body.coverImageId)
  return result === 'conflict' ? NextResponse.json({ error: { code: 'CONFLICT', messages: ['Набор изображений изменился'] } }, { status: 409 }) : NextResponse.json(result)
}
