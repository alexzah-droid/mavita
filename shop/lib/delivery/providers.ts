// Выбор провайдера ПВЗ по перевозчику. Единая точка, чтобы createOrder/прокси не
// ветвились вручную и новый перевозчик добавлялся здесь.
import type { Carrier } from '@/lib/store-settings'
import type { CarrierProvider, DeliveryCredentials } from '@/lib/delivery/types'
import { cdekProvider } from '@/lib/cdek'

export function providerFor(_carrier: Carrier, creds: DeliveryCredentials): CarrierProvider {
  return cdekProvider(creds)
}
