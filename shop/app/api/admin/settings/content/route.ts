import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { getSiteContent, saveSiteContent, validateAboutText, validateStihii } from '@/lib/site-content'

const noStore = { 'Cache-Control': 'private, no-store' }
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
function error(message: string) { return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: [message] } }, { status: 400, headers: noStore }) }

export async function GET() {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  return NextResponse.json(await getSiteContent(), { headers: noStore })
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'aboutText,stihii') return error('Некорректные настройки контента')
  const aboutText = validateAboutText((body as { aboutText?: unknown }).aboutText)
  if (!aboutText) return error('Введите от 1 до 5000 символов')
  const stihii = validateStihii((body as { stihii?: unknown }).stihii)
  if (!stihii) return error('Заполните слоган, описание и ноты каждой стихии (до 1000 символов в поле)')
  return NextResponse.json(await saveSiteContent(aboutText, stihii, auth.loginAt), { headers: noStore })
}
