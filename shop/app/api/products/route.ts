import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/catalog'

// GET /api/products — каталог товаров из БД (с фоллбэком на seed).
export async function GET() {
  const products = await getProducts()
  return NextResponse.json({ products })
}
