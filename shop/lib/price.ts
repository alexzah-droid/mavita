// Работа с ценами. Инвариант I2: канонический формат — КОПЕЙКИ (целое число).
// Рубли используются только для отображения и ввода, в БД/корзину/заказ идут копейки.

/** Копейки → рубли (может быть дробным, например 1800.50). Для отображения/конвертации. */
export function kopecksToRubles(kopecks: number): number {
  return kopecks / 100
}

/** Рубли → копейки. Округляет до целой копейки, чтобы исключить float-хвосты. */
export function rublesToKopecks(rubles: number): number {
  return Math.round(rubles * 100)
}

/**
 * Форматирует копейки как число рублей без символа: «1 800».
 * Дробные копейки показываются только если они есть.
 */
export function formatRubAmount(kopecks: number): string {
  const rubles = kopecksToRubles(kopecks)
  const hasFraction = kopecks % 100 !== 0
  return rubles.toLocaleString('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

/** Форматирует копейки как сумму в рублях с символом: «1 800 ₽». */
export function formatRub(kopecks: number): string {
  return `${formatRubAmount(kopecks)} ₽`
}
