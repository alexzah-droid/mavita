'use client'

import { Suspense } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import YandexMetrikaPageView from '@/app/components/YandexMetrikaPageView'
import {
  YANDEX_METRIKA_ID,
  isSensitiveYandexMetrikaPath,
  shouldTrackYandexMetrikaPath,
  yandexMetrikaHitPath,
} from '@/app/components/yandexMetrikaConfig'

const isProduction = process.env.NODE_ENV === 'production'

export default function YandexMetrika() {
  const pathname = usePathname()

  if (!isProduction || !shouldTrackYandexMetrikaPath(pathname)) return null

  // На страницах заказа вебвизор не пишем (там PII покупателя), а hit шлём без
  // токена из URL. Возврат с оплаты — полная загрузка страницы, так что init
  // с нужным флагом отработает именно для неё.
  const sensitive = isSensitiveYandexMetrikaPath(pathname)

  return (
    <>
      <Script
        id="yandex-metrika"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            (function(m,e,t,r,i,k,a){
                m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                m[i].l=1*new Date();
                for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
            })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}', 'ym');

            ym(${YANDEX_METRIKA_ID}, 'init', {defer:true, ssr:true, webvisor:${!sensitive}, clickmap:true, ecommerce:"dataLayer", accurateTrackBounce:true, trackLinks:true});
            ym(${YANDEX_METRIKA_ID}, 'hit', ${sensitive ? `location.origin + '/order'` : 'location.href'}, {referer: document.referrer, title: document.title});
          `,
        }}
      />
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
      <Suspense fallback={null}>
        <YandexMetrikaPageView />
      </Suspense>
    </>
  )
}
