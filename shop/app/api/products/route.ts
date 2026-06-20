import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/catalog'
import { CatalogUnavailable } from '@/lib/catalog'

// GET /api/products — каталог товаров из БД (с фоллбэком на seed).
export async function GET() {
  try { return NextResponse.json({ products: await getProducts() }) }
  catch (err) { if (err instanceof CatalogUnavailable) return NextResponse.json({ error: { code: 'CATALOG_UNAVAILABLE', messages: ['Каталог временно недоступен'] } }, { status: 503 }); throw err }
}
