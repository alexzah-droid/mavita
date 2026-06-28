import type { Metadata } from 'next'
import './globals.css'
import { CartProvider } from '@/app/cart/CartProvider'
import {
  SITE_DESCRIPTION,
  buildPageMetadata,
} from '@/lib/seo'

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: 'МАВИТА — Тишина, которую можно зажечь',
    description: SITE_DESCRIPTION,
    path: '/',
  }),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Manrope:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        {/* Применяем сохранённую тему до отрисовки, чтобы не было вспышки. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mavita-theme');if(t==='svet'||t==='kamen'||t==='dark-green'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  )
}
