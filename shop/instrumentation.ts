// Next.js instrumentation hook — выполняется один раз при старте сервера.
// Назначение: fail-fast на небезопасной конфигурации платежей (TD-21.1),
// чтобы прод не поднялся в тест-режиме Робокассы.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // instrumentation.ts собирается также для Edge runtime. Не импортируем сюда
  // node:crypto / iron-session: даже динамический import попадает в edge bundle.
  // Дублируем короткие fail-fast проверки конфигурации без Node-only модулей.
  if (!process.env.ADMIN_PASSWORD?.trim()) throw new Error('ADMIN_PASSWORD must be set')
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
  if (process.env.NODE_ENV === 'production' && process.env.ROBOKASSA_TEST_MODE === 'true' && process.env.ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION !== 'true') throw new Error('ROBOKASSA_TEST_MODE=true в production без ALLOW_ROBOKASSA_TEST_MODE_IN_PRODUCTION=true')
  const algorithm = (process.env.ROBOKASSA_HASH_ALGO ?? 'md5').toLowerCase()
  if (process.env.ROBOKASSA_LOGIN && process.env.ROBOKASSA_PASSWORD1 && process.env.ROBOKASSA_PASSWORD2 && !['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(algorithm)) throw new Error(`ROBOKASSA_HASH_ALGO="${algorithm}" не поддерживается`)
}
