import { drainNotificationOutbox } from '@/lib/telegram-notifications'

async function main() {
  const drained = await drainNotificationOutbox()
  console.log(`Telegram notification outbox processed: ${drained}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
