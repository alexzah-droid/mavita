import { describe, expect, it } from 'vitest'
import { validateProductInput } from '@/lib/products-admin'
const product = { name: 'Свеча', slug: 'svecha', priceKopecks: 10000 }
describe('validateProductInput', () => {
  it('создаёт скрытый товар без необязательной скидки', () => expect(validateProductInput(product, 'create').value).toMatchObject(product))
  it('различает отсутствие скидки и sale:null', () => { expect(validateProductInput(product, 'create').value?.sale).toBeUndefined(); expect(validateProductInput({ ...product, sale: null }, 'create').value?.sale).toBeNull() })
  it('отвергает неверный slug и цену скидки', () => { expect(validateProductInput({ ...product, slug: 'Кириллица' }, 'create').errors).not.toHaveLength(0); expect(validateProductInput({ ...product, sale: { priceKopecks: 10000, startsAt: null, endsAt: null } }, 'create').errors).not.toHaveLength(0) })
})
