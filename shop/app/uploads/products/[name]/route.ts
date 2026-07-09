import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

// В production Next отдаёт из public/ только файлы, существовавшие на момент
// `next build`: фото, загруженные админкой позже, сам Next не находит (404),
// и /_next/image не может их оптимизировать («isn't a valid image»), хотя
// Nginx отдаёт их напрямую. Роут стримит такие файлы с диска; ассеты времени
// сборки перехватываются статическим слоем раньше и сюда не попадают.
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'products')
const NAME_RE = /^[a-z0-9-]{1,100}\.(jpg|jpeg|png|webp)$/
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const match = NAME_RE.exec(name); if (!match) return new NextResponse(null, { status: 404 })
  try {
    const data = await readFile(path.join(UPLOAD_DIR, name))
    // Имена файлов — UUID, содержимое неизменно, поэтому кэш агрессивный.
    return new NextResponse(new Uint8Array(data), { headers: { 'Content-Type': MIME[match[1]], 'Cache-Control': 'public, max-age=31536000, immutable' } })
  } catch { return new NextResponse(null, { status: 404 }) }
}
