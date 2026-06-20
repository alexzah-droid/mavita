import { describe, expect, it } from 'vitest'
import { cursorEncode, maskPhone, parseAdminOrderFilters, parseCancelBody, parseFulfillmentBody } from '@/lib/admin-orders'
describe('admin orders validation', () => {
  it('validates keyset filter and a stable cursor', () => { const cursor = cursorEncode({ createdAt: '2026-06-20T10:00:00.000Z', id: 4 }); const parsed = parseAdminOrderFilters(new URLSearchParams({ status: 'paid', q: '79991234567', cursor, limit: '100' })); expect(parsed.errors).toEqual([]); expect(parsed.value?.cursor?.id).toBe(4); expect(parseAdminOrderFilters(new URLSearchParams({ cursor: 'wrong' })).errors).not.toEqual([]) })
  it('masks only normalizable phones', () => { expect(maskPhone('+7 999 123-45-67')).toBe('+7 ••• •••-45-67'); expect(maskPhone('abc')).toBeNull(); expect(maskPhone(null)).toBeNull() })
  it('requires an audit reason and exact fulfillment payloads', () => { expect(parseCancelBody({ reason: '  Нет товара  ' }).value?.reason).toBe('Нет товара'); expect(parseCancelBody({ reason: 'нет' }).value).toBeUndefined(); expect(parseFulfillmentBody({ status: 'handed_to_carrier', trackingNumber: '12345' }).value?.trackingNumber).toBe('12345'); expect(parseFulfillmentBody({ status: 'handed_to_carrier' }).value).toBeUndefined(); expect(parseFulfillmentBody({ status: 'paid' }).value).toBeUndefined() })
})
