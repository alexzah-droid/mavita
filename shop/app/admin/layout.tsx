import type { ReactNode } from 'react'
import { buildPageMetadata } from '@/lib/seo'

export const metadata = buildPageMetadata({
  title: 'Админ-панель — МАВИТА',
  description: 'Служебный раздел интернет-магазина МАВИТА.',
  path: '/admin',
  noIndex: true,
})

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children
}
