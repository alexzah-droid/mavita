import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { clearTelegramCredentials, getTelegramSettings, saveTelegramSettings, validateTelegramChatId, validateTelegramToken } from '@/lib/telegram-settings'

const noStore = { 'Cache-Control': 'private, no-store' }
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
function error(message: string, status = 400) { return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: [message] } }, { status, headers: noStore }) }

export async function GET() { const auth = await requireAdminApi(); if (!authOk(auth)) return auth; return NextResponse.json(await getTelegramSettings(), { headers: noStore }) }

export async function PATCH(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['enabled', 'chatId', 'botToken'].includes(key)) || typeof (body as { enabled?: unknown }).enabled !== 'boolean') return error('Некорректные настройки уведомлений')
  const raw = body as { enabled: boolean; chatId?: unknown; botToken?: unknown }
  if (raw.chatId !== undefined && validateTelegramChatId(raw.chatId) === undefined) return error('ID чата должен состоять из цифр (для группы допустим знак минус)')
  if (raw.botToken !== undefined && raw.botToken !== '' && validateTelegramToken(raw.botToken) === undefined) return error('Некорректный токен Telegram-бота')
  try { return NextResponse.json(await saveTelegramSettings({ enabled: raw.enabled, ...(raw.chatId !== undefined ? { chatId: validateTelegramChatId(raw.chatId) } : {}), ...(typeof raw.botToken === 'string' && raw.botToken ? { botToken: validateTelegramToken(raw.botToken) } : {}) }, auth.loginAt), { headers: noStore }) } catch (err) { return error(err instanceof Error ? err.message : 'Не удалось сохранить настройки') }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || (body as { confirm?: unknown }).confirm !== true || Object.keys(body).length !== 1) return error('Подтвердите удаление токена')
  await clearTelegramCredentials(auth.loginAt)
  return NextResponse.json({ ok: true }, { headers: noStore })
}
