// Операционный алерт оператору тем же Telegram-каналом, что и заказы. Возвращает
// ФАКТ доставки: fetch не бросает на 4xx/5xx, поэтому обязательно проверяем
// response.ok и сообщаем причину недоставки (chat id/токен/429/сеть) — иначе
// «молча считается отправленным». Best-effort: не бросает, чтобы не валить job.
import { getTelegramDeliveryCredentials } from '@/lib/telegram-settings'

export type AlertResult = { delivered: true } | { delivered: false; reason: string }

export async function sendOpsAlert(text: string): Promise<AlertResult> {
  let creds: { chatId: string; token: string } | undefined
  try { creds = await getTelegramDeliveryCredentials() } catch { return { delivered: false, reason: 'telegram_error' } }
  if (!creds) return { delivered: false, reason: 'telegram_not_configured' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    })
    const body: unknown = await res.json().catch(() => null)
    // Подтверждаем КОНТРАКТ Telegram, как sender заказов: 2xx + { ok:true, result:{ message_id:number } }.
    // 200 сам по себе недостаточен (Telegram может вернуть ok:false с 200 в нестандартных случаях).
    if (res.ok && body && typeof body === 'object' && (body as { ok?: unknown }).ok === true) {
      const result = (body as { result?: unknown }).result
      if (result && typeof result === 'object' && typeof (result as { message_id?: unknown }).message_id === 'number') return { delivered: true }
    }
    return { delivered: false, reason: res.ok ? 'telegram_not_ok' : `http_${res.status}` }
  } catch { return { delivered: false, reason: 'network' } }
}
