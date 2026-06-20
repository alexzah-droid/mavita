import Link from 'next/link'
import { requireAdminPage } from '@/lib/auth'
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return <div className="admin-shell"><header className="admin-nav"><Link href="/admin">Товары</Link><Link href="/admin/orders">Заказы</Link><Link href="/admin/settings/delivery">Доставка</Link><form action="/api/auth/logout" method="post"><button>Выйти</button></form></header>{children}</div>
}
