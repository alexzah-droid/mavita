import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductBySlug } from '@/lib/catalog'
import AddToCartButton from '@/app/cart/AddToCartButton'
import ShopHeader from '@/app/components/ShopHeader'
import PriceDisplay from '@/app/components/PriceDisplay'
import ProductGallery from '@/app/components/ProductGallery'
import SiteFooter from '@/app/components/SiteFooter'
import CandleCareTips from '@/app/components/CandleCareTips'
import { CARRIER_LABEL, resolveDeliveryMode } from '@/lib/store-settings'
import { formatRub } from '@/lib/price'
import { productPath } from '@/lib/product-url'
import {
  buildPageMetadata,
  buildProductJsonLd,
} from '@/lib/seo'

// Карточка товара рендерится на запрос — данные берутся из БД в рантайме.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return {}

  return {
    ...buildPageMetadata({
      title: `${product.name} — МАВИТА`,
      description: product.description,
      path: productPath(product.slug),
      imagePath: product.image,
      keywords: [
        product.name,
        product.series,
        product.category ?? '',
        ...product.scent,
      ].filter(Boolean),
    }),
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()
  const productJsonLd = buildProductJsonLd(product)

  // Тариф доставки показываем прямо на карточке — цена «без сюрпризов» на чекауте.
  // Ошибка настроек не должна ронять карточку: просто не показываем строку.
  const delivery = await resolveDeliveryMode().catch(() => null)
  const activeCarrier = delivery?.mode === 'pickup_required' ? delivery.carriers[0] : null

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <ShopHeader />

      <div className="product-page">
        <div className="product-page-inner">
          {/* Image */}
          <div>
            <Link href="/" className="product-back">
              В каталог
            </Link>
            <ProductGallery images={product.images} name={product.name} />
          </div>

          {/* Details */}
          <div>
            <div className="product-detail-series">
              {product.series}
              {product.category ? ` · ${product.category}` : ''}
            </div>
            <h1 className="product-detail-name">{product.name}</h1>
            <div className="product-detail-subtitle">«{product.subtitle}»</div>
            {product.aroma && (
              <p className="product-detail-aroma">{product.aroma}</p>
            )}

            <div className="product-detail-price">
              <PriceDisplay product={{ priceKopecks: product.priceKopecks, salePriceKopecks: product.sale?.priceKopecks ?? null, saleStartsAt: product.sale?.startsAt ?? null, saleEndsAt: product.sale?.endsAt ?? null }} />
            </div>

            {activeCarrier && (
              <p className="product-detail-delivery">
                Доставка {CARRIER_LABEL[activeCarrier.carrier]} до пункта выдачи по России —{' '}
                {activeCarrier.deliveryKopecks === 0 ? 'бесплатно' : formatRub(activeCarrier.deliveryKopecks)} ·{' '}
                <Link href="/delivery">подробнее</Link>
              </p>
            )}

            <div className="product-detail-sep" />

            <p className="product-detail-desc">{product.description}</p>
            {product.tagline && (
              <p className="product-detail-tagline">{product.tagline}</p>
            )}

            <dl className="product-detail-specs">
              {product.category && (
                <div className="product-detail-spec">
                  <dt>Категория</dt>
                  <dd>{product.category}</dd>
                </div>
              )}
              {product.series && (
                <div className="product-detail-spec">
                  <dt>Серия</dt>
                  <dd>{product.series}</dd>
                </div>
              )}
              <div className="product-detail-spec">
                <dt>Аромат</dt>
                <dd>«{product.subtitle}»</dd>
              </div>
              {product.weightGrams != null && (
                <div className="product-detail-spec">
                  <dt>Вес изделия</dt>
                  <dd>{product.weightGrams} г</dd>
                </div>
              )}
              {product.waxWeight && (
                <div className="product-detail-spec">
                  <dt>Вес чистого воска</dt>
                  <dd>{product.waxWeight}</dd>
                </div>
              )}
              {product.burnTimeHours != null && (
                <div className="product-detail-spec">
                  <dt>Время горения</dt>
                  <dd>до {product.burnTimeHours} ч</dd>
                </div>
              )}
              {product.wax && (
                <div className="product-detail-spec">
                  <dt>Воск</dt>
                  <dd>{product.wax}</dd>
                </div>
              )}
              {product.wick && (
                <div className="product-detail-spec">
                  <dt>Фитиль</dt>
                  <dd>{product.wick}</dd>
                </div>
              )}
            </dl>

            <div className="product-detail-scents-label">Ноты аромата</div>
            <div className="product-detail-scents">
              {product.scent.map((s) => (
                <span key={s} className="scent-tag">
                  {s}
                </span>
              ))}
            </div>

            <div className="product-detail-add">
              <AddToCartButton
                product={product}
                variant="primary"
                className="btn-add"
              />
            </div>

            <div className="product-ritual-hint">
              <div className="product-ritual-hint-label">QR-ритуал</div>
              <p className="product-ritual-hint-text">
                К каждой свече прилагается дизайнерская открытка с сургучной печатью и QR-кодом. Зажгите свечу, считайте код — и окажитесь в природе.
              </p>
            </div>

            <CandleCareTips variant="product" />
          </div>
        </div>
      </div>

      <SiteFooter />
    </>
  )
}
