// Единый, чистый расчёт цены. Используется и витриной, и оформлением заказа.
export type SaleFields = {
  priceKopecks: number
  salePriceKopecks: number | null
  saleStartsAt: string | null
  saleEndsAt: string | null
}

export type EffectivePrice = {
  kopecks: number
  regularKopecks: number
  isOnSale: boolean
  endsAt: string | null
}

function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function effectivePrice(p: SaleFields, now: Date): EffectivePrice {
  const regular: EffectivePrice = {
    kopecks: p.priceKopecks,
    regularKopecks: p.priceKopecks,
    isOnSale: false,
    endsAt: null,
  }
  if (!validPrice(p.priceKopecks) || !validPrice(p.salePriceKopecks) || p.salePriceKopecks >= p.priceKopecks) {
    return regular
  }
  const startsAt = parseDate(p.saleStartsAt)
  const endsAt = parseDate(p.saleEndsAt)
  if ((p.saleStartsAt && !startsAt) || (p.saleEndsAt && !endsAt)) return regular
  if (startsAt && endsAt && endsAt <= startsAt) return regular
  if (startsAt && now < startsAt) return regular
  if (endsAt && now >= endsAt) return regular
  return {
    kopecks: p.salePriceKopecks,
    regularKopecks: p.priceKopecks,
    isOnSale: true,
    endsAt: p.saleEndsAt,
  }
}
