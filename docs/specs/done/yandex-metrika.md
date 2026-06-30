# Спека: Яндекс.Метрика на production

**Статус:** реализовано и развернуто на production.
**Дата:** 2026-07-01.
**Счетчик:** `110274888`.
**Связанные файлы:** `app/components/YandexMetrika.tsx`,
`app/components/YandexMetrikaPageView.tsx`,
`app/components/yandexMetrikaConfig.ts`, `app/layout.tsx`,
`app/privacy/page.tsx`.

## Цель

Подключить веб-аналитику для публичной части `mavita.ru`: базовые просмотры
страниц, карту кликов, Вебвизор, исходящие ссылки и подготовку контейнера
`dataLayer` для будущих ecommerce-событий.

## Реализация

- Счетчик подключается только в production (`NODE_ENV === 'production'`) через
  `next/script` со стратегией `afterInteractive`.
- Инициализация использует режим SPA: `defer:true`, затем явный первичный
  `ym(110274888, 'hit', location.href, ...)`.
- Клиентские переходы App Router отслеживаются отдельным компонентом через
  `usePathname()` / `useSearchParams()` и `ym(..., 'hit', url, { referer, title })`.
- `window.dataLayer = window.dataLayer || []` создается до инициализации
  счетчика; `ecommerce:"dataLayer"` включен на уровне Метрики.
- `noscript`-fallback оставлен стандартным пикселем
  `https://mc.yandex.ru/watch/110274888`.

## Исключенные маршруты

Метрика намеренно не загружается на приватных маршрутах:

- `/admin*` — админка и логин владельца;
- `/order*` — персональные страницы статуса заказа с неугадываемым токеном.

Гейт находится в `shouldTrackYandexMetrikaPath()`. Если появятся новые
персональные или служебные маршруты, их нужно добавить в этот список до запуска.

## Юридический текст

`/privacy` обновлен: политика теперь упоминает технические данные посещения
(IP-адрес, браузер/устройство, URL, источник перехода, cookie, действия на
страницах), цель веб-аналитики и передачу данных сервису Яндекс.Метрика.

## Проверка production

Выполнено после деплоя на `https://mavita.ru`:

- `npm run typecheck` — успешно локально;
- `npm run build` — успешно локально и на VPS;
- `pm2 reload mavita --update-env` — успешно, процесс `mavita` online;
- Playwright на `/`: `typeof window.ym === 'function'`,
  `Array.isArray(window.dataLayer) === true`, есть запрос
  `https://mc.yandex.ru/metrika/tag.js?id=110274888`;
- Playwright на `/admin/login`: `window.ym` не определен, запросов к
  `mc.yandex.ru` нет;
- SPA-переход `/` -> `/privacy` отправляет
  `ym(110274888, 'hit', 'https://mavita.ru/privacy', { referer: 'https://mavita.ru/', ... })`;
- `/order/not-real-token-for-check` не содержит и не загружает Метрику.

## Не входит в scope

- GA4 не подключали.
- Ecommerce-события (`add`, `purchase`, checkout steps) пока не отправляются:
  подготовлен только `dataLayer`. Для них нужна отдельная карта событий и
  проверка, что в аналитику не уходят персональные данные покупателя.
- Цели в кабинете Метрики не описаны в репозитории и настраиваются отдельно.
