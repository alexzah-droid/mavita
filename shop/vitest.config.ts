import { defineConfig } from 'vitest/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    // server-only — заглушка: node-окружение vitest без react-server-условия иначе
    // падает на guarded-модулях (secret-box, store-settings). В проде guard реальный.
    alias: { '@': root, 'server-only': `${root}/test/server-only-stub.ts` },
  },
})
