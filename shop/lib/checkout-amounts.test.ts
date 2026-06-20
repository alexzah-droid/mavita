import { describe, expect, it } from 'vitest'
import { parsePriceChangedAmounts } from '@/lib/checkout-amounts'
describe('PRICE_CHANGED checkout snapshot', () => {
  it('replaces both items and delivery totals with the authoritative server values', () => {
    expect(parsePriceChangedAmounts({ itemsKopecks: 130000, deliveryKopecks: 50000, totalKopecks: 180000 })).toEqual({ itemsKopecks: 130000, deliveryKopecks: 50000, totalKopecks: 180000 })
  })
  it('rejects malformed or inconsistent totals', () => {
    expect(parsePriceChangedAmounts({ itemsKopecks: 130000, deliveryKopecks: 50000, totalKopecks: 1 })).toBeUndefined()
    expect(parsePriceChangedAmounts({ itemsKopecks: -1, deliveryKopecks: 0, totalKopecks: -1 })).toBeUndefined()
  })
})
