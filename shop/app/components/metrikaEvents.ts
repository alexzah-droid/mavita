// Клиентские события воронки для Яндекс Метрики: цели (reachGoal) + e-commerce
// через dataLayer (счётчик инициализирован с ecommerce:"dataLayer").
// В dev-режиме и до загрузки счётчика window.ym/dataLayer отсутствуют — вызовы
// тихо превращаются в no-op, поэтому хелперы безопасно звать безусловно.

import { YANDEX_METRIKA_ID } from '@/app/components/yandexMetrikaConfig'

declare global {
  interface Window {
    dataLayer?: object[]
  }
}

// Метрика ждёт цены в валюте счётчика (рубли), внутри магазина всё в копейках (I2).
const rub = (kopecks: number) => kopecks / 100

function reachGoal(goal: string) {
  window.ym?.(YANDEX_METRIKA_ID, 'reachGoal', goal)
}

function pushEcommerce(payload: Record<string, unknown>) {
  window.dataLayer?.push({ ecommerce: { currencyCode: 'RUB', ...payload } })
}

export function trackAddToCart(
  product: { slug: string; name: string },
  priceKopecks: number,
  quantity = 1,
) {
  pushEcommerce({ add: { products: [{ id: product.slug, name: product.name, price: rub(priceKopecks), quantity }] } })
  reachGoal('add_to_cart')
}

export function trackBeginCheckout() {
  reachGoal('begin_checkout')
}

export function trackPurchase(order: {
  id: number
  revenueKopecks: number
  items: { name: string; priceKopecks: number; quantity: number }[]
}) {
  pushEcommerce({
    purchase: {
      actionField: { id: String(order.id), revenue: rub(order.revenueKopecks) },
      // В позициях заказа только snapshot названия (без slug) — им же и идентифицируем.
      products: order.items.map((it) => ({ id: it.name, name: it.name, price: rub(it.priceKopecks), quantity: it.quantity })),
    },
  })
  reachGoal('purchase')
}
