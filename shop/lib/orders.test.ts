import { describe, it, expect } from 'vitest'
import {
  validateOrderInput,
  buildOrderLines,
  type OrderInput,
  type CatalogItem,
} from '@/lib/orders'

function input(over: Partial<OrderInput> = {}): OrderInput {
  return {
    customerName: 'Виктория',
    customerEmail: 'vika@example.com',
    customerPhone: '+79991234567',
    delivery: { method: 'cdek_pickup', pickupPointCode: 'MSK1', expectedDeliveryKopecks: 50000 },
    expectedTotalKopecks: 410000,
    items: [{ slug: 'kvadratnaya', quantity: 2 }],
    ...over,
  }
}

describe('validateOrderInput', () => {
  it('принимает корректный ввод', () => {
    expect(validateOrderInput(input()).ok).toBe(true)
  })

  it('требует имя', () => {
    const r = validateOrderInput(input({ customerName: '  ' }))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('ФИО'))).toBe(true)
  })

  it('требует корректный email', () => {
    expect(validateOrderInput(input({ customerEmail: 'нет' })).ok).toBe(false)
    expect(validateOrderInput(input({ customerEmail: 'a@b.ru' })).ok).toBe(true)
  })

  it('требует телефон получателя и выбранный ПВЗ', () => {
    expect(validateOrderInput(input({ customerPhone: '' })).ok).toBe(false)
    expect(validateOrderInput(input({ delivery: { method: 'cdek_pickup', pickupPointCode: '', expectedDeliveryKopecks: 50000 } })).ok).toBe(false)
  })

  it('требует непустую корзину', () => {
    const r = validateOrderInput(input({ items: [] }))
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Корзина пуста')
  })

  it('отвергает некорректное количество', () => {
    expect(validateOrderInput(input({ items: [{ slug: 'a', quantity: 0 }] })).ok).toBe(false)
    expect(validateOrderInput(input({ items: [{ slug: 'a', quantity: -1 }] })).ok).toBe(false)
    expect(validateOrderInput(input({ items: [{ slug: 'a', quantity: 1.5 }] })).ok).toBe(false)
    expect(validateOrderInput(input({ items: [{ slug: 'a', quantity: 100 }] })).ok).toBe(false)
  })
})

describe('buildOrderLines', () => {
  const catalog = new Map<string, CatalogItem>([
    ['a', { id: 1, slug: 'a', name: 'Свеча A', priceKopecks: 180000, inStock: true, visibility: 'public', salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null }],
    ['b', { id: 2, slug: 'b', name: 'Свеча B', priceKopecks: 90000, inStock: true, visibility: 'public', salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null }],
    ['off', { id: 3, slug: 'off', name: 'Снята', priceKopecks: 50000, inStock: false, visibility: 'public', salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null }],
  ])

  it('собирает позиции со snapshot названия и цены из каталога', () => {
    const { lines, totalKopecks, errors } = buildOrderLines(catalog, [
      { slug: 'a', quantity: 2 },
      { slug: 'b', quantity: 1 },
    ])
    expect(errors).toHaveLength(0)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ slug: 'a', productName: 'Свеча A', priceKopecks: 180000, quantity: 2 })
    expect(totalKopecks).toBe(180000 * 2 + 90000)
  })

  it('берёт цену из каталога, игнорируя любую клиентскую цену', () => {
    // в items нет цены — она приходит только из каталога; проверяем источник
    const { lines } = buildOrderLines(catalog, [{ slug: 'a', quantity: 1 }])
    expect(lines[0].priceKopecks).toBe(180000)
  })

  it('сообщает об отсутствующем товаре и пропускает его', () => {
    const { lines, errors } = buildOrderLines(catalog, [{ slug: 'нет', quantity: 1 }])
    expect(lines).toHaveLength(0)
    expect(errors.some((e) => e.includes('не найден'))).toBe(true)
  })

  it('сообщает о товаре не в наличии и пропускает его', () => {
    const { lines, errors } = buildOrderLines(catalog, [{ slug: 'off', quantity: 1 }])
    expect(lines).toHaveLength(0)
    expect(errors.some((e) => e.includes('нет в наличии'))).toBe(true)
  })

  it('отвергает hidden и фиксирует активную скидочную цену', () => {
    const hidden = new Map(catalog)
    hidden.set('hidden', { id: 4, slug: 'hidden', name: 'Скрыта', priceKopecks: 10000, inStock: true, visibility: 'hidden', salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null })
    expect(buildOrderLines(hidden, [{ slug: 'hidden', quantity: 1 }]).errors[0]).toContain('недоступен')
    const discounted = new Map(catalog)
    discounted.set('sale', { id: 5, slug: 'sale', name: 'Скидка', priceKopecks: 10000, inStock: true, visibility: 'public', salePriceKopecks: 7500, saleStartsAt: null, saleEndsAt: null })
    expect(buildOrderLines(discounted, [{ slug: 'sale', quantity: 1 }], new Date('2026-06-20')).lines[0].priceKopecks).toBe(7500)
  })

  it('схлопывает дубли одного slug в одну позицию (TD-10)', () => {
    const { lines, totalKopecks } = buildOrderLines(catalog, [
      { slug: 'a', quantity: 2 },
      { slug: 'b', quantity: 1 },
      { slug: 'a', quantity: 3 },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ slug: 'a', quantity: 5 })
    expect(totalKopecks).toBe(180000 * 5 + 90000)
  })
})
