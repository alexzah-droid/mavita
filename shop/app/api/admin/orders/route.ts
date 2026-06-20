import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { parseAdminOrderFilters } from '@/lib/admin-orders'
import { listAdminOrders } from '@/lib/admin-orders-db'
function ok(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function GET(request: Request) { const auth = await requireAdminApi(); if (!ok(auth)) return auth; const parsed = parseAdminOrderFilters(new URL(request.url).searchParams); if (!parsed.value) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: parsed.errors } }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } }); return NextResponse.json(await listAdminOrders(parsed.value), { headers: { 'Cache-Control': 'private, no-store' } }) }
