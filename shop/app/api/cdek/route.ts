import { NextResponse } from 'next/server'
import { cdekProvider } from '@/lib/cdek'
import { DeliveryProviderError } from '@/lib/delivery/types'
import { DeliveryConfigurationError, getRuntimeCredentials } from '@/lib/store-settings'

const noStore = { 'Cache-Control': 'no-store' }
const unavailable = () => NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: ['Доставка временно недоступна'] } }, { status: 503, headers: noStore })

// Публичный прокси поиска ПВЗ СДЭК по городу. Ключи остаются на сервере; берём
// runtime credentials (только для enabled-перевозчика) из зашифрованных настроек.
export async function GET(request: Request) {
  let creds
  try { creds = await getRuntimeCredentials('cdek') } catch (error) { if (error instanceof DeliveryConfigurationError) return unavailable(); throw error }
  if (!creds) return unavailable()
  try {
    const pickupPoints = await cdekProvider(creds).listPickupPoints(new URL(request.url).searchParams.get('city') ?? undefined)
    return NextResponse.json({ pickupPoints }, { headers: noStore })
  } catch (error) {
    const message = error instanceof DeliveryProviderError ? error.message : 'Доставка временно недоступна'
    return NextResponse.json({ error: { code: 'DELIVERY_UNAVAILABLE', messages: [message] } }, { status: 503, headers: noStore })
  }
}
