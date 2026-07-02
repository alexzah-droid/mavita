'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { YANDEX_METRIKA_ID, shouldTrackYandexMetrikaPath, yandexMetrikaHitPath } from '@/app/components/yandexMetrikaConfig'

type YandexMetrikaFn = (counterId: number, method: string, ...args: unknown[]) => void

declare global {
  interface Window {
    ym?: YandexMetrikaFn
  }
}

export default function YandexMetrikaPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const skippedInitialHit = useRef(false)
  const previousUrl = useRef<string | null>(null)

  useEffect(() => {
    const query = searchParams.toString()
    // Токен заказа из /order/<token> в Метрику не отправляем — см. yandexMetrikaConfig.
    const url = `${window.location.origin}${yandexMetrikaHitPath(pathname)}${query ? `?${query}` : ''}`

    if (!skippedInitialHit.current) {
      skippedInitialHit.current = true
      previousUrl.current = url
      return
    }

    if (!shouldTrackYandexMetrikaPath(pathname)) return

    window.ym?.(YANDEX_METRIKA_ID, 'hit', url, {
      referer: previousUrl.current ?? document.referrer,
      title: document.title,
    })
    previousUrl.current = url
  }, [pathname, searchParams])

  return null
}
