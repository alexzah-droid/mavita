export const YANDEX_METRIKA_ID = 110274888

export function shouldTrackYandexMetrikaPath(pathname: string) {
  return !pathname.startsWith('/admin') && !pathname.startsWith('/order')
}
