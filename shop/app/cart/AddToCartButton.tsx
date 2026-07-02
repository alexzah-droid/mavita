'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/lib/products'
import { useCart } from '@/app/cart/CartProvider'
import { effectivePrice } from '@/lib/pricing'
import { trackAddToCart } from '@/app/components/metrikaEvents'

type Props = {
  product: Product
  variant?: 'primary' | 'icon' | 'buy'
  className?: string
}

// Кнопка «в корзину». variant='icon' — стрелка на карточке витрины (внутри Link,
// поэтому гасим переход). variant='primary' — крупная кнопка на странице товара.
// variant='buy' — «Купить» в один клик: добавляет в корзину и сразу ведёт на чекаут.
export default function AddToCartButton({
  product,
  variant = 'primary',
  className,
}: Props) {
  const { add } = useCart()
  const router = useRouter()
  const [added, setAdded] = useState(false)

  function handleClick(e: MouseEvent) {
    // Карточка витрины — это ссылка на товар: не даём добавлению в корзину
    // спровоцировать навигацию.
    e.preventDefault()
    e.stopPropagation()
    if (!product.inStock) return
    add(product, 1, { silent: variant === 'buy' })
    trackAddToCart(product, effectivePrice({
      priceKopecks: product.priceKopecks,
      salePriceKopecks: product.sale?.priceKopecks ?? null,
      saleStartsAt: product.sale?.startsAt ?? null,
      saleEndsAt: product.sale?.endsAt ?? null,
    }, new Date()).kopecks)
    if (variant === 'buy') {
      router.push('/checkout')
      return
    }
    setAdded(true)
    window.setTimeout(() => setAdded(false), 1600)
  }

  if (!product.inStock) {
    return (
      <button className={className} type="button" disabled aria-disabled>
        {variant === 'icon' ? '×' : 'Нет в наличии'}
      </button>
    )
  }

  if (variant === 'icon') {
    return (
      <button
        className={className}
        type="button"
        aria-label="Добавить в корзину"
        onClick={handleClick}
      >
        {added ? '✓' : '→'}
      </button>
    )
  }

  if (variant === 'buy') {
    return (
      <button className={className} type="button" onClick={handleClick}>
        Купить
      </button>
    )
  }

  return (
    <button className={className} type="button" onClick={handleClick}>
      {added ? 'Добавлено ✓' : 'В корзину'}
    </button>
  )
}
