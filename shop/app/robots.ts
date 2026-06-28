import type { MetadataRoute } from 'next'
import { normalizeSiteOrigin } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/cart', '/checkout', '/order/'],
      },
    ],
    sitemap: `${normalizeSiteOrigin()}/sitemap.xml`,
    host: normalizeSiteOrigin(),
  }
}
