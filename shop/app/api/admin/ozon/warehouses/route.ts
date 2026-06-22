import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { OzonApiError } from '@/lib/ozon-fbs-client'
import { makeReadOnlyOzonClient, OzonCredentialsMissing } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Серверный список доступных FBS-складов без секретов. */
export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  try {
    const client = await makeReadOnlyOzonClient()
    const warehouses = await client.listWarehouses()
    return NextResponse.json({ warehouses }, { headers: noStore })
  } catch (error) {
    if (error instanceof OzonCredentialsMissing) return err('OZON_NOT_CONFIGURED', ['Ключи Ozon не заданы'], 409)
    if (error instanceof OzonApiError) return err(error.authFailed ? 'OZON_AUTH_FAILED' : 'OZON_UPSTREAM', [error.message], error.authFailed ? 502 : 502)
    throw error
  }
}
