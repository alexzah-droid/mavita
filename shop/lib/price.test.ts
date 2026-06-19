import { describe, it, expect } from 'vitest'
import {
  kopecksToRubles,
  rublesToKopecks,
  formatRub,
  formatRubAmount,
} from '@/lib/price'

// Нормализуем разные виды пробелов-разделителей (U+00A0 / U+202F), которые
// toLocaleString('ru-RU') использует для разрядов, в обычный пробел.
const norm = (s: string) => s.replace(/[  \s]/g, ' ')

describe('price — инвариант I2 (копейки)', () => {
  it('рубли → копейки без потери точности', () => {
    expect(rublesToKopecks(1800)).toBe(180000)
    expect(rublesToKopecks(0.1)).toBe(10)
    expect(rublesToKopecks(19.99)).toBe(1999)
  })

  it('рубли → копейки округляет дробные копейки до целого', () => {
    expect(rublesToKopecks(19.999)).toBe(2000) // 1999.9 → 2000
    expect(rublesToKopecks(2.5)).toBe(250)
    expect(Number.isInteger(rublesToKopecks(33.33))).toBe(true)
  })

  it('копейки → рубли', () => {
    expect(kopecksToRubles(180000)).toBe(1800)
    expect(kopecksToRubles(90000)).toBe(900)
  })

  it('round-trip: rublesToKopecks → kopecksToRubles', () => {
    expect(kopecksToRubles(rublesToKopecks(2000))).toBe(2000)
  })
})

describe('formatRubAmount / formatRub', () => {
  it('форматирует целые рубли без дробной части', () => {
    expect(norm(formatRubAmount(180000))).toBe('1 800')
    expect(norm(formatRubAmount(90000))).toBe('900')
  })

  it('показывает копейки только когда они есть', () => {
    expect(norm(formatRubAmount(180050))).toBe('1 800,50')
  })

  it('formatRub добавляет символ рубля', () => {
    expect(norm(formatRub(180000))).toBe('1 800 ₽')
    expect(formatRub(90000).endsWith('₽')).toBe(true)
  })
})
