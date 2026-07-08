import { describe, it, expect } from 'vitest'
import {
  mapRowToProduct,
  SEED_PRODUCTS,
  seedSlugs,
  getSeedProduct,
  type ProductRow,
} from '@/lib/products'

function row(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    slug: 'test',
    name: 'Тестовая свеча',
    series: 'Горы',
    subtitle: 'Подзаголовок',
    description: 'Описание',
    price_kopecks: 180000,
    scent: ['Пихта'],
    in_stock: true,
    cover: '/images/2.jpeg',
    images: ['/images/2.jpeg', '/images/3.jpeg'],
    ...overrides,
  }
}

describe('mapRowToProduct', () => {
  it('маппит полную строку БД в Product', () => {
    const p = mapRowToProduct(row({ wax_weight: '120 г' }))
    expect(p.slug).toBe('test')
    expect(p.priceKopecks).toBe(180000)
    expect(p.image).toBe('/images/2.jpeg')
    expect(p.images).toEqual(['/images/2.jpeg', '/images/3.jpeg'])
    expect(p.inStock).toBe(true)
    expect(p.waxWeight).toBe('120 г')
  })

  it('приводит price_kopecks из строки к числу (pg INTEGER)', () => {
    const p = mapRowToProduct(row({ price_kopecks: '90000' }))
    expect(p.priceKopecks).toBe(90000)
    expect(Number.isInteger(p.priceKopecks)).toBe(true)
  })

  it('берёт обложку из первого фото, если cover пуст', () => {
    const p = mapRowToProduct(row({ cover: null, images: ['/images/9.jpeg'] }))
    expect(p.image).toBe('/images/9.jpeg')
  })

  it('подставляет cover в images, если список фото пуст', () => {
    const p = mapRowToProduct(row({ cover: '/images/4.jpeg', images: [] }))
    expect(p.images).toEqual(['/images/4.jpeg'])
  })

  it('терпимо относится к null-полям', () => {
    const p = mapRowToProduct(
      row({ series: null, subtitle: null, description: null, scent: null }),
    )
    expect(p.series).toBe('')
    expect(p.subtitle).toBe('')
    expect(p.description).toBe('')
    expect(p.scent).toEqual([])
  })
})

describe('seed-каталог', () => {
  it('все цены — целые копейки (I2)', () => {
    for (const p of SEED_PRODUCTS) {
      expect(Number.isInteger(p.priceKopecks)).toBe(true)
      expect(p.priceKopecks).toBeGreaterThan(0)
    }
  })

  it('slug-и уникальны', () => {
    const slugs = seedSlugs()
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('getSeedProduct находит товар и возвращает undefined для неизвестного', () => {
    expect(getSeedProduct(SEED_PRODUCTS[0].slug)?.slug).toBe(SEED_PRODUCTS[0].slug)
    expect(getSeedProduct('нет-такого')).toBeUndefined()
  })

  it('содержит известный вес чистого воска контейнерных свечей', () => {
    const waxWeights = SEED_PRODUCTS.slice(0, 4).map((product) => product.waxWeight)
    expect(waxWeights).toEqual([
      'верхняя часть — 25 г, нижняя часть — 85 г',
      '120 г',
      '90 г',
      '120 г',
    ])
  })
})
