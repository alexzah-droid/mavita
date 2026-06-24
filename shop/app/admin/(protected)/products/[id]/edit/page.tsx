import { notFound } from 'next/navigation'
import { getAdminProduct } from '@/lib/admin-products-db'
import AdminProductForm from '@/app/admin/AdminProductForm'
export const dynamic = 'force-dynamic'
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const product = await getAdminProduct(Number((await params).id))
  if (!product) notFound()
  return (
    <section className="admin-content">
      <h1>Редактирование</h1>
      <AdminProductForm product={product} />
    </section>
  )
}
