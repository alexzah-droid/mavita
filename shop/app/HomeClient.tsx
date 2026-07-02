'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Product } from '@/lib/products'
import CartButton from '@/app/cart/CartButton'
import AddToCartButton from '@/app/cart/AddToCartButton'
import PriceDisplay from '@/app/components/PriceDisplay'
import ThemeSwitcher from '@/app/components/ThemeSwitcher'
import SiteFooter from '@/app/components/SiteFooter'

export default function HomeClient({ products }: { products: Product[] }) {
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onScroll = () => {
      if (!headerRef.current) return
      if (window.scrollY > 40) {
        headerRef.current.classList.add('scrolled')
      } else {
        headerRef.current.classList.remove('scrolled')
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12 }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <>
      {/* ── Header ── */}
      <header className="site-header" ref={headerRef}>
        <div className="header-brand">
          {/* Логотип содержит словесный знак «МАВИТА» — дублирующий текст не нужен */}
          <Image src="/images/logo.png" alt="МАВИТА" width={98} height={72} className="header-logo" priority />
        </div>
        <div className="header-actions">
          <nav className="header-nav">
            <a href="#catalog">Каталог</a>
            <a href="#ritual">Ритуал</a>
            <a href="#about">О бренде</a>
            <Link href="/delivery">Доставка</Link>
          </nav>
          <CartButton />
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-bg">
          <Image
            src="/images/author.jpg"
            alt=""
            fill
            className="hero-image"
            priority
          />
        </div>

        <div className="hero-content">
          <div className="hero-eyebrow reveal">
            Серия · Горы · Ручная работа
          </div>
          <h1 className="hero-title reveal" style={{ transitionDelay: '0.1s' }}>
            МАВИТА
            <em>Земля и жизнь</em>
          </h1>
          <p className="hero-lede reveal" style={{ transitionDelay: '0.2s' }}>
            Тишина, которую можно зажечь. Ритуал возвращения к себе через аромат природы.
          </p>
          <a href="#catalog" className="hero-cta hero-cta--buy reveal" style={{ transitionDelay: '0.3s' }}>
            Купить
          </a>
        </div>

        <div className="hero-scroll-hint">Прокрутить</div>
      </section>

      {/* ── Ritual ── */}
      <section className="ritual" id="ritual">
        <div className="ritual-inner">
          <div>
            <div className="eyebrow reveal">QR-ритуал</div>
            <h2 className="ritual-heading reveal" style={{ transitionDelay: '0.1s' }}>
              Четыре<br />
              <em>шага</em><br />
              к тишине
            </h2>
          </div>
          <div>
            <div className="ritual-steps">
              {[
                {
                  n: '01',
                  title: 'Зажгите свечу',
                  text: 'Дайте огню разогреть воск. Почувствуйте первый выдох аромата.',
                },
                {
                  n: '02',
                  title: 'Считайте QR',
                  text: 'Дизайнерская открытка с сургучной печатью — сканируйте QR-код.',
                },
                {
                  n: '03',
                  title: 'Включите звук',
                  text: 'Лес, море или горы. Аудиодорожка натуральных звуков природы.',
                },
                {
                  n: '04',
                  title: 'Вернитесь к себе',
                  text: 'Аромат + звук + огонь. Полное погружение. Настоящий момент.',
                },
              ].map((step, i) => (
                <div
                  className="ritual-step reveal"
                  key={step.n}
                  style={{ transitionDelay: `${i * 0.1}s` }}
                >
                  <div className="ritual-step-num">{step.n}</div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Catalog ── */}
      <section className="catalog" id="catalog">
        <div className="catalog-inner">
          <div className="catalog-header">
            <div>
              <div className="eyebrow reveal">Серия Горы · 2025</div>
              <h2 className="catalog-title reveal" style={{ transitionDelay: '0.1s' }}>
                Каталог
              </h2>
            </div>
            <p className="catalog-subtitle reveal" style={{ transitionDelay: '0.15s' }}>
              Каждая свеча — состояние. Не просто аромат, а ощущение присутствия в природе.
            </p>
          </div>

          <div className="product-grid">
            {products.map((product, i) => (
              <Link
                href={`/product/${product.slug}`}
                key={product.slug}
                className="product-card reveal"
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                <div className="product-card-image-wrap">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 25vw"
                    style={{ objectFit: 'cover' }}
                  />
                  <div className="product-card-glow" />
                  <div className="product-card-badge">
                    Горы
                  </div>
                </div>
                <AddToCartButton
                  product={product}
                  variant="buy"
                  className="product-card-buy"
                />
                <div className="product-card-body">
                  <div className="product-card-series">
                    {product.subtitle}
                  </div>
                  <div className="product-card-name">{product.name}</div>
                  <div className="product-card-footer">
                    <div className="product-card-price">
                      <PriceDisplay product={{ priceKopecks: product.priceKopecks, salePriceKopecks: product.sale?.priceKopecks ?? null, saleStartsAt: product.sale?.startsAt ?? null, saleEndsAt: product.sale?.endsAt ?? null }} />
                    </div>
                    <AddToCartButton
                      product={product}
                      variant="icon"
                      className="product-card-btn"
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Atmosphere / About ── */}
      <section className="atmosphere" id="about">
        <div className="atmosphere-inner">
          <div className="atmosphere-photo reveal">
            <Image
              src="/images/author.jpg"
              alt="Виктория — основатель МАВИТА"
              fill
              sizes="(max-width: 900px) 100vw, 42vw"
              style={{ objectFit: 'cover', objectPosition: 'top center' }}
            />
          </div>
          <div className="atmosphere-text">
            <div className="eyebrow reveal">О бренде</div>
            <h2 className="atmosphere-title reveal" style={{ transitionDelay: '0.1s' }}>
              Земля<br />
              и <em>жизнь</em>
            </h2>
            <p className="atmosphere-body reveal" style={{ transitionDelay: '0.15s' }}>
              МАВИТА вырос из личной истории. МА — Земля на языке древних, ВИТА — жизнь. Бренд создан, чтобы помогать людям возвращаться к себе через контакт с природой — даже в центре мегаполиса.
            </p>
            <p className="atmosphere-body reveal" style={{ transitionDelay: '0.2s' }}>
              Каждая свеча — ручная работа на натуральных маслах. Пихта, кипарис, можжевельник, пачули, эвкалипт. Формы камней, гор, гальки — природная фактура в воске.
            </p>
            <p className="atmosphere-body reveal" style={{ transitionDelay: '0.25s' }}>
              Зажечь. Услышать. Выдохнуть. Вернуться.
            </p>
            <div className="atmosphere-signature reveal" style={{ transitionDelay: '0.3s' }}>
              Виктория, основатель МАВИТА
            </div>
          </div>
        </div>
      </section>

      {/* ── Three Stihii ── */}
      <section className="stihii">
        <div className="stihii-inner">
          <div className="eyebrow reveal">Три стихии</div>
          <div className="stihii-grid">
            {[
              {
                cls: 'les',
                icon: '↑',
                name: 'Лес',
                state: 'Заземление · Безопасность',
                desc: 'Мох, хвоя, влажная земля, папоротник. Лес после дождя. Ощущение опоры и защиты — как под кроной старого дерева.',
                scents: 'Пихта · Эвкалипт · Мох · Хвоя',
              },
              {
                cls: 'more',
                icon: '~',
                name: 'Море',
                state: 'Расслабление · Отпускание',
                desc: 'Соль, озон, бриз, минералы. Закат у воды. Ощущение пространства — когда горизонт раздвигается и можно просто дышать.',
                scents: 'Озон · Соль · Минералы · Бриз',
              },
              {
                cls: 'gory',
                icon: '△',
                name: 'Горы',
                state: 'Ясность · Сила',
                desc: 'Холодный воздух, камень, древесина, лава. Высота тишины. Ощущение внутренней опоры — как горная порода: надёжная, неспешная, вечная.',
                scents: 'Кипарис · Можжевельник · Камень · Лава',
              },
            ].map((s, i) => (
              <div
                className={`stihiya ${s.cls} reveal`}
                key={s.cls}
                style={{ transitionDelay: `${i * 0.1}s` }}
              >
                <div className="stihiya-icon">{s.icon}</div>
                <div className="stihiya-name">{s.name}</div>
                <span className="stihiya-state">{s.state}</span>
                <p className="stihiya-desc">{s.desc}</p>
                <div className="stihiya-sep" />
                <div className="stihiya-scents">{s.scents}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <SiteFooter />

      <ThemeSwitcher />
    </>
  )
}
