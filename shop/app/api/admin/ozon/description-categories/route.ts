import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { OzonApiError } from '@/lib/ozon-fbs-client'
import { makeReadOnlyOzonClient, OzonCredentialsMissing } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Дерево категорий → список leaf-типов (description_category_id + type_id). */
export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  try {
    const client = await makeReadOnlyOzonClient()
    const leaves = (await client.listCategoryLeaves()).filter((l) => !l.disabled)
    return NextResponse.json({ leaves }, { headers: noStore })
  } catch (error) {
    if (error instanceof OzonCredentialsMissing) return err('OZON_NOT_CONFIGURED', ['Ключи Ozon не заданы'], 409)
    if (error instanceof OzonApiError) return err('OZON_UPSTREAM', [error.message], 502)
    throw error
  }
}
