import { describe, it, expect } from 'vitest'
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
import type { Product } from '@/lib/products'

function product(over: Partial<Product> = {}): Product {
  return {
    slug: 'kvadratnaya',
    name: 'Квадратная',
    series: 'Горы',
    subtitle: '',
    priceKopecks: 180000,
    image: '/images/2.jpeg',
    images: ['/images/2.jpeg'],
    description: '',
    scent: [],
    inStock: true,
    visibility: 'public',
    sale: null,
    ...over,
  }
}

describe('addItem', () => {
  it('добавляет новую позицию в пустую корзину', () => {
    const c = addItem(EMPTY_CART, product())
    expect(c.lines).toHaveLength(1)
    expect(c.lines[0].slug).toBe('kvadratnaya')
    expect(c.lines[0].quantity).toBe(1)
  })

  it('сливает дубли — увеличивает количество', () => {
    let c = addItem(EMPTY_CART, product())
    c = addItem(c, product())
    expect(c.lines).toHaveLength(1)
    expect(c.lines[0].quantity).toBe(2)
  })

  it('держит разные товары отдельными позициями', () => {
    let c = addItem(EMPTY_CART, product({ slug: 'a' }))
    c = addItem(c, product({ slug: 'b' }))
    expect(c.lines).toHaveLength(2)
  })

  it('уважает переданное количество', () => {
    const c = addItem(EMPTY_CART, product(), 3)
    expect(c.lines[0].quantity).toBe(3)
  })

  it('не мутирует исходную корзину', () => {
    const before = EMPTY_CART
    const after = addItem(before, product())
    expect(before.lines).toHaveLength(0)
    expect(after).not.toBe(before)
  })

  it('сохраняет цену в копейках (snapshot для I2)', () => {
    const c = addItem(EMPTY_CART, product({ priceKopecks: 90000 }))
    expect(c.lines[0].priceKopecks).toBe(90000)
  })
})

describe('removeItem / setQuantity', () => {
  it('удаляет позицию по slug', () => {
    let c = addItem(EMPTY_CART, product({ slug: 'a' }))
    c = addItem(c, product({ slug: 'b' }))
    c = removeItem(c, 'a')
    expect(c.lines.map((l) => l.slug)).toEqual(['b'])
  })

  it('setQuantity меняет количество', () => {
    let c = addItem(EMPTY_CART, product())
    c = setQuantity(c, 'kvadratnaya', 5)
    expect(c.lines[0].quantity).toBe(5)
  })

  it('setQuantity <= 0 удаляет позицию', () => {
    let c = addItem(EMPTY_CART, product())
    c = setQuantity(c, 'kvadratnaya', 0)
    expect(c.lines).toHaveLength(0)
  })

  it('количество ограничено сверху (clamp 99)', () => {
    let c = addItem(EMPTY_CART, product())
    c = setQuantity(c, 'kvadratnaya', 9999)
    expect(c.lines[0].quantity).toBe(99)
  })
})

describe('итоги', () => {
  const filled: Cart = {
    lines: [
      { slug: 'a', name: 'A', priceKopecks: 180000, image: '', quantity: 2 },
      { slug: 'b', name: 'B', priceKopecks: 90000, image: '', quantity: 1 },
    ],
  }

  it('cartCount суммирует количества', () => {
    expect(cartCount(filled)).toBe(3)
    expect(cartCount(EMPTY_CART)).toBe(0)
  })

  it('cartTotalKopecks считает сумму в копейках', () => {
    expect(cartTotalKopecks(filled)).toBe(180000 * 2 + 90000)
    expect(cartTotalKopecks(EMPTY_CART)).toBe(0)
  })

  it('clearCart возвращает пустую корзину', () => {
    expect(clearCart().lines).toHaveLength(0)
  })
})
