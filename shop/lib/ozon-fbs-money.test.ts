import { describe, expect, it } from 'vitest'
import { effectiveOzonPrice, kopecksToOzonPrice } from '@/lib/ozon-fbs-money'

describe('kopecksToOzonPrice', () => {
  it('целые рубли → две десятичных нуля', () => {
    expect(kopecksToOzonPrice(90000)).toBe('900.00')
    expect(kopecksToOzonPrice(0)).toBe('0.00')
    expect(kopecksToOzonPrice(100)).toBe('1.00')
  })
  it('дробные копейки сохраняются точно (без float-хвостов)', () => {
    expect(kopecksToOzonPrice(180050)).toBe('1800.50')
    expect(kopecksToOzonPrice(1)).toBe('0.01')
    expect(kopecksToOzonPrice(99)).toBe('0.99')
    expect(kopecksToOzonPrice(1234567)).toBe('12345.67')
  })
  it('копейки-однозначные дополняются нулём слева', () => {
    expect(kopecksToOzonPrice(90005)).toBe('900.05')
  })
  it('крупная сумма не теряет точность', () => {
    expect(kopecksToOzonPrice(2_000_000_00 + 33)).toBe('2000000.33')
  })
  it('отрицательное/дробное число копеек отклоняется', () => {
    expect(() => kopecksToOzonPrice(-1)).toThrow()
    expect(() => kopecksToOzonPrice(10.5)).toThrow()
  })
})

describe('effectiveOzonPrice', () => {
  const now = new Date('2026-06-22T12:00:00Z')
  it('без активной скидки → обычная цена', () => {
    expect(effectiveOzonPrice({ priceKopecks: 90000, salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null }, now)).toBe('900.00')
  })
  it('активная скидка → цена скидки', () => {
    expect(effectiveOzonPrice({ priceKopecks: 90000, salePriceKopecks: 75000, saleStartsAt: '2026-06-20T00:00:00Z', saleEndsAt: '2026-06-30T00:00:00Z' }, now)).toBe('750.00')
  })
  it('просроченная скидка → обычная цена', () => {
    expect(effectiveOzonPrice({ priceKopecks: 90000, salePriceKopecks: 75000, saleStartsAt: '2026-06-01T00:00:00Z', saleEndsAt: '2026-06-10T00:00:00Z' }, now)).toBe('900.00')
  })
})
