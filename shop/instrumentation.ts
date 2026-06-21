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
  // SETTINGS_ENC_KEY шифрует ключи перевозчиков в БД. Не обязателен (доставка
  // может быть выключена), но если задан — должен декодироваться ровно в 32 байта,
  // иначе модуль доставки молча упадёт при первом обращении. Buffer есть и в edge,
  // node:crypto не импортируем (см. выше).
  const encKey = process.env.SETTINGS_ENC_KEY?.trim()
  if (encKey) {
    // Та же строгая проверка, что и в secret-box-core.parseEncKey: hex64 ЛИБО
    // canonical base64 (Buffer.from('base64') игнорирует мусор — сверяем round-trip),
    // декодирование ровно в 32 байта. Иначе кривой ключ доживёт до первой расшифровки.
    let ok = /^[0-9a-f]{64}$/i.test(encKey)
    if (!ok) { const b = Buffer.from(encKey, 'base64'); ok = b.length === 32 && b.toString('base64').replace(/=+$/, '') === encKey.replace(/=+$/, '') }
    else ok = Buffer.from(encKey, 'hex').length === 32
    if (!ok) throw new Error('SETTINGS_ENC_KEY должен быть 64 hex-символа или canonical base64, ровно 32 байта')
  }
}
