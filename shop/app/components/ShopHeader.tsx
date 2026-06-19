'use client'

import Image from 'next/image'
import Link from 'next/link'
import CartButton from '@/app/cart/CartButton'

// Шапка внутренних страниц (товар, корзина, оформление, заказ).
// Корзина вынесена из .header-nav, поэтому остаётся видимой на мобильных,
// где навигационные ссылки скрываются.
export default function ShopHeader({ showCart = true }: { showCart?: boolean }) {
  return (
    <header className="site-header scrolled" style={{ position: 'sticky' }}>
      <Link href="/" className="header-brand">
        <Image src="/images/logo.png" alt="МАВИТА" width={38} height={38} className="header-logo" />
        <span className="header-name">МАВИТА</span>
      </Link>
      <div className="header-actions">
        <nav className="header-nav">
          <Link href="/#catalog">Каталог</Link>
          <Link href="/#ritual">Ритуал</Link>
          <Link href="/#about">О бренде</Link>
        </nav>
        {showCart && <CartButton />}
      </div>
    </header>
  )
}
