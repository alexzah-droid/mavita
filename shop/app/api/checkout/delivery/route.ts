import { NextResponse } from 'next/server'
import { getDeliverySettings } from '@/lib/store-settings'
export async function GET() { const settings = await getDeliverySettings(); return settings ? NextResponse.json({ cdekPickupDeliveryKopecks: settings.cdekPickupDeliveryKopecks }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Оформление временно недоступно'] } }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
