// Выбор провайдера ПВЗ по перевозчику. Единая точка, чтобы createOrder/прокси не
// ветвились вручную и третий перевозчик добавлялся здесь.
import type { Carrier } from '@/lib/store-settings'
import type { CarrierProvider, DeliveryCredentials } from '@/lib/delivery/types'
import { cdekProvider } from '@/lib/cdek'
import { ozonProvider } from '@/lib/ozon'

export function providerFor(carrier: Carrier, creds: DeliveryCredentials): CarrierProvider {
  return carrier === 'cdek' ? cdekProvider(creds) : ozonProvider(creds)
}
