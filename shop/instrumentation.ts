// Next.js instrumentation hook — выполняется один раз при старте сервера.
// Назначение: fail-fast на небезопасной конфигурации платежей (TD-21.1),
// чтобы прод не поднялся в тест-режиме Робокассы.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertPaymentConfigSafe } = await import('./lib/robokassa')
  assertPaymentConfigSafe()
  const { assertAuthConfig } = await import('./lib/auth')
  assertAuthConfig()
}
