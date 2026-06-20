import { describe, expect, it } from 'vitest'
import { effectivePrice } from '@/lib/pricing'
const now = new Date('2026-06-20T12:00:00.000Z')
const base = { priceKopecks: 10000, salePriceKopecks: 8000, saleStartsAt: null, saleEndsAt: null }
describe('effectivePrice', () => {
  it('применяет бессрочную скидку', () => expect(effectivePrice(base, now)).toMatchObject({ kopecks: 8000, isOnSale: true }))
  it('соблюдает границы окна >= начала и < конца', () => {
    expect(effectivePrice({ ...base, saleStartsAt: now.toISOString(), saleEndsAt: '2026-06-20T12:00:01.000Z' }, now).isOnSale).toBe(true)
    expect(effectivePrice({ ...base, saleEndsAt: now.toISOString() }, now).isOnSale).toBe(false)
  })
  it('не показывает невалидную скидку', () => expect(effectivePrice({ ...base, salePriceKopecks: 10000 }, now)).toMatchObject({ kopecks: 10000, isOnSale: false }))
})
