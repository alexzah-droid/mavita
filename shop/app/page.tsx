import { getProducts } from '@/lib/catalog'
import HomeClient from '@/app/HomeClient'
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
  const products = await getProducts()
  const structuredData = [buildOrganizationJsonLd(), buildWebsiteJsonLd()]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeClient products={products} />
    </>
  )
}
