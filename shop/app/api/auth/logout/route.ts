import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { assertSameOrigin, sessionOptions, type AdminSession } from '@/lib/auth'
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request); if (csrf) return csrf
  const session = await getIronSession<AdminSession>(await cookies(), sessionOptions); session.destroy()
  return NextResponse.json({ ok: true })
}
