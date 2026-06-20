// Чистая логика корзины — без React и без localStorage, поэтому полностью
// покрывается юнит-тестами. Суммы — в копейках (I2). Все функции возвращают
// новый объект корзины (иммутабельно).

import type { Product } from '@/lib/products'
import { effectivePrice } from '@/lib/pricing'

export type CartLine = {
  slug: string
  name: string
  priceKopecks: number
  image: string
  quantity: number
}

export type Cart = {
  lines: CartLine[]
}

export const EMPTY_CART: Cart = { lines: [] }

const MAX_QTY = 99

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1
  const n = Math.floor(qty)
  if (n < 1) return 1
  if (n > MAX_QTY) return MAX_QTY
  return n
}

/** Добавить товар. Если позиция уже есть — увеличить количество (слияние дублей). */
export function addItem(cart: Cart, product: Product, qty = 1): Cart {
  const add = clampQty(qty)
  const existing = cart.lines.find((l) => l.slug === product.slug)
  if (existing) {
    return {
      lines: cart.lines.map((l) =>
        l.slug === product.slug
          ? { ...l, quantity: clampQty(l.quantity + add) }
          : l,
      ),
    }
  }
  const line: CartLine = {
    slug: product.slug,
    name: product.name,
    // Только UX-snapshot корзины: сервер всё равно пересчитает цену при заказе.
    priceKopecks: effectivePrice({
      priceKopecks: product.priceKopecks,
      salePriceKopecks: product.sale?.priceKopecks ?? null,
      saleStartsAt: product.sale?.startsAt ?? null,
      saleEndsAt: product.sale?.endsAt ?? null,
    }, new Date()).kopecks,
    image: product.image,
    quantity: add,
  }
  return { lines: [...cart.lines, line] }
}

/** Удалить позицию по slug. */
export function removeItem(cart: Cart, slug: string): Cart {
  return { lines: cart.lines.filter((l) => l.slug !== slug) }
}

/** Установить количество. qty <= 0 удаляет позицию. */
export function setQuantity(cart: Cart, slug: string, qty: number): Cart {
  if (qty <= 0) return removeItem(cart, slug)
  return {
    lines: cart.lines.map((l) =>
      l.slug === slug ? { ...l, quantity: clampQty(qty) } : l,
    ),
  }
}

export function clearCart(): Cart {
  return { lines: [] }
}

/** Суммарное количество единиц товара (для счётчика в шапке). */
export function cartCount(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.quantity, 0)
}

/** Итоговая сумма в копейках. */
export function cartTotalKopecks(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.priceKopecks * l.quantity, 0)
}
