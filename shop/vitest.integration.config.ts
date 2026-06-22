import { defineConfig } from 'vitest/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// Интеграционные тесты против реального PostgreSQL. Требуют TEST_DATABASE_URL,
// создают уникальную schema на запуск и удаляют её в finally (test/integration-db.ts).
// Запускаются последовательно (fileParallelism=false), чтобы общий для всей БД
// advisory key не создавал межтестовых гонок.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules', '.next'],
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': root, 'server-only': `${root}/test/server-only-stub.ts` },
  },
})
