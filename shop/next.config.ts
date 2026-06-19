import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  // Фиксируем корень трассировки на каталоге магазина: иначе Next цепляет
  // родительский package-lock.json вне репозитория и пишет предупреждение.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    unoptimized: true,
  },
}

export default config
