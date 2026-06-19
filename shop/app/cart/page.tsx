'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCart } from '@/app/cart/CartProvider'
import { formatRub } from '@/lib/price'
import ShopHeader from '@/app/components/ShopHeader'

export default function CartPage() {
  const { cart, ready, count, totalKopecks, setQty, remove } = useCart()
  const isEmpty = ready && count === 0

  return (
    <>
      <ShopHeader showCart={false} />

      <div className="cart-page">
        <div className="cart-inner">
          <Link href="/#catalog" className="product-back">
            В каталог
          </Link>
          <h1 className="cart-title">Корзина</h1>

          {!ready && <p className="cart-empty-text">Загрузка…</p>}

          {isEmpty && (
            <div className="cart-empty">
              <p className="cart-empty-text">В корзине пока пусто.</p>
              <Link href="/#catalog" className="hero-cta">
                Смотреть каталог
              </Link>
            </div>
          )}

          {ready && count > 0 && (
            <div className="cart-layout">
              <ul className="cart-lines">
                {cart.lines.map((line) => (
                  <li key={line.slug} className="cart-line">
                    <Link href={`/product/${line.slug}`} className="cart-line-image">
                      {line.image && (
                        <Image
                          src={line.image}
                          alt={line.name}
                          fill
                          sizes="96px"
                          style={{ objectFit: 'cover' }}
                        />
                      )}
                    </Link>

                    <div className="cart-line-body">
                      <Link href={`/product/${line.slug}`} className="cart-line-name">
                        {line.name}
                      </Link>
                      <div className="cart-line-price">{formatRub(line.priceKopecks)}</div>
                    </div>

                    <div className="cart-line-qty">
                      <button
                        type="button"
                        aria-label="Уменьшить"
                        onClick={() => setQty(line.slug, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        type="button"
                        aria-label="Увеличить"
                        onClick={() => setQty(line.slug, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>

                    <div className="cart-line-sum">
                      {formatRub(line.priceKopecks * line.quantity)}
                    </div>

                    <button
                      type="button"
                      className="cart-line-remove"
                      aria-label="Удалить"
                      onClick={() => remove(line.slug)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              <aside className="cart-summary">
                <div className="cart-summary-row">
                  <span>Товаров</span>
                  <span>{count}</span>
                </div>
                <div className="cart-summary-row cart-summary-total">
                  <span>Итого</span>
                  <span>{formatRub(totalKopecks)}</span>
                </div>
                <Link href="/checkout" className="btn-add cart-checkout">
                  Оформить заказ
                </Link>
                <p className="cart-summary-note">
                  Оплата (Робокасса) подключается на следующем шаге.
                </p>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
