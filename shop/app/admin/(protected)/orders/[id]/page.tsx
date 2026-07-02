import { notFound } from 'next/navigation'
import { getAdminOrderById } from '@/lib/admin-orders-db'
import { parseOrderId } from '@/lib/admin-orders'
import AdminOrderActions from '@/app/admin/AdminOrderActions'
import AdminOrderCdek from '@/app/admin/AdminOrderCdek'
import { formatRub } from '@/lib/price'
import { CARRIER_LABEL } from '@/lib/store-settings'
export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseOrderId((await params).id)
  if (!id) notFound()
  const order = await getAdminOrderById(id)
  if (!order) notFound()

  const carrierLabel = order.deliveryCarrier ? CARRIER_LABEL[order.deliveryCarrier] : 'Доставка'
  const statusLabel = order.status === 'paid' ? 'Оплачен' : order.status === 'cancelled' ? 'Отменён' : 'Ожидает оплаты'
  const fmt = (d: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(d))
  const fmtShort = (d: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(d))

  type AdminEvent = NonNullable<typeof order>['adminEvents'][number]
  function eventLabel(event: AdminEvent) {
    if (event.eventType === 'cancelled') return `Отмена: ${event.reason}`
    if (event.eventType === 'cdek_status_update') {
      const actor = event.actorLoginAt === 0 ? 'СДЭК (авто)' : 'администратор'
      return `${actor} · ${event.fromFulfillmentStatus} → ${event.toFulfillmentStatus}`
    }
    return `${event.fromFulfillmentStatus} → ${event.toFulfillmentStatus}`
  }

  const showCdek = Boolean(order.cdekOrderUuid || order.cdekError)

  return (
    <section className="admin-content">
      <p className="admin-kicker">ЗАКАЗ №{order.id}</p>
      <h1>{statusLabel}</h1>
      <p>
        {fmt(order.createdAt)}
        {order.invId && ` · Robokassa InvId ${order.invId}`}
      </p>

      <div className="admin-detail-grid">
        <section>
          <h2>Получатель</h2>
          <p>
            {order.customerName}<br />
            {order.customerEmail}<br />
            {order.customerPhone ?? 'Телефон отсутствует в legacy-заказе'}
          </p>

          {order.customerComment && (
            <>
              <h2>Комментарий покупателя</h2>
              <p>{order.customerComment}</p>
            </>
          )}

          <h2>Доставка</h2>
          {order.pickupPoint ? (
            <p>
              {carrierLabel} · {order.pickupPoint.city}<br />
              {order.pickupPoint.name}<br />
              {order.pickupPoint.address}<br />
              <code>{order.pickupPoint.code}</code>
            </p>
          ) : (
            <p>Данные доставки отсутствуют (legacy-заказ).</p>
          )}
          {order.trackingNumber && <p>Трек-номер: <strong>{order.trackingNumber}</strong></p>}
        </section>

        <section>
          <h2>Состав</h2>
          {order.items.map((item) => (
            <p key={`${item.productName}${item.quantity}`}>
              {item.productName} · {item.quantity} × {formatRub(item.priceKopecks)} = {formatRub(item.quantity * item.priceKopecks)}
            </p>
          ))}
          <p>
            Товары: {formatRub(order.itemsKopecks)}<br />
            Доставка{order.deliveryCarrier ? ` ${carrierLabel}` : ''}: {formatRub(order.deliveryKopecks)}<br />
            <strong>К оплате: {formatRub(order.totalKopecks)}</strong>
          </p>
        </section>
      </div>

      <AdminOrderActions order={order} />

      {showCdek && (
        <AdminOrderCdek
          orderId={order.id}
          cdekOrderUuid={order.cdekOrderUuid}
          cdekNumber={order.cdekNumber}
          cdekWaybillUrl={order.cdekWaybillUrl}
          cdekBarcodeUrl={order.cdekBarcodeUrl}
          cdekError={order.cdekError}
        />
      )}

      <h2>Журнал действий</h2>
      {order.adminEvents.length ? (
        <ul>
          {order.adminEvents.map((event) => (
            <li key={event.id}>
              {fmtShort(event.createdAt)} · {eventLabel(event)}
              {event.trackingNumber ? ` · ${event.trackingNumber}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p>Ручных действий пока нет.</p>
      )}
    </section>
  )
}
