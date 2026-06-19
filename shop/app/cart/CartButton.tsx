'use client'

import Link from 'next/link'
import { useCart } from '@/app/cart/CartProvider'

// Ссылка на корзину в шапке со счётчиком. До гидрации счётчик скрыт,
// чтобы не было расхождения SSR/CSR.
export default function CartButton() {
  const { count, ready } = useCart()
  return (
    <Link href="/cart" className="header-cart" aria-label="Корзина">
      Корзина
      {ready && count > 0 && <span className="header-cart-count">{count}</span>}
    </Link>
  )
}
