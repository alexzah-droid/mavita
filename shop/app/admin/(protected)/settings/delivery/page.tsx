import DeliverySettingsForm from '@/app/admin/DeliverySettingsForm'
import CdekShipmentSettingsForm from '@/app/admin/CdekShipmentSettingsForm'
import { getDeliverySettings, getCdekShipmentSettingsDto } from '@/lib/store-settings'
export const dynamic = 'force-dynamic'
export default async function DeliveryPage() {
  const [deliverySettings, cdekShipmentSettings] = await Promise.all([
    getDeliverySettings(),
    getCdekShipmentSettingsDto(),
  ])
  return (
    <section className="admin-content">
      <p className="admin-kicker">НАСТРОЙКИ</p>
      <h1>Доставка</h1>
      <DeliverySettingsForm initial={deliverySettings} />
      <CdekShipmentSettingsForm initial={cdekShipmentSettings} />
    </section>
  )
}
