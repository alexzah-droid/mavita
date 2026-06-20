import Link from 'next/link'
import { listAdminProducts } from '@/lib/admin-products-db'
import AdminProductsList from '@/app/admin/AdminProductsList'
export const dynamic = 'force-dynamic'
export default async function AdminPage() { const products = await listAdminProducts(); return <section className="admin-content"><div className="admin-heading"><div><p className="admin-kicker">КАТАЛОГ</p><h1>Товары</h1></div><Link className="admin-button" href="/admin/products/new">Создать товар</Link></div><AdminProductsList initialProducts={products} /></section> }
