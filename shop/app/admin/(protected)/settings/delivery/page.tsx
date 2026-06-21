import DeliverySettingsForm from '@/app/admin/DeliverySettingsForm'
import { getDeliverySettings } from '@/lib/store-settings'
export const dynamic = 'force-dynamic'
export default async function DeliveryPage() {
  // В форму уходит только безопасный DTO (маски/статусы), без открытых секретов.
  return <section className="admin-content"><p className="admin-kicker">НАСТРОЙКИ</p><h1>Доставка</h1><DeliverySettingsForm initial={await getDeliverySettings()} /></section>
}
