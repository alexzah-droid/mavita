import type { Visibility } from '@/lib/products'

export type SaleInput = { priceKopecks: number; startsAt: string | null; endsAt: string | null } | null
export type ProductInput = {
  name?: unknown; slug?: unknown; series?: unknown; subtitle?: unknown; description?: unknown
  priceKopecks?: unknown; scent?: unknown; inStock?: unknown; visibility?: unknown; sale?: unknown
  weightGrams?: unknown
}
export type ValidatedProductInput = {
  name?: string; slug?: string; series?: string | null; subtitle?: string | null; description?: string | null
  priceKopecks?: number; scent?: string[]; inStock?: boolean; visibility?: Visibility; sale?: SaleInput
  weightGrams?: number | null
}

const SLUG_RE = /^[a-z0-9-]{1,100}$/
const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'hidden']

function optionalText(value: unknown, label: string, max: number, errors: string[]): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || value.length > max) { errors.push(`${label} — не более ${max} символов`); return undefined }
  return value.trim() || null
}
// Строгий RFC 3339 с обязательным часовым поясом (Z или ±HH:MM) и точностью до
// минуты: секунды только `00`, миллисекунды только `000`. Контракт поля
// datetime-local минутный (см. docs/specs/admin-products-hardening.md §«Точность
// и DST»), поэтому строка без offset, date-only и значение с ненулевыми
// секундами/мс отклоняются, а не нормализуются молча.
const RFC3339_MINUTE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(?:\.000)?(Z|[+-]\d{2}:\d{2})$/
// Календарная валидность компонентов: regex пропускает 2026-02-30, а `new Date`
// молча нормализует его в 2026-03-02. Проверяем длину месяца (с високосным годом)
// и диапазоны явно ДО toISOString(); смещение проверяется отдельно (00–23 ч, 00–59 м).
function isValidCalendar(y: number, mo: number, d: number, h: number, mi: number): boolean {
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || d < 1) return false
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= daysInMonth[mo - 1]
}
function isValidOffset(offset: string): boolean {
  if (offset === 'Z') return true
  const [oh, om] = [Number(offset.slice(1, 3)), Number(offset.slice(4, 6))]
  return oh <= 23 && om <= 59
}
function parseDate(value: unknown, label: string, errors: string[]): string | null {
  if (value === null) return null
  const match = typeof value === 'string' ? RFC3339_MINUTE_RE.exec(value) : null
  if (!match || !isValidCalendar(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])) || !isValidOffset(match[6]) || Number.isNaN(new Date(value as string).getTime())) {
    errors.push(`${label} — RFC 3339 с часовым поясом и точностью до минуты`); return null
  }
  return new Date(value as string).toISOString()
}

/** Валидирует create или частичный PATCH. `sale` обрабатывается атомарно. */
export function validateProductInput(input: unknown, mode: 'create' | 'patch'): { value?: ValidatedProductInput; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['Некорректное тело запроса'] }
  const raw = input as ProductInput
  const value: ValidatedProductInput = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 200) errors.push('Название обязательно и не длиннее 200 символов')
    else value.name = raw.name.trim()
  } else if (mode === 'create') errors.push('Укажите название')
  if (raw.slug !== undefined) {
    if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) errors.push('Slug: строчные латинские буквы, цифры и дефисы (до 100)')
    else value.slug = raw.slug
  } else if (mode === 'create') errors.push('Укажите slug')
  if (raw.priceKopecks !== undefined) {
    if (!Number.isInteger(raw.priceKopecks) || (raw.priceKopecks as number) < 0) errors.push('Цена должна быть целым числом копеек не меньше 0')
    else value.priceKopecks = raw.priceKopecks as number
  } else if (mode === 'create') errors.push('Укажите цену')
  value.series = optionalText(raw.series, 'Серия', 200, errors)
  value.subtitle = optionalText(raw.subtitle, 'Подзаголовок', 200, errors)
  value.description = optionalText(raw.description, 'Описание', 10_000, errors)
  if (raw.inStock !== undefined) {
    if (typeof raw.inStock !== 'boolean') errors.push('Наличие должно быть boolean')
    else value.inStock = raw.inStock
  }
  if (raw.visibility !== undefined) {
    if (!VISIBILITIES.includes(raw.visibility as Visibility)) errors.push('Некорректная видимость')
    else value.visibility = raw.visibility as Visibility
  }
  if (raw.scent !== undefined) {
    if (!Array.isArray(raw.scent) || raw.scent.length > 20 || raw.scent.some((x) => typeof x !== 'string' || !x.trim() || x.trim().length > 80)) errors.push('Ароматы: до 20 непустых тегов по 80 символов')
    else value.scent = raw.scent.map((x) => (x as string).trim())
  }
  if (raw.weightGrams !== undefined) {
    if (raw.weightGrams === null) value.weightGrams = null
    else if (!Number.isInteger(raw.weightGrams) || (raw.weightGrams as number) <= 0) errors.push('Вес должен быть положительным целым числом граммов')
    else value.weightGrams = raw.weightGrams as number
  }
  if (raw.sale !== undefined) {
    if (raw.sale === null) value.sale = null
    else if (!raw.sale || typeof raw.sale !== 'object' || Array.isArray(raw.sale)) errors.push('Скидка должна быть объектом или null')
    else {
      const sale = raw.sale as Record<string, unknown>
      if (!Number.isInteger(sale.priceKopecks) || (sale.priceKopecks as number) < 0) errors.push('Цена скидки должна быть целым числом копеек')
      const startsAt = parseDate(sale.startsAt, 'Начало скидки', errors)
      const endsAt = parseDate(sale.endsAt, 'Окончание скидки', errors)
      const base = value.priceKopecks
      if (base !== undefined && Number.isInteger(sale.priceKopecks) && (sale.priceKopecks as number) >= base) errors.push('Цена скидки должна быть ниже обычной')
      if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.push('Окончание скидки должно быть позже начала')
      if (!errors.length && Number.isInteger(sale.priceKopecks)) value.sale = { priceKopecks: sale.priceKopecks as number, startsAt, endsAt }
    }
  }
  return errors.length ? { errors } : { value, errors }
}
