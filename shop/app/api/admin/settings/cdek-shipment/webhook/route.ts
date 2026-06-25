import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { getStoredCredentials } from '@/lib/store-settings'
import { registerWebhook, unregisterWebhook } from '@/lib/cdek-shipment'
import { saveCdekShipmentSettings, getCdekShipmentSettingsDto } from '@/lib/store-settings'

function webhookUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  return base ? `${base}/api/cdek/webhook` : null
}

export async function POST(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })

  const url = webhookUrl()
  if (!url) return NextResponse.json({ error: { messages: ['NEXT_PUBLIC_BASE_URL не задан'] } }, { status: 500 })

  const creds = await getStoredCredentials('cdek')
  if (!creds) return NextResponse.json({ error: { messages: ['Ключи СДЭК не настроены'] } }, { status: 400 })

  const result = await registerWebhook(creds, url)
  if (!result.ok) return NextResponse.json({ error: { messages: [result.error] } }, { status: 502 })

  await saveCdekShipmentSettings({ webhookUuid: result.uuid })
  return NextResponse.json({ uuid: result.uuid })
}

export async function DELETE(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })

  const settings = await getCdekShipmentSettingsDto()
  if (!settings.webhookUuid) return NextResponse.json({ ok: true }) // уже не зарегистрирован

  const creds = await getStoredCredentials('cdek')
  if (creds) {
    // Пытаемся удалить на стороне СДЭК; если не получается — всё равно очищаем у себя
    await unregisterWebhook(creds, settings.webhookUuid)
  }

  await saveCdekShipmentSettings({ webhookUuid: null })
  return NextResponse.json({ ok: true })
}
