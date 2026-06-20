export type CheckoutAmounts = { itemsKopecks: number; deliveryKopecks: number; totalKopecks: number }

/** Accept only a self-consistent server snapshot from a PRICE_CHANGED response. */
export function parsePriceChangedAmounts(value: unknown): CheckoutAmounts | undefined {
  if (!value || typeof value !== 'object') return undefined
  const data = value as Record<string, unknown>
  const itemsKopecks = data.itemsKopecks; const deliveryKopecks = data.deliveryKopecks; const totalKopecks = data.totalKopecks
  if (typeof itemsKopecks !== 'number' || typeof deliveryKopecks !== 'number' || typeof totalKopecks !== 'number') return undefined
  if (![itemsKopecks, deliveryKopecks, totalKopecks].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) return undefined
  return totalKopecks === itemsKopecks + deliveryKopecks ? { itemsKopecks, deliveryKopecks, totalKopecks } : undefined
}
