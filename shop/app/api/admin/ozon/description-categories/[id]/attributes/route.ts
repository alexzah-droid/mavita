import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { OzonApiError } from '@/lib/ozon-fbs-client'
import { makeReadOnlyOzonClient, OzonCredentialsMissing } from '@/lib/ozon-fbs-service'

function authOk(v: Awaited<ReturnType<typeof requireAdminApi>>): v is { isAdmin: true; loginAt: number } { return !(v instanceof NextResponse) }
const noStore = { 'Cache-Control': 'private, no-store' }
const err = (code: string, messages: string[], status: number) => NextResponse.json({ error: { code, messages } }, { status, headers: noStore })

/** Атрибуты выбранной пары категории/type (typeId — обязательный query-параметр). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const categoryId = Number((await params).id)
  const typeId = Number(new URL(request.url).searchParams.get('typeId'))
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isInteger(typeId) || typeId <= 0) return err('VALIDATION_ERROR', ['Нужны корректные descriptionCategoryId и typeId'], 400)
  try {
    const client = await makeReadOnlyOzonClient()
    const attributes = await client.listCategoryAttributes(categoryId, typeId)
    return NextResponse.json({ attributes }, { headers: noStore })
  } catch (error) {
    if (error instanceof OzonCredentialsMissing) return err('OZON_NOT_CONFIGURED', ['Ключи Ozon не заданы'], 409)
    if (error instanceof OzonApiError) return err('OZON_UPSTREAM', [error.message], 502)
    throw error
  }
}
