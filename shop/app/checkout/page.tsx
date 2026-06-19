'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/app/cart/CartProvider'
import { formatRub } from '@/lib/price'
import ShopHeader from '@/app/components/ShopHeader'

export default function CheckoutPage() {
  const router = useRouter()
  const { cart, ready, count, totalKopecks, clear } = useCart()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const isEmpty = ready && count === 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErrors([])
    setSubmitting(true)
    try {
      const res = await fetch('/api/robokassa/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          items: cart.lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrors(data.errors ?? [data.error ?? 'Не удалось оформить заказ'])
        setSubmitting(false)
        return
      }
      clear()
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else {
        router.push(`/order/${data.id}`)
      }
    } catch {
      setErrors(['Сеть недоступна. Попробуйте ещё раз.'])
      setSubmitting(false)
    }
  }

  return (
    <>
      <ShopHeader />

      <div className="checkout-page">
        <div className="checkout-inner">
          <Link href="/cart" className="product-back">
            В корзину
          </Link>
          <h1 className="checkout-title">Оформление</h1>

          {!ready && <p className="cart-empty-text">Загрузка…</p>}

          {isEmpty && (
            <div className="cart-empty">
              <p className="cart-empty-text">Корзина пуста — оформлять нечего.</p>
              <Link href="/#catalog" className="hero-cta">
                Смотреть каталог
              </Link>
            </div>
          )}

          {ready && count > 0 && (
            <div className="checkout-layout">
              <form className="checkout-form" onSubmit={handleSubmit} noValidate>
                {errors.length > 0 && (
                  <ul className="checkout-errors">
                    {errors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                )}

                <label className="checkout-field">
                  <span>Имя</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </label>

                <label className="checkout-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="checkout-field">
                  <span>Телефон <em>(необязательно)</em></span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </label>

                <button type="submit" className="btn-add checkout-submit" disabled={submitting}>
                  {submitting ? 'Переходим к оплате…' : 'Перейти к оплате'}
                </button>
              </form>

              <aside className="cart-summary checkout-summary">
                <div className="checkout-summary-title">Ваш заказ</div>
                <ul className="checkout-summary-list">
                  {cart.lines.map((l) => (
                    <li key={l.slug}>
                      <span>
                        {l.name} <em>× {l.quantity}</em>
                      </span>
                      <span>{formatRub(l.priceKopecks * l.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <div className="cart-summary-row cart-summary-total">
                  <span>Итого</span>
                  <span>{formatRub(totalKopecks)}</span>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
