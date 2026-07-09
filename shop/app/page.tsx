import { getProducts } from '@/lib/catalog'
import HomeClient from '@/app/HomeClient'
import { getSiteContent } from '@/lib/site-content'
import {
  SITE_DESCRIPTION,
  buildOrganizationJsonLd,
  buildPageMetadata,
  buildWebsiteJsonLd,
} from '@/lib/seo'

// Рендерим на каждый запрос, чтобы витрина отражала актуальные данные БД
// (иначе при сборке без DATABASE_URL страница «запеклась» бы на seed).
export const dynamic = 'force-dynamic'

export const metadata = buildPageMetadata({
  title: 'МАВИТА — Тишина, которую можно зажечь',
  description: SITE_DESCRIPTION,
  path: '/',
  keywords: [
    'ароматические свечи',
    'соевые свечи',
    'свечи ручной работы',
    'МАВИТА',
    'подарочные свечи',
  ],
})

// Витрина читает каталог из БД на сервере (с фоллбэком на seed) и передаёт
// данные в клиентский HomeClient, где живут скролл/reveal-эффекты.
export default async function HomePage() {
  const [products, siteContent] = await Promise.all([getProducts(), getSiteContent()])
  const structuredData = [buildOrganizationJsonLd(), buildWebsiteJsonLd()]
  const showQrRitual = process.env.NODE_ENV !== 'production'

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeClient products={products} showQrRitual={showQrRitual} aboutText={siteContent.aboutText} stihii={siteContent.stihii} />
    </>
  )
}
