import { redirect } from 'next/navigation'

// GET /api/robokassa/fail — редирект покупателя при отмене или ошибке оплаты.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invId = searchParams.get('InvId') ?? ''
  redirect(`/order/${invId}?failed=1`)
}
