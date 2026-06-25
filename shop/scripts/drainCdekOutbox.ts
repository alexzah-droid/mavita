import { drainCdekOutbox } from '@/lib/cdek-outbox'

async function main() {
  const processed = await drainCdekOutbox()
  console.log(`CDEK outbox processed: ${processed}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
