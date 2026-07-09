import AboutContentForm from '@/app/admin/AboutContentForm'
import { getSiteContent } from '@/lib/site-content'

export const dynamic = 'force-dynamic'

export default async function ContentSettingsPage() {
  return <section className="admin-content"><p className="admin-kicker">НАСТРОЙКИ</p><h1>Контент</h1><AboutContentForm initial={await getSiteContent()} /></section>
}
