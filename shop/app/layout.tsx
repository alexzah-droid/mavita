import type { Metadata } from 'next'
import './globals.css'
import { CartProvider } from '@/app/cart/CartProvider'

export const metadata: Metadata = {
  title: 'МАВИТА — Тишина, которую можно зажечь',
  description:
    'Ароматические свечи ручной работы. Ритуал восстановления через аромат природы.',
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
      </head>
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  )
}
