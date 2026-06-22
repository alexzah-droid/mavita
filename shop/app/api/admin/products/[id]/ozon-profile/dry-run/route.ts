import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { dryRun } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
async function idOf(params: Promise<{ id: string }>) { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null }

/** Readiness и план действия. Ozon не вызывается. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const id = await idOf(params); if (!id) return err('VALIDATION_ERROR', ['Некорректный id'], 400)
  const result = await dryRun(id)
  return result ? NextResponse.json(result, { headers: noStore }) : err('NOT_FOUND', ['Товар не найден'], 404)
}
