import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { getRun, listRunItems } from '@/lib/ozon-fbs-sync'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Статус и построчный итог массового запуска (без секретов). */
export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const runId = (await params).runId
  if (!UUID_RE.test(runId)) return err('VALIDATION_ERROR', ['Некорректный runId'], 400)
  const run = await getRun(runId)
  if (!run) return err('NOT_FOUND', ['Запуск не найден'], 404)
  return NextResponse.json({ run, items: await listRunItems(runId) }, { headers: noStore })
}
