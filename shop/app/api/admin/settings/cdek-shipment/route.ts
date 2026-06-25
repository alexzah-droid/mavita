import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { getCdekShipmentSettingsDto, saveCdekShipmentSettings, CdekShipmentConfigError } from '@/lib/store-settings'

export async function GET(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })
  const settings = await getCdekShipmentSettingsDto()
  return NextResponse.json(settings)
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: { messages: ['Не авторизован'] } }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: { messages: ['Некорректный JSON'] } }, { status: 400 }) }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: { messages: ['Некорректное тело запроса'] } }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const patch: Parameters<typeof saveCdekShipmentSettings>[0] = {}

  if ('autoShipmentEnabled' in b) {
    if (typeof b.autoShipmentEnabled !== 'boolean') errors.push('autoShipmentEnabled должен быть boolean')
    else patch.autoShipmentEnabled = b.autoShipmentEnabled
  }
  if ('shipmentPoint' in b) {
    if (b.shipmentPoint !== null && typeof b.shipmentPoint !== 'string') errors.push('shipmentPoint должен быть строкой или null')
    else patch.shipmentPoint = b.shipmentPoint as string | null
  }
  if ('senderName' in b) {
    if (b.senderName !== null && typeof b.senderName !== 'string') errors.push('senderName должен быть строкой или null')
    else patch.senderName = b.senderName as string | null
  }
  if ('senderPhone' in b) {
    if (b.senderPhone !== null && typeof b.senderPhone !== 'string') errors.push('senderPhone должен быть строкой или null')
    else patch.senderPhone = b.senderPhone as string | null
  }

  for (const [key, col] of [
    ['defaultWeightGrams', 'defaultWeightGrams'] as const,
    ['defaultLengthCm', 'defaultLengthCm'] as const,
    ['defaultWidthCm', 'defaultWidthCm'] as const,
    ['defaultHeightCm', 'defaultHeightCm'] as const,
    ['multiLengthCm', 'multiLengthCm'] as const,
    ['multiWidthCm', 'multiWidthCm'] as const,
    ['multiHeightCm', 'multiHeightCm'] as const,
  ]) {
    if (key in b) {
      const v = Number(b[key])
      if (!Number.isInteger(v) || v <= 0) errors.push(`${key} должен быть положительным целым`)
      else patch[col] = v
    }
  }

  if ('webhookUuid' in b) {
    if (b.webhookUuid !== null && typeof b.webhookUuid !== 'string') errors.push('webhookUuid должен быть строкой или null')
    else patch.webhookUuid = b.webhookUuid as string | null
  }

  if (errors.length) return NextResponse.json({ error: { messages: errors } }, { status: 400 })

  try {
    const settings = await saveCdekShipmentSettings(patch)
    return NextResponse.json(settings)
  } catch (err) {
    if (err instanceof CdekShipmentConfigError) {
      return NextResponse.json({ error: { messages: [err.message] } }, { status: 400 })
    }
    console.error('saveCdekShipmentSettings error', err)
    return NextResponse.json({ error: { messages: ['Не удалось сохранить настройки'] } }, { status: 500 })
  }
}
