'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export type CartToastData = { name: string; nonce: number }

// Плашка «добавлено в корзину» с прямым путём к оформлению — рендерится внутри
// CartProvider на всех страницах витрины. nonce меняется на каждое добавление,
// чтобы таймер автоскрытия перезапускался даже для того же товара.
export default function CartToast({
  toast,
  onDismiss,
}: {
  toast: CartToastData | null
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(onDismiss, 6000)
    return () => window.clearTimeout(timer)
  }, [toast?.nonce])

  if (!toast) return null

  return (
    <div className="cart-toast" role="status" aria-live="polite">
      <div className="cart-toast-text">
        <span className="cart-toast-check">✓</span> «{toast.name}» — в корзине
      </div>
      <div className="cart-toast-actions">
        <Link href="/checkout" className="cart-toast-checkout" onClick={onDismiss}>
          Оформить заказ
        </Link>
        <button type="button" className="cart-toast-continue" onClick={onDismiss}>
          Продолжить покупки
        </button>
      </div>
    </div>
  )
}
