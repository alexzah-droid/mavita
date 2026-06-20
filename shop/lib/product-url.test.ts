import { describe, expect, it } from 'vitest'
import { isAccessibleByLink, moveInOrder, productPath, productUrl } from '@/lib/product-url'

describe('productPath / productUrl', () => {
  it('builds the storefront path from a slug', () => {
    expect(productPath('amber-night')).toBe('/product/amber-night')
  })
  it('joins origin and path without doubling the slash', () => {
    expect(productUrl('amber-night', 'https://mavita.ru')).toBe('https://mavita.ru/product/amber-night')
    expect(productUrl('amber-night', 'https://mavita.ru/')).toBe('https://mavita.ru/product/amber-night')
  })
})

describe('isAccessibleByLink', () => {
  it('public and unlisted open by direct link, hidden does not', () => {
    expect(isAccessibleByLink('public')).toBe(true)
    expect(isAccessibleByLink('unlisted')).toBe(true)
    expect(isAccessibleByLink('hidden')).toBe(false)
  })
})

describe('moveInOrder', () => {
  it('moves an item forward and backward', () => {
    expect(moveInOrder([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveInOrder([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3])
  })
  it('returns an equal copy for no-op or out-of-range indexes', () => {
    expect(moveInOrder([1, 2, 3], 1, 1)).toEqual([1, 2, 3])
    expect(moveInOrder([1, 2, 3], -1, 2)).toEqual([1, 2, 3])
    expect(moveInOrder([1, 2, 3], 0, 9)).toEqual([1, 2, 3])
  })
  it('does not mutate the input', () => {
    const input = [1, 2, 3]
    moveInOrder(input, 0, 2)
    expect(input).toEqual([1, 2, 3])
  })
})
