'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Product } from '@/lib/products'
import {
  addItem,
  removeItem,
  setQuantity,
  clearCart,
  cartCount,
  cartTotalKopecks,
  EMPTY_CART,
  type Cart,
} from '@/lib/cart'

const STORAGE_KEY = 'mavita.cart.v1'

type CartContextValue = {
  cart: Cart
  ready: boolean // true после гидрации из localStorage — чтобы счётчик не «прыгал»
  count: number
  totalKopecks: number
  add: (product: Product, qty?: number) => void
  remove: (slug: string) => void
  setQty: (slug: string, qty: number) => void
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function loadCart(): Cart {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_CART
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY_CART
    return parsed as Cart
  } catch {
    return EMPTY_CART
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [ready, setReady] = useState(false)

  // Гидрация из localStorage только на клиенте после монтирования.
  useEffect(() => {
    setCart(loadCart())
    setReady(true)
  }, [])

  // Персист в localStorage при изменении (после готовности).
  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
    } catch {
      /* приватный режим / переполнение — игнорируем */
    }
  }, [cart, ready])

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      ready,
      count: cartCount(cart),
      totalKopecks: cartTotalKopecks(cart),
      add: (product, qty = 1) => setCart((c) => addItem(c, product, qty)),
      remove: (slug) => setCart((c) => removeItem(c, slug)),
      setQty: (slug, qty) => setCart((c) => setQuantity(c, slug, qty)),
      clear: () => setCart(clearCart()),
    }),
    [cart, ready],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
