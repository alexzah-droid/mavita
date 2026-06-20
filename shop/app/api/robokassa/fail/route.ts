import { redirect } from 'next/navigation'
import { getOrderTokenByInvId } from '@/lib/orders'

// GET /api/robokassa/fail — редирект покупателя при отмене или ошибке оплаты.
// Робокасса передаёт InvId (= id заказа); ведём на его заказ по token.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invId = Number(searchParams.get('InvId'))
  const token = Number.isInteger(invId) ? await getOrderTokenByInvId(invId) : undefined
  redirect(token ? `/order/${token}?failed=1` : '/')
}
