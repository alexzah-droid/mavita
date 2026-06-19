import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrder } from '@/lib/orders'
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
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const numericId = Number(id)
  if (!Number.isInteger(numericId)) notFound()

  const order = await getOrder(numericId)
  if (!order) notFound()

  return (
    <>
      <ShopHeader />

      <div className="order-page">
        <div className="order-inner">
          <div className="order-badge">Заказ принят</div>
          <h1 className="order-title">Спасибо за заказ!</h1>
          <p className="order-lede">
            Заказ <strong>№{order.id}</strong> создан. Статус:{' '}
            <strong>{STATUS_LABEL[order.status] ?? order.status}</strong>.
            <br />
            Подтверждение отправлено на <strong>{order.customerEmail}</strong>.
          </p>

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

          <p className="order-note">
            Оплата будет доступна после подключения Робокассы. Мы свяжемся с вами
            по указанным контактам.
          </p>

          <Link href="/#catalog" className="hero-cta">
            Вернуться в каталог
          </Link>
        </div>
      </div>
    </>
  )
}
