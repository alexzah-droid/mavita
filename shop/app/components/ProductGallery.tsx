'use client'

import { useState } from 'react'
import Image from 'next/image'

// Галерея товара: крупное фото + лента миниатюр.
// Лента вертикальная рядом с фото на десктопе и горизонтальная под фото на мобильном.
export default function ProductGallery({
  images,
  name,
}: {
  images: string[]
  name: string
}) {
  const gallery = images.length ? images : []
  const [active, setActive] = useState(0)
  const current = gallery[active] ?? gallery[0]

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
              onClick={() => setActive(i)}
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

      <div className="product-gallery-main">
        <Image
          key={current}
          src={current}
          alt={name}
          fill
          sizes="(max-width: 900px) 100vw, 50vw"
          priority
        />
      </div>
    </div>
  )
}
