// Next.js instrumentation hook — выполняется один раз при старте сервера.
// Назначение: fail-fast на небезопасной конфигурации (TD-21.1), чтобы прод
// не поднялся в тест-режиме Робокассы или с кривыми ключами.
//
// Проверки живут в lib/config-checks — общем чистом модуле без node:crypto
// (instrumentation собирается также для Edge runtime, Buffer в edge есть).
// Серверные модули (lib/auth, lib/robokassa, secret-box) используют те же функции.
import { authConfigProblems, paymentConfigProblems, settingsEncKeyProblems } from '@/lib/config-checks'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const problems = [
    ...authConfigProblems(),
    ...paymentConfigProblems(),
    ...settingsEncKeyProblems(),
  ]
  if (problems.length) {
    throw new Error(`Небезопасная конфигурация:\n- ${problems.join('\n- ')}`)
  }
}
