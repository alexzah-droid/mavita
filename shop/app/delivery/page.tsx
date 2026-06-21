import type { Metadata } from 'next'
import Link from 'next/link'
import ShopHeader from '@/app/components/ShopHeader'
import SiteFooter from '@/app/components/SiteFooter'
import { CARRIER_LABEL, resolveDeliveryMode } from '@/lib/store-settings'
import { formatRub } from '@/lib/price'

export const metadata: Metadata = {
  title: 'Доставка — МАВИТА',
  description: 'Доставка заказов МАВИТА в пункты выдачи СДЭК и ОЗОН. Стоимость, сроки и порядок оплаты.',
}

// Динамическая страница: активные перевозчики и тарифы берутся из настроек
// магазина (store_settings), 0 означает бесплатную доставку. Контент — из раздела
// «Денежный поток» спецификаций cdek-pvz.md / ozon-pvz.md.
export const dynamic = 'force-dynamic'

export default async function DeliveryPage() {
  const { mode, carriers } = await resolveDeliveryMode()
  const active = mode === 'pickup_required' ? carriers : []
  const carrierNames = active.map((c) => CARRIER_LABEL[c.carrier]).join(' и ') || 'СДЭК'

  return (
    <>
      <ShopHeader />
      <main className="legal-page">
        <div className="legal-inner">
          <h1 className="legal-title">Доставка</h1>
          <p className="legal-subtitle">Пункты выдачи {carrierNames} по всей России</p>

          <h2>Как мы доставляем</h2>
          <p>
            Заказы доставляются <strong>до пункта выдачи (ПВЗ)</strong> службой {carrierNames}. При оформлении
            вы выбираете перевозчика, указываете город и удобный пункт выдачи из списка — туда и приедет ваш
            заказ. Забрать его можно по номеру заказа и документу, удостоверяющему личность.
          </p>

          <h2>Сколько стоит</h2>
          {active.length > 0 ? (
            <ul>
              {active.map((c) => (
                <li key={c.carrier}>
                  <strong>{CARRIER_LABEL[c.carrier]}:</strong>{' '}
                  {c.deliveryKopecks === 0 ? 'бесплатно' : formatRub(c.deliveryKopecks)} — единый фиксированный
                  тариф, отдельной строкой при оформлении.
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Стоимость доставки в пункт выдачи — единый фиксированный тариф. Точная сумма отображается
              отдельной строкой при оформлении заказа.
            </p>
          )}

          <h2>Как оплачивается</h2>
          <p>
            Вы оплачиваете заказ <strong>на сайте, одной суммой</strong> — товары и доставка вместе. Никаких
            доплат при получении нет.
          </p>
          <p>
            <strong>Пункту выдачи вы отдельно ничего не платите.</strong> Стоимость доставки в
            заказе — это компенсация магазину расходов на отправку; расчёты с перевозчиком магазин ведёт
            самостоятельно.
          </p>

          <h2>Сроки</h2>
          <p>
            Мы отправляем заказ после поступления оплаты. Срок доставки до пункта выдачи зависит от вашего
            региона и обычно составляет несколько рабочих дней. После отправки мы сообщим, что заказ передан
            перевозчику.
          </p>

          <p className="legal-note">
            Остались вопросы по доставке? Напишите нам:{' '}
            <a href="mailto:mavitasvechi@mail.ru">mavitasvechi@mail.ru</a> или{' '}
            <a href="tel:+79211899008">+7 921 189-90-08</a>. Условия продажи описаны в{' '}
            <Link href="/offer">публичной оферте</Link>.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
