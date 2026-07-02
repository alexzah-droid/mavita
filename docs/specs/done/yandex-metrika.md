# Спека: Яндекс.Метрика на production

**Статус:** реализовано и развернуто на production.
**Дата:** 2026-07-01; дополнено 2026-07-02 (события воронки, трекинг `/order`).
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

## Исключенные и обезличенные маршруты (обновлено 2026-07-02)

- `/admin*` — Метрика не загружается вовсе (гейт `shouldTrackYandexMetrikaPath()`).
- `/order/<token>` — с 2026-07-02 **трекается обезличенно** (раньше исключался
  полностью, из-за чего purchase-событию было некуда уходить): hit отправляется
  как путь `/order` без токена (`yandexMetrikaHitPath()`), вебвизор на этих
  страницах выключается в init (на странице PII покупателя).

Если появятся новые персональные маршруты — добавлять их в гейт/санитайзер в
`yandexMetrikaConfig.ts` до запуска.

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

## События воронки (добавлено 2026-07-02)

Хелперы — `app/components/metrikaEvents.ts`: e-commerce через `dataLayer`
(`currencyCode: RUB`, цены в рублях) + дублирующие цели `reachGoal`.

- `add_to_cart` — клик «В корзину» (`AddToCartButton`), ecommerce `add` с
  slug/название/эффективная цена;
- `begin_checkout` — открытие `/checkout` с непустой корзиной (один раз на визит);
- `purchase` — первый просмотр оплаченного заказа на `/order/<token>`
  (`OrderPaidEffects`, дедупликация по localStorage-ключу заказа), ecommerce
  `purchase` с id заказа и revenue = полная сумма с доставкой. Персональные
  данные покупателя в события не попадают (только состав и суммы).

## Не входит в scope

- GA4 не подключали.
- Цели `add_to_cart`/`begin_checkout`/`purchase` в кабинете Метрики настраиваются
  отдельно (данные уже отправляются).
