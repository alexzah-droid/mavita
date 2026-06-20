import type { Metadata } from 'next'
import Link from 'next/link'
import ShopHeader from '@/app/components/ShopHeader'
import SiteFooter from '@/app/components/SiteFooter'
import { getDeliverySettings } from '@/lib/store-settings'
import { formatRub } from '@/lib/price'

export const metadata: Metadata = {
  title: 'Доставка — МАВИТА',
  description: 'Доставка заказов МАВИТА в пункты выдачи СДЭК. Стоимость, сроки и порядок оплаты.',
}

// Динамическая страница: текущая стоимость доставки берётся из настроек магазина
// (store_settings), 0 означает бесплатную доставку. Контент — из раздела
// «Денежный поток» спецификации docs/specs/cdek-pvz.md.
export const dynamic = 'force-dynamic'

export default async function DeliveryPage() {
  const settings = await getDeliverySettings()
  const costLabel =
    settings == null
      ? null
      : settings.cdekPickupDeliveryKopecks === 0
        ? 'бесплатно'
        : formatRub(settings.cdekPickupDeliveryKopecks)

  return (
    <>
      <ShopHeader />
      <main className="legal-page">
        <div className="legal-inner">
          <h1 className="legal-title">Доставка</h1>
          <p className="legal-subtitle">Пункты выдачи СДЭК по всей России</p>

          <h2>Как мы доставляем</h2>
          <p>
            Заказы доставляются службой <strong>СДЭК до пункта выдачи (ПВЗ)</strong>. При оформлении вы
            указываете город и выбираете удобный пункт выдачи из списка — туда и приедет ваш заказ. Забрать
            его можно по номеру заказа и документу, удостоверяющему личность.
          </p>

          <h2>Сколько стоит</h2>
          {costLabel ? (
            <p>
              Стоимость доставки в пункт выдачи —{' '}
              <strong>{costLabel === 'бесплатно' ? 'бесплатно' : `${costLabel}`}</strong>. Это единый
              фиксированный тариф, он не зависит от веса и габаритов и отображается отдельной строкой при
              оформлении заказа.
            </p>
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
            <strong>Пункту выдачи и курьеру СДЭК вы отдельно ничего не платите.</strong> Стоимость доставки в
            заказе — это компенсация магазину расходов на отправку; рассчёты со СДЭК магазин ведёт
            самостоятельно.
          </p>

          <h2>Сроки</h2>
          <p>
            Мы отправляем заказ после поступления оплаты. Срок доставки до пункта выдачи зависит от вашего
            региона и обычно составляет несколько рабочих дней. После отправки мы сообщим, что заказ передан
            в СДЭК.
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
