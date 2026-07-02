import { describe, expect, it } from 'vitest'
import { validateProductInput } from '@/lib/products-admin'
const product = { name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }
describe('validateProductInput', () => {
  it('создаёт скрытый товар без необязательной скидки', () => expect(validateProductInput(product, 'create').value).toMatchObject(product))
  it('различает отсутствие скидки и sale:null', () => { expect(validateProductInput(product, 'create').value?.sale).toBeUndefined(); expect(validateProductInput({ ...product, sale: null }, 'create').value?.sale).toBeNull() })
  it('отвергает неверный slug и цену скидки', () => { expect(validateProductInput({ ...product, slug: 'Кириллица' }, 'create').errors).not.toHaveLength(0); expect(validateProductInput({ ...product, sale: { priceKopecks: 10000, startsAt: null, endsAt: null } }, 'create').errors).not.toHaveLength(0) })
  it('принимает строгий RFC 3339 с offset и точностью до минуты', () => {
    expect(validateProductInput({ ...product, sale: { priceKopecks: 5000, startsAt: '2026-06-21T15:00:00.000Z', endsAt: '2026-06-21T19:00:00+03:00' } }, 'create').errors).toHaveLength(0)
  })
  it('отвергает дату без offset, date-only и с ненулевыми секундами', () => {
    for (const startsAt of ['2026-06-21T15:00:00', '2026-06-21', '2026-06-21T15:00:30.000Z', '2026/06/21 15:00 GMT'])
      expect(validateProductInput({ ...product, sale: { priceKopecks: 5000, startsAt, endsAt: null } }, 'create').errors).not.toHaveLength(0)
  })
  it('отвергает несуществующие календарные даты, а не нормализует их', () => {
    // regex пропускает, но new Date молча даёт 2026-03-02 / 2026-05-01.
    for (const startsAt of ['2026-02-30T12:00:00Z', '2026-04-31T12:00:00Z', '2025-02-29T12:00:00Z', '2026-13-01T12:00:00Z', '2026-06-21T15:00:00+25:00'])
      expect(validateProductInput({ ...product, sale: { priceKopecks: 5000, startsAt, endsAt: null } }, 'create').errors).not.toHaveLength(0)
  })
  it('принимает 29 февраля високосного года', () => {
    expect(validateProductInput({ ...product, sale: { priceKopecks: 5000, startsAt: '2024-02-29T12:00:00Z', endsAt: null } }, 'create').errors).toHaveLength(0)
  })
  it('принимает валидные вес и габариты коробки товара', () => {
    expect(validateProductInput({ ...product, weightGrams: 500, boxLengthCm: 11, boxWidthCm: 12, boxHeightCm: 13 }, 'create').value)
      .toMatchObject({ weightGrams: 500, boxLengthCm: 11, boxWidthCm: 12, boxHeightCm: 13 })
  })
  it('отвергает невалидные габариты коробки', () => {
    expect(validateProductInput({ ...product, boxLengthCm: 0 }, 'create').errors).not.toHaveLength(0)
    expect(validateProductInput({ ...product, boxWidthCm: -1 }, 'create').errors).not.toHaveLength(0)
    expect(validateProductInput({ ...product, boxHeightCm: 1.5 }, 'create').errors).not.toHaveLength(0)
  })
  it('принимает публичные характеристики свечи и различает null/отсутствие', () => {
    expect(validateProductInput({ ...product, burnTimeHours: 40, wax: ' 100% соевый воск ', wick: 'Хлопковый' }, 'create').value)
      .toMatchObject({ burnTimeHours: 40, wax: '100% соевый воск', wick: 'Хлопковый' })
    expect(validateProductInput({ ...product, burnTimeHours: null, wax: null, wick: null }, 'create').value)
      .toMatchObject({ burnTimeHours: null, wax: null, wick: null })
    expect(validateProductInput(product, 'create').value?.burnTimeHours).toBeUndefined()
  })
  it('отвергает невалидные характеристики свечи', () => {
    expect(validateProductInput({ ...product, burnTimeHours: 0 }, 'create').errors).not.toHaveLength(0)
    expect(validateProductInput({ ...product, burnTimeHours: 2.5 }, 'create').errors).not.toHaveLength(0)
    expect(validateProductInput({ ...product, wax: 'x'.repeat(201) }, 'create').errors).not.toHaveLength(0)
    expect(validateProductInput({ ...product, wick: 'x'.repeat(201) }, 'create').errors).not.toHaveLength(0)
  })
})
