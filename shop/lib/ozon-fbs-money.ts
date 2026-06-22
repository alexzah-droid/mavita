// Денежный формат для Ozon import: цена передаётся СТРОКОЙ в рублях с двумя
// знаками («900.00»). Инвариант I2 проекта — цены в копейках (INTEGER). Конвертация
// делается ЦЕЛОЧИСЛЕННОЙ арифметикой, без float: рубли = kopecks / 100 целочисленно,
// копейки = kopecks % 100. Это исключает «900.00000001» от float-деления.
import { effectivePrice, type SaleFields } from '@/lib/pricing'

/** Копейки → строка рублей с РОВНО двумя знаками, без float. 90000 → "900.00". */
export function kopecksToOzonPrice(kopecks: number): string {
  if (!Number.isInteger(kopecks) || kopecks < 0) throw new Error('Цена должна быть целым числом копеек ≥ 0')
  const rubles = Math.floor(kopecks / 100)
  const cents = kopecks % 100
  return `${rubles}.${String(cents).padStart(2, '0')}`
}

/**
 * Эффективная цена сайта (активная цена по акции либо обычная) в формате Ozon.
 * Источник правды — БД МАВИТА; в Ozon уходит ровно то, что покупатель видит на сайте.
 */
export function effectiveOzonPrice(sale: SaleFields, now = new Date()): string {
  return kopecksToOzonPrice(effectivePrice(sale, now).kopecks)
}
