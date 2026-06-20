import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { parseOrderId } from '@/lib/admin-orders'
import { getAdminOrderById } from '@/lib/admin-orders-db'
function ok(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await requireAdminApi(); if (!ok(auth)) return auth; const id = parseOrderId((await params).id); if (!id) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Некорректный номер заказа'] } }, { status: 400 }); const order = await getAdminOrderById(id); return order ? NextResponse.json(order, { headers: { 'Cache-Control': 'private, no-store' } }) : NextResponse.json({ error: { code: 'NOT_FOUND', messages: ['Заказ не найден'] } }, { status: 404 }) }
