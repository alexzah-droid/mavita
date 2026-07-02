export const YANDEX_METRIKA_ID = 110274888

export function shouldTrackYandexMetrikaPath(pathname: string) {
  return !pathname.startsWith('/admin')
}

// /order/<token> — страница с PII, токен в URL даёт к ней доступ. В Метрику
// страница уходит обезличенным путём /order (визиты и purchase считаются,
// токен наружу не утекает). Вебвизор на этих страницах выключается в init.
export function isSensitiveYandexMetrikaPath(pathname: string) {
  return pathname.startsWith('/order/')
}

export function yandexMetrikaHitPath(pathname: string) {
  return isSensitiveYandexMetrikaPath(pathname) ? '/order' : pathname
}
