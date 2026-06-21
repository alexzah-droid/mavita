// Guarded-обёртка crypto-core: расшифровывает секреты перевозчиков, поэтому помечена
// server-only — Client Component её импортировать не может. Приложение использует
// ИМЕННО этот модуль; операционные CLI-скрипты — '@/lib/secret-box-core'.
import 'server-only'
export { settingsEncKey, assertSettingsEncKey, encryptSecret, decryptSecret, maskSecret, parseEncKey } from '@/lib/secret-box-core'
