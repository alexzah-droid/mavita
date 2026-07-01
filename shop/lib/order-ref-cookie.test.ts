import { describe, expect, it } from 'vitest'
import { orderRefValue, parseOrderRef } from '@/lib/order-ref-cookie'

describe('order-ref cookie', () => {
  it('round-trip значения invId:token', () => {
    const token = '2b1f8c9e-7d54-4c19-9a70-1c2d3e4f5a6b'
    expect(parseOrderRef(orderRefValue(42, token))).toEqual({ invId: 42, token })
  })

  it('мусор и неполные значения → null', () => {
    expect(parseOrderRef(undefined)).toBeNull()
    expect(parseOrderRef('')).toBeNull()
    expect(parseOrderRef('no-colon')).toBeNull()
    expect(parseOrderRef(':token-without-id')).toBeNull()
    expect(parseOrderRef('0:token')).toBeNull()
    expect(parseOrderRef('-5:token')).toBeNull()
    expect(parseOrderRef('12:')).toBeNull()
    expect(parseOrderRef('abc:token')).toBeNull()
  })
})
