import type { Metadata } from 'next'
import { effectivePrice } from '@/lib/pricing'
import { productPath } from '@/lib/product-url'
import type { Product } from '@/lib/products'

const FALLBACK_SITE_ORIGIN = 'https://mavita.ru'
const DEFAULT_OG_IMAGE_PATH = '/images/about.jpeg'
const LOGO_IMAGE_PATH = '/images/logo.png'

export const SITE_NAME = 'МАВИТА'
export const SITE_DESCRIPTION =
  'Ароматические свечи ручной работы. Ритуалы тишины, вдохновлённые природой.'

function withProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function normalizeSiteOrigin(
  value = process.env.NEXT_PUBLIC_BASE_URL ?? FALLBACK_SITE_ORIGIN,
): string {
  try {
    return new URL(withProtocol(value)).origin
  } catch {
    return FALLBACK_SITE_ORIGIN
  }
}

export function absoluteUrl(path = '/', origin = normalizeSiteOrigin()): string {
  return new URL(path.startsWith('/') ? path : `/${path}`, origin).toString()
}

export function absoluteImageUrl(
  imagePath = DEFAULT_OG_IMAGE_PATH,
  origin = normalizeSiteOrigin(),
): string {
  if (/^https?:\/\//i.test(imagePath)) return imagePath
  return absoluteUrl(imagePath, origin)
}

export function normalizeDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

type PageMetadataInput = {
  title: string
  description: string
  path?: string
  imagePath?: string
  keywords?: string[]
  noIndex?: boolean
}

export function buildPageMetadata({
  title,
  description,
  path,
  imagePath = DEFAULT_OG_IMAGE_PATH,
  keywords,
  noIndex = false,
}: PageMetadataInput): Metadata {
  const origin = normalizeSiteOrigin()
  const canonical = path ? absoluteUrl(path, origin) : undefined
  const image = absoluteImageUrl(imagePath, origin)
  const normalizedDescription = normalizeDescription(description)

  return {
    metadataBase: new URL(origin),
    title,
    description: normalizedDescription,
    ...(canonical ? { alternates: { canonical } } : {}),
    ...(keywords?.length ? { keywords } : {}),
    openGraph: {
      title,
      description: normalizedDescription,
      siteName: SITE_NAME,
      locale: 'ru_RU',
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
      images: [{ url: image, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: normalizedDescription,
      images: [image],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          nocache: true,
        }
      : {
          index: true,
          follow: true,
        },
  }
}

export function buildOrganizationJsonLd() {
  const origin = normalizeSiteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    alternateName: 'MAVITA',
    url: origin,
    logo: absoluteImageUrl(LOGO_IMAGE_PATH, origin),
    image: absoluteImageUrl(DEFAULT_OG_IMAGE_PATH, origin),
    description: SITE_DESCRIPTION,
    email: 'mavitasvechi@mail.ru',
    telephone: '+7-921-189-90-08',
    sameAs: ['https://vk.com/mavitasvechi'],
    founder: {
      '@type': 'Person',
      name: 'Захарова Виктория Борисовна',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        areaServed: 'RU',
        availableLanguage: ['ru'],
        email: 'mavitasvechi@mail.ru',
        telephone: '+7-921-189-90-08',
      },
    ],
  }
}

export function buildWebsiteJsonLd() {
  const origin = normalizeSiteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: origin,
    inLanguage: 'ru-RU',
  }
}

function kopecksToRubString(value: number): string {
  return (value / 100).toFixed(2)
}

export function buildProductJsonLd(product: Product) {
  const offer = effectivePrice(
    {
      priceKopecks: product.priceKopecks,
      salePriceKopecks: product.sale?.priceKopecks ?? null,
      saleStartsAt: product.sale?.startsAt ?? null,
      saleEndsAt: product.sale?.endsAt ?? null,
    },
    new Date(),
  )
  const url = absoluteUrl(productPath(product.slug))
  const images = (product.images.length ? product.images : [product.image]).filter(Boolean)
  const additionalProperty = [
    product.series
      ? {
          '@type': 'PropertyValue',
          name: 'Серия',
          value: product.series,
        }
      : null,
    product.aroma
      ? {
          '@type': 'PropertyValue',
          name: 'Аромат',
          value: product.aroma,
        }
      : null,
    product.scent.length
      ? {
          '@type': 'PropertyValue',
          name: 'Ноты аромата',
          value: product.scent.join(', '),
        }
      : null,
  ].filter(Boolean)

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: normalizeDescription(product.description),
    sku: product.slug,
    url,
    image: images.map((image) => absoluteImageUrl(image)),
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    ...(product.category ? { category: product.category } : {}),
    ...(additionalProperty.length ? { additionalProperty } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'RUB',
      price: kopecksToRubString(offer.kopecks),
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      ...(offer.endsAt ? { priceValidUntil: offer.endsAt.slice(0, 10) } : {}),
    },
  }
}
