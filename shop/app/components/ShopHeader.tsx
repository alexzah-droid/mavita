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
        {/* Логотип содержит словесный знак «МАВИТА» — дублирующий текст не нужен */}
        <Image src="/images/logo.png" alt="МАВИТА" width={98} height={72} className="header-logo" />
      </Link>
      <div className="header-actions">
        <nav className="header-nav">
          <Link href="/#catalog">Каталог</Link>
          <Link href="/#ritual">Ритуал</Link>
          <Link href="/#about">О бренде</Link>
          <Link href="/delivery">Доставка</Link>
        </nav>
        {showCart && <CartButton />}
      </div>
    </header>
  )
}
