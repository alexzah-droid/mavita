import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductBySlug } from '@/lib/catalog'
import { formatRubAmount } from '@/lib/price'
import CartButton from '@/app/cart/CartButton'
import AddToCartButton from '@/app/cart/AddToCartButton'

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
    title: `${product.name} — МАВИТА`,
    description: product.description,
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

  return (
    <>
      {/* Header */}
      <header className="site-header scrolled" style={{ position: 'sticky' }}>
        <div className="header-brand">
          <Image src="/images/logo.png" alt="МАВИТА" width={38} height={38} className="header-logo" />
          <span className="header-name">МАВИТА</span>
        </div>
        <nav className="header-nav">
          <Link href="/#catalog">Каталог</Link>
          <Link href="/#ritual">Ритуал</Link>
          <Link href="/#about">О бренде</Link>
          <CartButton />
        </nav>
      </header>

      <div className="product-page">
        <div className="product-page-inner">
          {/* Image */}
          <div>
            <Link href="/" className="product-back">
              В каталог
            </Link>
            <div className="product-image-stack">
              <Image
                src={product.image}
                alt={product.name}
                fill
                sizes="(max-width: 900px) 100vw, 50vw"
                priority
              />
            </div>
          </div>

          {/* Details */}
          <div>
            <div className="product-detail-series">{product.series}</div>
            <h1 className="product-detail-name">{product.name}</h1>
            <div className="product-detail-subtitle">«{product.subtitle}»</div>

            <div className="product-detail-price">
              {formatRubAmount(product.priceKopecks)}
              <span> ₽</span>
            </div>

            <div className="product-detail-sep" />

            <p className="product-detail-desc">{product.description}</p>

            <div className="product-detail-scents-label">Ароматы</div>
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
              <button className="btn-wishlist" aria-label="Сохранить">
                ♡
              </button>
            </div>

            <div className="product-ritual-hint">
              <div className="product-ritual-hint-label">QR-ритуал</div>
              <p className="product-ritual-hint-text">
                К каждой свече прилагается дизайнерская открытка с сургучной печатью и QR-кодом. Зажгите свечу, считайте код — и окажитесь в природе.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer strip */}
      <footer className="site-footer" style={{ marginTop: 0 }}>
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--paper-mute)',
          }}
        >
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <a href="mailto:mavitasvechi@mail.ru" style={{ color: 'inherit' }}>
              mavitasvechi@mail.ru
            </a>
            <a href="tel:+79211899008" style={{ color: 'inherit' }}>
              +7 921 189-90-08
            </a>
          </div>
          <span>© 2025 МАВИТА</span>
        </div>
      </footer>
    </>
  )
}
