import { redirect } from 'next/navigation'

// GET /api/robokassa/success — редирект покупателя после успешной оплаты.
// Робокасса передаёт InvId, OutSum, SignatureValue (через Password1).
// Мы доверяем наличию ?paid=1 только для UX; реальное подтверждение — через /result.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const invId = searchParams.get('InvId') ?? ''
  redirect(`/order/${invId}?paid=1`)
}
