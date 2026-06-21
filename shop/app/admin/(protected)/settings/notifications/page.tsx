import TelegramSettingsForm from '@/app/admin/TelegramSettingsForm'
import { getTelegramSettings } from '@/lib/telegram-settings'

export const dynamic = 'force-dynamic'
export default async function TelegramNotificationsPage() { return <section className="admin-content"><p className="admin-kicker">НАСТРОЙКИ</p><h1>Уведомления</h1><TelegramSettingsForm initial={await getTelegramSettings()} /></section> }
