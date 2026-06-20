'use client'

import { useEffect, useState, type FormEvent } from 'react'
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
  const [deliveryKopecks, setDeliveryKopecks] = useState<number | null>(null)
  const [city, setCity] = useState('')
  const [pickupPoints, setPickupPoints] = useState<{ code: string; city: string; name: string; address: string }[]>([])
  const [pickupPoint, setPickupPoint] = useState<{ code: string; city: string; name: string; address: string } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const isEmpty = ready && count === 0
  const totalWithDelivery = totalKopecks + (deliveryKopecks ?? 0)

  useEffect(() => { fetch('/api/checkout/delivery').then(async (res) => { const data = await res.json(); if (res.ok) setDeliveryKopecks(data.cdekPickupDeliveryKopecks); else setErrors(data.error?.messages ?? ['Оформление временно недоступно']) }).catch(() => setErrors(['Оформление временно недоступно'])) }, [])
  async function findPickupPoints() { setErrors([]); setPickupPoints([]); setPickupPoint(null); try { const res = await fetch(`/api/cdek?city=${encodeURIComponent(city)}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.messages?.[0]); setPickupPoints(data.pickupPoints) } catch (error) { setErrors([error instanceof Error ? error.message : 'Не удалось получить пункты выдачи']) } }

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
          delivery: { method: 'cdek_pickup', pickupPointCode: pickupPoint?.code, expectedDeliveryKopecks: deliveryKopecks },
          expectedTotalKopecks: totalWithDelivery,
          items: cart.lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && data.error?.code === 'PRICE_CHANGED') { setDeliveryKopecks(data.deliveryKopecks); setErrors(['Цена изменилась. Проверьте итог и повторите оплату.']) } else setErrors(data.errors ?? data.error?.messages ?? [data.error ?? 'Не удалось оформить заказ'])
        setSubmitting(false)
        return
      }
      clear()
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else {
        router.push(`/order/${data.token}`)
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
                  <span>ФИО получателя</span>
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
                  <span>Телефон получателя</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    required
                  />
                </label>

                <div className="checkout-field">
                  <span>Пункт выдачи СДЭК</span>
                  <div className="checkout-pvz-search"><input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" /><button type="button" className="admin-button" onClick={findPickupPoints} disabled={city.trim().length < 2}>Найти пункты</button></div>
                  {pickupPoints.length > 0 && <select value={pickupPoint?.code ?? ''} onChange={(e) => setPickupPoint(pickupPoints.find((point) => point.code === e.target.value) ?? null)} required><option value="">Выберите пункт выдачи</option>{pickupPoints.map((point) => <option key={point.code} value={point.code}>{point.city} · {point.name} · {point.address}</option>)}</select>}
                  {pickupPoint && <p className="checkout-pvz-selected">{pickupPoint.city} · {pickupPoint.name}<br />{pickupPoint.address}</p>}
                </div>

                <button type="submit" className="btn-add checkout-submit" disabled={submitting || deliveryKopecks === null || !pickupPoint}>
                  {submitting ? 'Переходим к оплате…' : 'Оплатить заказ с доставкой'}
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
                <div className="cart-summary-row"><span>Товары</span><span>{formatRub(totalKopecks)}</span></div>
                <div className="cart-summary-row"><span>Доставка СДЭК до ПВЗ</span><span>{deliveryKopecks === null ? '…' : formatRub(deliveryKopecks)}</span></div>
                <div className="cart-summary-row cart-summary-total">
                  <span>К оплате</span>
                  <span>{deliveryKopecks === null ? '…' : formatRub(totalWithDelivery)}</span>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
