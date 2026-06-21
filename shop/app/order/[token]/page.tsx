import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrderByToken } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { formatRub } from '@/lib/price'
import { CARRIER_LABEL } from '@/lib/store-settings'
import ShopHeader from '@/app/components/ShopHeader'
import SiteFooter from '@/app/components/SiteFooter'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  cancelled: 'Отменён',
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ paid?: string; failed?: string }>
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams])

  const order = await getOrderByToken(token)
  if (!order) notFound()

  // Источник правды о статусе — БД (проставляется в /api/robokassa/result после
  // проверки подписи). ?paid / ?failed — лишь подсказка, откуда вернулся покупатель,
  // и НЕ может выдать неоплаченный заказ за оплаченный.
  const isPaid = order.status === 'paid'
  const justFailed = !isPaid && sp.failed === '1'

  const carrierLabel = order.deliveryCarrier ? CARRIER_LABEL[order.deliveryCarrier] : null

  let paymentUrl: string | null = null
  if (order.status === 'pending' && isRobokassaConfigured()) {
    // Чек повторной оплаты должен совпадать с total_kopecks: при доставке добавляем
    // её строкой, иначе сумма позиций не сойдётся с суммой платежа (I10).
    const deliveryName = carrierLabel ? `Доставка ${carrierLabel} до ПВЗ` : 'Доставка до ПВЗ'
    paymentUrl = buildPaymentUrl(
      order.id,
      order.totalKopecks,
      [
        ...order.items.map((it) => ({ name: it.productName, priceKopecks: it.priceKopecks, quantity: it.quantity })),
        ...(order.deliveryKopecks ? [{ name: deliveryName, priceKopecks: order.deliveryKopecks, quantity: 1 }] : []),
      ],
      order.customerEmail,
      `Заказ №${order.id} — МАВИТА`,
    )
  }

  return (
    <>
      <ShopHeader />

      <div className="order-page">
        <div className="order-inner">
          {isPaid ? (
            <>
              <div className="order-badge order-badge--success">Оплата прошла</div>
              <h1 className="order-title">Спасибо за покупку!</h1>
              <p className="order-lede">
                Заказ <strong>№{order.id}</strong> оплачен.
                <br />
                Мы свяжемся с вами по <strong>{order.customerEmail}</strong>.
              </p>
            </>
          ) : justFailed ? (
            <>
              <div className="order-badge order-badge--fail">Оплата не прошла</div>
              <h1 className="order-title">Что-то пошло не так</h1>
              <p className="order-lede">
                Платёж по заказу <strong>№{order.id}</strong> не был завершён.
                <br />
                Попробуйте ещё раз или свяжитесь с нами.
              </p>
            </>
          ) : (
            <>
              <div className="order-badge">Заказ принят</div>
              <h1 className="order-title">Спасибо за заказ!</h1>
              <p className="order-lede">
                Заказ <strong>№{order.id}</strong> создан. Статус:{' '}
                <strong>{STATUS_LABEL[order.status] ?? order.status}</strong>.
                <br />
                Контактный email: <strong>{order.customerEmail}</strong>.
              </p>
            </>
          )}

          <div className="order-card">
            <div className="order-card-head">Состав заказа</div>
            <ul className="order-items">
              {order.items.map((it, i) => (
                <li key={i}>
                  <span>
                    {it.productName} <em>× {it.quantity}</em>
                  </span>
                  <span>{formatRub(it.priceKopecks * it.quantity)}</span>
                </li>
              ))}
            </ul>
            {order.deliveryKopecks > 0 && (
              <div className="cart-summary-row">
                <span>Доставка{carrierLabel ? ` ${carrierLabel} до ПВЗ` : ''}</span>
                <span>{formatRub(order.deliveryKopecks)}</span>
              </div>
            )}
            <div className="cart-summary-row cart-summary-total order-total">
              <span>Итого</span>
              <span>{formatRub(order.totalKopecks)}</span>
            </div>
          </div>

          {order.pickupPoint && (
            <div className="order-card">
              <div className="order-card-head">Пункт выдачи{carrierLabel ? ` ${carrierLabel}` : ''}</div>
              <p className="order-lede">
                {order.pickupPoint.city} · {order.pickupPoint.name}
                <br />
                {order.pickupPoint.address}
              </p>
            </div>
          )}

          {order.status === 'pending' && paymentUrl && (
            <a href={paymentUrl} className="btn-add checkout-submit order-pay-btn">
              Оплатить заказ
            </a>
          )}

          <Link href="/#catalog" className="hero-cta">
            Вернуться в каталог
          </Link>
        </div>
      </div>
      <SiteFooter />
    </>
  )
}
