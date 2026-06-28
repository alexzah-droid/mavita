import { describe, expect, it } from 'vitest'
import {
  absoluteImageUrl,
  absoluteUrl,
  buildOrganizationJsonLd,
  buildPageMetadata,
  buildProductJsonLd,
  normalizeDescription,
  normalizeSiteOrigin,
} from '@/lib/seo'
import type { Product } from '@/lib/products'

const baseProduct: Product = {
  slug: 'gornaya-vershina',
  name: 'Горная вершина',
  series: 'Горы',
  subtitle: 'Ты — первооткрыватель!',
  priceKopecks: 80000,
  image: '/images/catalog/006/006-01.jpg',
  images: ['/images/catalog/006/006-01.jpg'],
  description: '  Натуральная   свеча\nдля ритуала тишины. ',
  scent: ['Пихта', 'Пачули'],
  inStock: true,
  visibility: 'public',
  sale: {
    priceKopecks: 70000,
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-07-01T00:00:00.000Z',
  },
  category: 'Свеча',
  aroma: 'Лесной воздух и хвоя',
}

describe('seo helpers', () => {
  it('нормализует origin и строит абсолютные ссылки', () => {
    expect(normalizeSiteOrigin('mavita.ru/')).toBe('https://mavita.ru')
    expect(absoluteUrl('/product/test', 'https://mavita.ru')).toBe(
      'https://mavita.ru/product/test',
    )
    expect(
      absoluteImageUrl('/images/about.jpeg', 'https://mavita.ru'),
    ).toBe('https://mavita.ru/images/about.jpeg')
  })

  it('собирает metadata с canonical и robots', () => {
    const metadata = buildPageMetadata({
      title: 'Доставка — МАВИТА',
      description: '  Доставка   в ПВЗ. ',
      path: '/delivery',
      noIndex: true,
    })
    const images = Array.isArray(metadata.openGraph?.images)
      ? metadata.openGraph.images
      : []

    expect(metadata.description).toBe('Доставка в ПВЗ.')
    expect(metadata.alternates?.canonical).toBe('https://mavita.ru/delivery')
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect(images[0]).toMatchObject({
      url: 'https://mavita.ru/images/about.jpeg',
    })
  })

  it('собирает Organization JSON-LD', () => {
    const jsonLd = buildOrganizationJsonLd()

    expect(jsonLd['@type']).toBe('Organization')
    expect(jsonLd.url).toBe('https://mavita.ru')
    expect(jsonLd.sameAs).toContain('https://vk.com/mavitasvechi')
  })

  it('собирает Product JSON-LD с актуальной ценой и availability', () => {
    const jsonLd = buildProductJsonLd(baseProduct)

    expect(jsonLd['@type']).toBe('Product')
    expect(jsonLd.url).toBe('https://mavita.ru/product/gornaya-vershina')
    expect(jsonLd.image).toEqual([
      'https://mavita.ru/images/catalog/006/006-01.jpg',
    ])
    expect(jsonLd.offers.price).toBe('700.00')
    expect(jsonLd.offers.availability).toBe('https://schema.org/InStock')
    expect(jsonLd.additionalProperty).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Серия', value: 'Горы' }),
        expect.objectContaining({ name: 'Аромат', value: 'Лесной воздух и хвоя' }),
      ]),
    )
  })

  it('сжимает лишние пробелы в описании', () => {
    expect(normalizeDescription('  Один \n два   три  ')).toBe('Один два три')
  })
})
