'use client'

import { useEffect } from 'react'
import { useCart } from '@/app/cart/CartProvider'
import { trackPurchase } from '@/app/components/metrikaEvents'

// Разовые эффекты первой загрузки ОПЛАЧЕННОГО заказа: очистка корзины (товары
// куплены — до этого момента корзину не трогаем, чтобы отказ от оплаты не
// оставил покупателя с пустой корзиной) и событие purchase в Метрику.
// localStorage-ключ по id заказа защищает от повторов при перезагрузке страницы
// и от очистки НОВОЙ корзины при возврате к старому оплаченному заказу.
export default function OrderPaidEffects({
  orderId,
  revenueKopecks,
  items,
}: {
  orderId: number
  revenueKopecks: number
  items: { name: string; priceKopecks: number; quantity: number }[]
}) {
  const { clear } = useCart()

  useEffect(() => {
    const key = `mavita.order-completed.${orderId}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, new Date().toISOString())
    } catch {
      return // приватный режим — без дедупликации не рискуем задвоить purchase
    }
    clear()
    trackPurchase({ id: orderId, revenueKopecks, items })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  return null
}
