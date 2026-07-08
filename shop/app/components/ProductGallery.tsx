'use client'

import { useRef, useState, type UIEvent } from 'react'
import Image from 'next/image'

// На мобильных и планшетах все крупные фото лежат в нативной scroll-snap ленте:
// свайп следует за пальцем, а не переключает кадр только после touchend.
export default function ProductGallery({
  images,
  name,
}: {
  images: string[]
  name: string
}) {
  const gallery = images.length ? images : []
  const [active, setActive] = useState(0)
  const sliderRef = useRef<HTMLDivElement>(null)
  const current = gallery[active] ?? gallery[0]

  function selectImage(index: number) {
    setActive(index)
    const slider = sliderRef.current
    if (slider) slider.scrollTo({ left: slider.clientWidth * index, behavior: 'smooth' })
  }

  function syncActiveImage(event: UIEvent<HTMLDivElement>) {
    const slider = event.currentTarget
    if (!slider.clientWidth) return
    const index = Math.round(slider.scrollLeft / slider.clientWidth)
    if (index >= 0 && index < gallery.length && index !== active) setActive(index)
  }

  if (!current) {
    return <div className="product-image-stack" aria-hidden />
  }

  return (
    <div className="product-gallery">
      {gallery.length > 1 && (
        <div className="product-gallery-thumbs" role="listbox" aria-label="Фотографии товара">
          {gallery.map((src, i) => (
            <button
              key={src}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`product-gallery-thumb${i === active ? ' active' : ''}`}
              onClick={() => selectImage(i)}
            >
              <Image
                src={src}
                alt={`${name} — фото ${i + 1}`}
                fill
                sizes="96px"
                style={{ objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}

      <div className="product-gallery-main product-gallery-main-desktop">
        <Image
          key={current}
          src={current}
          alt={name}
          fill
          sizes="(max-width: 900px) 100vw, 50vw"
          priority
        />
      </div>

      <div className="product-gallery-slider-wrap">
        <div
          ref={sliderRef}
          className="product-gallery-slider"
          aria-label="Галерея фотографий товара. Листайте горизонтально."
          onScroll={syncActiveImage}
        >
          {gallery.map((src, i) => (
            <div className="product-gallery-slide" key={src}>
              <Image
                src={src}
                alt={`${name} — фото ${i + 1} из ${gallery.length}`}
                fill
                sizes="100vw"
              />
            </div>
          ))}
        </div>
        {gallery.length > 1 && (
          <div className="product-gallery-counter" aria-live="polite">
            {active + 1} / {gallery.length}
          </div>
        )}
      </div>
    </div>
  )
}
