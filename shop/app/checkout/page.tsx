'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/app/cart/CartProvider'
import { formatRub } from '@/lib/price'
import { parsePriceChangedAmounts } from '@/lib/checkout-amounts'
import ShopHeader from '@/app/components/ShopHeader'
import CdekWidget from './CdekWidget'
import type { PickupPoint } from '@/lib/delivery/types'

type CdekCity = { code: number; city: string; region: string | null }
function cityLabel(c: CdekCity) { return c.region ? `${c.city}, ${c.region}` : c.city }

export default function CheckoutPage() {
  const router = useRouter()
  const { cart, ready, count, totalKopecks, clear } = useCart()

  type DeliveryCarrier = { carrier: 'cdek'; label: string; deliveryKopecks: number }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // null — статус доставки ещё не загружен; false — доставка отключена, заказ без ПВЗ.
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean | null>(null)
  const [carriers, setCarriers] = useState<DeliveryCarrier[]>([])
  const [carrier, setCarrier] = useState<DeliveryCarrier | null>(null)
  // Суммы, подтверждённые сервером после 409 PRICE_CHANGED.
  const [confirmedAmounts, setConfirmedAmounts] = useState<{ itemsKopecks: number; deliveryKopecks: number; totalKopecks: number } | null>(null)
  // Город: ввод (cityInput) + выбранный город с city_code (selectedCity).
  const [cityInput, setCityInput] = useState('')
  const [citySuggestions, setCitySuggestions] = useState<CdekCity[]>([])
  const [selectedCity, setSelectedCity] = useState<CdekCity | null>(null)
  // Город, определённый по IP — пока хранится, показываем плашку «Ваш город — X».
  const [ipPrefillCity, setIpPrefillCity] = useState<CdekCity | null>(null)
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([])
  const [pickupPoint, setPickupPoint] = useState<PickupPoint | null>(null)
  const [pointFilter, setPointFilter] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [widgetFailed, setWidgetFailed] = useState(false)
  const isCdek = carrier?.carrier === 'cdek'
  const yandexKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? ''
  const useWidget = isCdek && yandexKey.length > 0 && !widgetFailed

  const isEmpty = ready && count === 0
  const deliveryKopecks = deliveryEnabled === false ? 0 : carrier?.deliveryKopecks ?? null
  const itemsForPayment = confirmedAmounts?.itemsKopecks ?? totalKopecks
  const deliveryForPayment = confirmedAmounts?.deliveryKopecks ?? deliveryKopecks
  const totalWithDelivery = confirmedAmounts?.totalKopecks ?? totalKopecks + (deliveryKopecks ?? 0)

  // Восстанавливаем поля из localStorage при монтировании.
  useEffect(() => {
    setPhone(localStorage.getItem('mavita_checkout_phone') ?? '')
    setName(localStorage.getItem('mavita_checkout_name') ?? '')
    setEmail(localStorage.getItem('mavita_checkout_email') ?? '')
  }, [])

  useEffect(() => { fetch('/api/checkout/delivery').then(async (res) => { const data = await res.json(); if (res.ok) { if (data.mode === 'pickup_required' && Array.isArray(data.carriers) && data.carriers.length) { setDeliveryEnabled(true); setCarriers(data.carriers); setCarrier(data.carriers[0]) } else { setDeliveryEnabled(false) } } else setErrors(data.error?.messages ?? ['Оформление временно недоступно']) }).catch(() => setErrors(['Оформление временно недоступно'])) }, [])
  useEffect(() => { setConfirmedAmounts(null) }, [cart.lines])
  // Смена перевозчика сбрасывает выбор города, ПВЗ и плашку IP-гео.
  useEffect(() => { setCityInput(''); setCitySuggestions([]); setSelectedCity(null); setIpPrefillCity(null); setPickupPoints([]); setPickupPoint(null); setPointFilter(''); setWidgetFailed(false) }, [carrier?.carrier])

  async function loadPointsByCityCode(cityCode: number) {
    setErrors([]); setPickupPoints([]); setPickupPoint(null); setPointFilter('')
    try { const res = await fetch(`/api/cdek?cityCode=${cityCode}`); const data = await res.json(); if (!res.ok) throw new Error(data.error?.messages?.[0]); setPickupPoints(data.pickupPoints) }
    catch (error) { setErrors([error instanceof Error ? error.message : 'Не удалось получить пункты выдачи']) }
  }

  // fromIpPrefill=true — не сбрасываем ipPrefillCity (плашка должна остаться).
  function pickCity(c: CdekCity, fromIpPrefill = false) {
    if (!fromIpPrefill) setIpPrefillCity(null)
    setSelectedCity(c); setCityInput(cityLabel(c)); setCitySuggestions([]); loadPointsByCityCode(c.code)
  }

  // Пользователь нажал «Изменить» в плашке — сбрасываем всё и показываем поле ввода.
  function resetCity() {
    setIpPrefillCity(null); setSelectedCity(null); setCityInput(''); setPickupPoints([]); setPickupPoint(null); setCitySuggestions([])
  }

  // Префилл города по IP (СДЭК): один раз при активной доставке, пока город не выбран.
  const prefillDone = useRef(false)
  useEffect(() => {
    if (!deliveryEnabled || !isCdek || prefillDone.current) return
    prefillDone.current = true
    fetch('/api/checkout/city').then((r) => r.json()).then((data) => {
      if (data?.city) { setIpPrefillCity(data.city); pickCity(data.city, true) }
    }).catch(() => {})
  }, [deliveryEnabled, isCdek])

  // Автокомплит города СДЭК с дебаунсом. Не ищем, если ввод совпадает с уже
  // выбранным городом (после выбора из подсказки) — иначе зациклим запрос.
  useEffect(() => {
    if (!isCdek) return
    const q = cityInput.trim()
    if (selectedCity && cityInput === cityLabel(selectedCity)) { setCitySuggestions([]); return }
    if (q.length < 2) { setCitySuggestions([]); return }
    const timer = setTimeout(async () => {
      try { const res = await fetch(`/api/cdek/cities?q=${encodeURIComponent(q)}`); const data = await res.json(); if (res.ok) setCitySuggestions(Array.isArray(data.cities) ? data.cities : []) } catch { /* подсказки — необязательны */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [cityInput, isCdek, selectedCity])

  const filteredPoints = pickupPoints.filter((p) => { const f = pointFilter.trim().toLowerCase(); return !f || p.name.toLowerCase().includes(f) || p.address.toLowerCase().includes(f) })

  // Плашка «Ваш город — X» видна только в режиме списка (без виджета):
  // виджет сам отображает выбранный город.
  const showCityBanner = !useWidget && ipPrefillCity !== null && selectedCity !== null && selectedCity.code === ipPrefillCity.code

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
          // Доставку не отправляем, когда она отключена — сервер оформит заказ без ПВЗ.
          delivery: deliveryEnabled && carrier ? { method: `${carrier.carrier}_pickup`, pickupPointCode: pickupPoint?.code, expectedDeliveryKopecks: deliveryForPayment } : undefined,
          expectedTotalKopecks: totalWithDelivery,
          items: cart.lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const priceChangedAmounts = res.status === 409 && data.error?.code === 'PRICE_CHANGED' ? parsePriceChangedAmounts(data) : undefined
        if (priceChangedAmounts) {
          setConfirmedAmounts(priceChangedAmounts)
          setErrors(['Цена изменилась. Итог обновлён — повторите оплату.'])
        } else setErrors(data.errors ?? data.error?.messages ?? [data.error ?? 'Не удалось оформить заказ'])
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
                  <span>Телефон получателя</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); localStorage.setItem('mavita_checkout_phone', e.target.value) }}
                    autoComplete="tel"
                    required
                  />
                </label>

                <label className="checkout-field">
                  <span>ФИО получателя</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); localStorage.setItem('mavita_checkout_name', e.target.value) }}
                    autoComplete="name"
                    required
                  />
                </label>

                <label className="checkout-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); localStorage.setItem('mavita_checkout_email', e.target.value) }}
                    autoComplete="email"
                    required
                  />
                </label>

                {deliveryEnabled && carrier && (
                  <div className="checkout-field">
                    <span>Пункт выдачи {carrier.label} <Link href="/delivery" target="_blank" className="checkout-field-hint">условия доставки</Link></span>
                    {carriers.length > 1 && (
                      <select value={carrier.carrier} onChange={(e) => setCarrier(carriers.find((c) => c.carrier === e.target.value) ?? null)} aria-label="Способ получения">
                        {carriers.map((c) => <option key={c.carrier} value={c.carrier}>Пункт выдачи {c.label}</option>)}
                      </select>
                    )}
                    {useWidget ? (
                      <CdekWidget apiKey={yandexKey} onSelect={(point) => setPickupPoint(point)} onUnavailable={() => setWidgetFailed(true)} />
                    ) : (
                      <>
                        {showCityBanner ? (
                          <div className="checkout-city-detected">
                            <span>Ваш город — <strong>{selectedCity!.city}</strong></span>
                            <button type="button" className="checkout-city-change" onClick={resetCity}>Изменить</button>
                          </div>
                        ) : (
                          <div className="checkout-pvz-city">
                            <input type="text" value={cityInput} onChange={(e) => { setSelectedCity(null); setPickupPoints([]); setPickupPoint(null); setCityInput(e.target.value) }} placeholder="Город — начните вводить" autoComplete="off" aria-label="Город доставки" />
                            {citySuggestions.length > 0 && !selectedCity && (
                              <ul className="checkout-city-suggest">
                                {citySuggestions.map((c) => <li key={c.code}><button type="button" onClick={() => pickCity(c)}>{cityLabel(c)}</button></li>)}
                              </ul>
                            )}
                          </div>
                        )}
                        {pickupPoints.length > 8 && <input type="text" value={pointFilter} onChange={(e) => setPointFilter(e.target.value)} placeholder="Фильтр по адресу или названию" aria-label="Фильтр пунктов выдачи" />}
                        {pickupPoints.length > 0 && (
                          <select value={pickupPoint?.code ?? ''} onChange={(e) => setPickupPoint(pickupPoints.find((point) => point.code === e.target.value) ?? null)} required>
                            <option value="">Выберите пункт выдачи ({filteredPoints.length})</option>
                            {filteredPoints.map((point) => (
                              <option key={point.code} value={point.code}>
                                {point.name} · {point.address}{point.workTime ? ` · ${point.workTime}` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {selectedCity && pickupPoints.length === 0 && <p className="checkout-field-hint">В этом городе нет пунктов выдачи {carrier.label}.</p>}
                      </>
                    )}
                    {pickupPoint && (
                      <p className="checkout-pvz-selected">
                        {pickupPoint.city} · {pickupPoint.name}<br />{pickupPoint.address}
                        {pickupPoint.workTime && <><br />{pickupPoint.workTime}</>}
                      </p>
                    )}
                  </div>
                )}
                {deliveryEnabled === false && <p className="checkout-pvz-selected">Доставку согласуем с вами после оплаты.</p>}

                <label className="checkout-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                  <span>
                    Я согласен(а) с <Link href="/offer" target="_blank">публичной офертой</Link> и{' '}
                    <Link href="/privacy" target="_blank">политикой конфиденциальности</Link>, даю согласие на
                    обработку персональных данных.
                  </span>
                </label>

                <button type="submit" className="btn-add checkout-submit" disabled={submitting || deliveryEnabled === null || (!!deliveryEnabled && !pickupPoint) || !consent}>
                  {submitting ? 'Переходим к оплате…' : deliveryEnabled ? 'Оплатить заказ с доставкой' : 'Оплатить заказ'}
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
                <div className="cart-summary-row"><span>Товары</span><span>{formatRub(itemsForPayment)}</span></div>
                {deliveryEnabled && carrier && <div className="cart-summary-row"><span>Доставка {carrier.label} до ПВЗ</span><span>{deliveryForPayment === null ? '…' : formatRub(deliveryForPayment)}</span></div>}
                <div className="cart-summary-row cart-summary-total">
                  <span>К оплате</span>
                  <span>{deliveryForPayment === null ? '…' : formatRub(totalWithDelivery)}</span>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
