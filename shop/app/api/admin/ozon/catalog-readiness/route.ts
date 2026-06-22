import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { bulkReadiness } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }

/** Массовый dry-run: readiness всех enabled-профилей. Ozon не вызывается. */
export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  return NextResponse.json({ rows: await bulkReadiness() }, { headers: noStore })
}
