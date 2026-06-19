'use client'

import { useState, type MouseEvent } from 'react'
import type { Product } from '@/lib/products'
import { useCart } from '@/app/cart/CartProvider'

type Props = {
  product: Product
  variant?: 'primary' | 'icon'
  className?: string
}

// Кнопка «в корзину». variant='icon' — стрелка на карточке витрины (внутри Link,
// поэтому гасим переход). variant='primary' — крупная кнопка на странице товара.
export default function AddToCartButton({
  product,
  variant = 'primary',
  className,
}: Props) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)

  function handleClick(e: MouseEvent) {
    // Карточка витрины — это ссылка на товар: не даём добавлению в корзину
    // спровоцировать навигацию.
    e.preventDefault()
    e.stopPropagation()
    if (!product.inStock) return
    add(product, 1)
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

  return (
    <button className={className} type="button" onClick={handleClick}>
      {added ? 'Добавлено ✓' : 'В корзину'}
    </button>
  )
}
