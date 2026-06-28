import type { ReactNode } from 'react'
import { buildPageMetadata } from '@/lib/seo'

export const metadata = buildPageMetadata({
  title: 'Оформление заказа — МАВИТА',
  description: 'Оформление заказа в интернет-магазине МАВИТА.',
  path: '/checkout',
  noIndex: true,
})

export default function CheckoutLayout({
  children,
}: {
  children: ReactNode
}) {
  return children
}
