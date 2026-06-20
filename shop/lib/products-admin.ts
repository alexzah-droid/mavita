import type { Visibility } from '@/lib/products'

export type SaleInput = { priceKopecks: number; startsAt: string | null; endsAt: string | null } | null
export type ProductInput = {
  name?: unknown; slug?: unknown; series?: unknown; subtitle?: unknown; description?: unknown
  priceKopecks?: unknown; scent?: unknown; inStock?: unknown; visibility?: unknown; sale?: unknown
}
export type ValidatedProductInput = {
  name?: string; slug?: string; series?: string | null; subtitle?: string | null; description?: string | null
  priceKopecks?: number; scent?: string[]; inStock?: boolean; visibility?: Visibility; sale?: SaleInput
}

const SLUG_RE = /^[a-z0-9-]{1,100}$/
const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'hidden']

function optionalText(value: unknown, label: string, max: number, errors: string[]): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || value.length > max) { errors.push(`${label} — не более ${max} символов`); return undefined }
  return value.trim() || null
}
function parseDate(value: unknown, label: string, errors: string[]): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) { errors.push(`${label} должен быть датой RFC 3339`); return null }
  return new Date(value).toISOString()
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
