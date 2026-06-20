'use client'
import { useEffect, useState } from 'react'
import { formatRubAmount } from '@/lib/price'
import { effectivePrice, type SaleFields } from '@/lib/pricing'
export default function PriceDisplay({ product }: { product: SaleFields }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  const price = effectivePrice(product, now)
  return <><span style={price.isOnSale ? { textDecoration: 'line-through', opacity: .55, marginRight: 8 } : undefined}>{formatRubAmount(price.regularKopecks)} ₽</span>{price.isOnSale && <><span>{formatRubAmount(price.kopecks)} ₽</span>{price.endsAt && <small style={{ display: 'block', opacity: .7, fontSize: '0.7em' }}>до {new Date(price.endsAt).toLocaleString('ru-RU')}</small>}</>}</>
}
