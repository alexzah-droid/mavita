import type { ReactNode } from 'react'
import { buildPageMetadata } from '@/lib/seo'

export const metadata = buildPageMetadata({
  title: 'Корзина — МАВИТА',
  description: 'Корзина интернет-магазина МАВИТА.',
  path: '/cart',
  noIndex: true,
})

export default function CartLayout({ children }: { children: ReactNode }) {
  return children
}
