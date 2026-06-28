import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  // Фиксируем корень трассировки на каталоге магазина: иначе Next цепляет
  // родительский package-lock.json вне репозитория и пишет предупреждение.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 828, 1080, 1200, 1600],
    imageSizes: [64, 128, 256, 384, 600],
  },
}

export default config
