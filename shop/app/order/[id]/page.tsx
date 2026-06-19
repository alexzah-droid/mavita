import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrder } from '@/lib/orders'
import { buildPaymentUrl, isRobokassaConfigured } from '@/lib/robokassa'
import { formatRub } from '@/lib/price'
import ShopHeader from '@/app/components/ShopHeader'

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
  params: Promise<{ id: string }>
  searchParams: Promise<{ paid?: string; failed?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const numericId = Number(id)
  if (!Number.isInteger(numericId)) notFound()

  const order = await getOrder(numericId)
  if (!order) notFound()

  const justPaid = sp.paid === '1'
  const justFailed = sp.failed === '1'

  let paymentUrl: string | null = null
  if (order.status === 'pending' && isRobokassaConfigured()) {
    paymentUrl = buildPaymentUrl(
      order.id,
      order.totalKopecks,
      order.customerEmail,
      `Заказ №${order.id} — МАВИТА`,
    )
  }

  return (
    <>
      <ShopHeader />

      <div className="order-page">
        <div className="order-inner">
          {justPaid ? (
            <>
              <div className="order-badge order-badge--success">Оплата прошла</div>
              <h1 className="order-title">Спасибо за покупку!</h1>
              <p className="order-lede">
                Заказ <strong>№{order.id}</strong> оплачен.
                <br />
                Подтверждение отправлено на <strong>{order.customerEmail}</strong>.
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
                Подтверждение отправлено на <strong>{order.customerEmail}</strong>.
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
            <div className="cart-summary-row cart-summary-total order-total">
              <span>Итого</span>
              <span>{formatRub(order.totalKopecks)}</span>
            </div>
          </div>

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
    </>
  )
}
