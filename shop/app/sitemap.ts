import type { MetadataRoute } from 'next'
import { getProducts } from '@/lib/catalog'
import { productPath } from '@/lib/product-url'
import { absoluteUrl } from '@/lib/seo'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const routes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl('/'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: absoluteUrl('/delivery'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: absoluteUrl('/offer'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: absoluteUrl('/privacy'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  try {
    const products = await getProducts()
    return routes.concat(
      products.map((product) => ({
        url: absoluteUrl(productPath(product.slug)),
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
        images: product.images.map((image) => absoluteUrl(image)),
      })),
    )
  } catch (error) {
    console.error('[sitemap] failed to load products:', error)
    return routes
  }
}
