import { redirect } from 'next/navigation'
import { getOrderTokenByInvId } from '@/lib/orders'

// GET /api/robokassa/success — редирект покупателя после успешной оплаты.
// Робокасса передаёт InvId (= id заказа). Реальное подтверждение статуса —
// сервер→сервер в /result; здесь только ведём покупателя на его заказ по token.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invId = Number(searchParams.get('InvId'))
  const token = Number.isInteger(invId) ? await getOrderTokenByInvId(invId) : undefined
  redirect(token ? `/order/${token}?paid=1` : '/')
}
