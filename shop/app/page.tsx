import { getProducts } from '@/lib/catalog'
import HomeClient from '@/app/HomeClient'

// Рендерим на каждый запрос, чтобы витрина отражала актуальные данные БД
// (иначе при сборке без DATABASE_URL страница «запеклась» бы на seed).
export const dynamic = 'force-dynamic'

// Витрина читает каталог из БД на сервере (с фоллбэком на seed) и передаёт
// данные в клиентский HomeClient, где живут скролл/reveal-эффекты.
export default async function HomePage() {
  const products = await getProducts()
  return <HomeClient products={products} />
}
