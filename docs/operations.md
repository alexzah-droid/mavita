# МАВИТА-ШОП operations runbook

Дата актуализации: 2026-07-09. URL, ключи и запреты — в `docs/environments.md`.

---

## Деплой на production

```bash
# 1) синхронизировать код (секреты, node_modules, .next, загружаемые фото — не трогаем)
rsync -avz \
  --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='public/uploads' \
  shop/ mavita:/var/www/mavita-repo/shop/

# 2) если изменились package.json или package-lock.json — установить точные зависимости
ssh mavita "cd /var/www/mavita-repo/shop && npm ci"

# 3) пересобрать и перезапустить
ssh mavita "cd /var/www/mavita-repo/shop && npm run build && pm2 reload mavita --update-env"
```

Проверка: `curl -s https://mavita.ru/api/products | head -c 50`

Если `npm run build` падает на `ENOENT ... .next/build-manifest.json`, значит на
сервере сломан предыдущий build-output. Для code-only rollout допустима чистая
пересборка без трогания исходников:

```bash
ssh mavita "cd /var/www/mavita-repo/shop && rm -rf .next && npm run build && pm2 reload mavita --update-env"
```

> **Примечание:** `public/images/catalog/` (статические фото товаров) синхронизируется
> штатным rsync и попадает на прод. Это не то же самое, что `public/uploads/` (фото,
> загружаемые через админку) — тот каталог исключён намеренно.

### Nginx gzip для JSON

На production в `/etc/nginx/nginx.conf` включено gzip-сжатие для JSON/JS:

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_buffers 16 8k;
gzip_http_version 1.1;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
```

Это важно для карты СДЭК: городской ответ `/api/cdek/widget?...city_code=44`
остаётся около 1 МБ в JSON, но по сети уходит примерно 140 КБ gzip. После
изменений конфигурации обязательно выполнять `nginx -t && systemctl reload nginx`.

### Добавление/замена фото каталога

При добавлении новых фотографий в `public/images/catalog/`:

```bash
# Оптимизировать перед деплоем (ресайз до 1600 px, JPEG 85%, PNG-фото → JPEG):
cd shop && node scripts/optimize-images.mjs

# Затем стандартный деплой (rsync синхронизирует public/images/)
```

`logo.png` скрипт пропускает автоматически (прозрачность). Если PNG-файл добавлен
в `product_images` (БД), после конвертации нужно обновить расширение в БД:

```bash
ssh mavita "cd /var/www/mavita-repo/shop && export \$(grep DATABASE_URL .env | xargs) && \
  psql \"\$DATABASE_URL\" -c \"UPDATE product_images SET filename = regexp_replace(filename, '\\.png\$', '.jpg') WHERE filename LIKE '/images/catalog/%.png'\""
```

---

## Тесты и release gate

```sh
npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e
```

- `npm test` — юниты (Vitest, без БД). Интеграционные файлы `*.integration.test.ts`
  из этого набора исключены.
- `npm run test:integration` — против **реального PostgreSQL**. Требует
  `TEST_DATABASE_URL`; на каждый запуск создаётся уникальная schema (применяется
  `sql/schema.sql`) и удаляется в `finally`. Набор идёт последовательно
  (`fileParallelism=false`), потому что transaction-scoped advisory lock
  `PRODUCTS_PUBLIC_ORDER_LOCK` общий для всей БД. Локально:
  `TEST_DATABASE_URL=postgres://user:pwd@localhost:5432/mavita_test npm run test:integration`.
  В CI PostgreSQL поднимается service-контейнером.
- `npm run test:e2e` — Playwright. Сценарии админских товаров (фото-сортировка,
  cover, `409`, архивирование, hard delete) получают явную DB-fixture и
  авторизованную сессию (seed-fallback не допускается). Локально без `DATABASE_URL`
  они пропускаются; **в CI** (`process.env.CI`) отсутствие `DATABASE_URL` — ошибка,
  а не skip. Запуск с БД: `DATABASE_URL=… ADMIN_PASSWORD=… npm run test:e2e`
  (dev-сервер наследует env). Проверено на PostgreSQL 16 (Docker): integration 4/4,
  e2e 4/4.

После gate — ручной smoke-test: реальный часовой пояс администратора, DST-сценарий
(если применимо) и две вкладки админки (конкурентная сортировка/публикация).

---

## Откат

```bash
# локально — откатить коммит и задеплоить предыдущую версию
git revert <commit> --no-edit
git push origin main
# затем повторить деплой
```

---

## Backup / restore PostgreSQL

```bash
# backup (на VPS)
ssh mavita "pg_dump -U mavita -d mavita -h localhost > /root/mavita_$(date +%Y%m%d_%H%M%S).sql"

# restore
ssh mavita "psql -U mavita -d mavita -h localhost < /root/mavita_<timestamp>.sql"
```

Пароль БД — в `/var/www/mavita-repo/shop/.env` (DATABASE_URL).

---

## Схема, миграции и seed

```bash
# Только свежая пустая БД: базовая схема и исходный каталог.
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/schema.sql"
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/seed.sql"

# Существующая production-БД: сначала backup, затем применить КАЖДУЮ ещё не
# применённую миграцию. schema.sql не заменяет ALTER-миграции.
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/migrations/003_orders_delivery_and_admin_events.sql"
# После rollout Telegram-уведомлений:
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/migrations/004_telegram_order_notifications.sql"
# Секрет вебхука СДЭК + индекс cdek_order_uuid (применена на prod 2026-07-01):
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/migrations/019_cdek_webhook_secret_and_uuid_index.sql"
# Публичные характеристики свечи + комментарий покупателя к заказу (раунд конверсии):
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/migrations/020_product_specs.sql"
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/migrations/021_order_customer_comment.sql"
```

Перед миграцией `003` обязательно сделать `pg_dump` из раздела выше. После неё
проверить `\d orders`, `\d store_settings`, `\d order_admin_events` и только затем
перезапускать приложение. Не запускать seed на действующей БД без отдельной
необходимости: он предназначен для первоначального наполнения.

## Telegram-уведомления о заказах

Перед включением в `/admin/settings/notifications` добавить в
`/var/www/mavita-repo/shop/.env` ключ, сгенерированный на самом сервере:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Сохранить результат как `TELEGRAM_SETTINGS_ENCRYPTION_KEY=<значение>` и
перезапустить PM2. Ключ расшифровывает токен бота в БД: не менять и не терять
его без повторного ввода токена в админке.

> Статус прода (2026-06-23): `TELEGRAM_SETTINGS_ENCRYPTION_KEY` сгенерирован и
> добавлен в `.env`, PM2 перезапущен; systemd service+timer установлены и
> активны (ежеминутно), smoke-run раннера прошёл; токен бота и chat_id введены,
> канал включён (`enabled=true`).
>
> `api.telegram.org` недоступен с прод-сервера (РФ-хостинг блокирует диапазоны
> Telegram: curl и по IPv4 `149.154.166.110`, и по IPv6 — таймаут, при этом
> обычный интернет работает). РЕШЕНО через egress-прокси (см. ниже): доставка
> подтверждена 2026-06-23 — события заказов №11/№12 ушли в чат (`status=sent`).
>
> Баг включения без повторного ввода токена ИСПРАВЛЕН (2026-06-23,
> `lib/telegram-settings.ts`): `saveTelegramSettings` кладёт в INSERT `VALUES`
> уже эффективные значения токена (новый или сохранённый), иначе строка-кандидат
> INSERT (`enabled=true` + `ciphertext=NULL`) нарушала `enabled_check` — Postgres
> проверяет CHECK на кандидате до разрешения `ON CONFLICT → UPDATE`.

Установить systemd unit `/etc/systemd/system/mavita-notifications.service`
(отдельного пользователя `mavita` на сервере нет — сервис идёт под root, как PM2
и владелец `.env`; `tsx` уже стоит в `node_modules`, отдельный `npm ci` не нужен):

```ini
[Unit]
Description=Mavita Telegram notification outbox

[Service]
Type=oneshot
WorkingDirectory=/var/www/mavita-repo/shop
EnvironmentFile=/var/www/mavita-repo/shop/.env
ExecStart=/usr/bin/npm run notifications:drain
```

И timer `/etc/systemd/system/mavita-notifications.timer`:

```ini
[Unit]
Description=Run Mavita Telegram notification outbox every minute

[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true

[Install]
WantedBy=timers.target
```

Применить и проверить:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mavita-notifications.timer
systemctl list-timers mavita-notifications.timer
sudo systemctl start mavita-notifications.service
journalctl -u mavita-notifications.service -n 30 --no-pager
```

### Таймер СДЭК автоотправки (mavita-cdek)

Воркер создаёт отправления в СДЭК и получает PDF-накладные. Аналог mavita-notifications.

Установить `/etc/systemd/system/mavita-cdek.service`:

```ini
[Unit]
Description=Mavita CDEK outbox drain

[Service]
Type=oneshot
WorkingDirectory=/var/www/mavita-repo/shop
EnvironmentFile=/var/www/mavita-repo/shop/.env
ExecStart=/usr/bin/npm run cdek:drain
```

И `/etc/systemd/system/mavita-cdek.timer`:

```ini
[Unit]
Description=Run Mavita CDEK outbox every minute

[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true

[Install]
WantedBy=timers.target
```

Применить и проверить:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mavita-cdek.timer
systemctl list-timers mavita-cdek.timer
sudo systemctl start mavita-cdek.service
journalctl -u mavita-cdek.service -n 30 --no-pager
```

#### Печатные формы СДЭК

`poll_waybill` получает две PDF-ссылки: накладную и штрихкод. Правильные вызовы:

- накладная: `POST /v2/print/orders` с `type='tpl_russia'`, затем
  `GET /v2/print/orders/{print_task_uuid}`;
- штрихкод: `POST /v2/print/barcodes` с `format='A4'`, `lang='RUS'`, затем
  `GET /v2/print/barcodes/{print_task_uuid}`;
- готовность формы определяется по `entity.statuses[].code == 'READY'`, URL лежит
  в `entity.url`.

Не использовать `type='waybill'` или `type='barcode'` в `/print/orders`: sandbox
СДЭК 2026-06-29 вернул на это `v2_invalid_format`. После деплоя фикса на prod,
если в `cdek_task_outbox` остались failed-задачи `poll_waybill` со старой ошибкой
`Накладная не была сгенерирована за 3 часа`, их можно вернуть в очередь:

```sql
UPDATE cdek_task_outbox
SET status='pending',
    available_at=now(),
    locked_at=NULL,
    done_at=NULL,
    last_error=NULL
WHERE task_type='poll_waybill'
  AND status='failed'
  AND last_error='Накладная не была сгенерирована за 3 часа';
```

Затем разово запустить воркер и проверить журнал:

```bash
sudo systemctl start mavita-cdek.service
journalctl -u mavita-cdek.service -n 30 --no-pager
```

### Read-only readiness check перед следующим реальным заказом

Без создания тестового заказа можно прогнать сводную проверку готовности
пост-синхронизационного контура СДЭК:

```bash
cd /var/www/mavita-repo/shop
npm run cdek:readiness
# или машинно-читаемый вывод
npm run cdek:readiness -- --json
```

Скрипт проверяет:
- env-гейты (`DATABASE_URL`, `SETTINGS_ENC_KEY`, `NEXT_PUBLIC_BASE_URL`, `DELIVERY_ENABLED`);
- текущий delivery-mode checkout;
- сохранённые credentials СДЭК + live probe `Москва → city_code → pickup points`;
- настройки автоотправки (`shipmentPoint`, отправитель, `cdek_auto_shipment_enabled`);
- наличие `webhookUuid` в БД и достижимость публичного `/api/cdek/webhook`;
- systemd-таймеры `mavita-cdek.timer` и `mavita-notifications.timer`;
- health БД: `cdek_task_outbox`, следы `cdek_status_update`, исторические `cdek_order_uuid/waybill/barcode`.

`READY` означает, что контур готов конфигурационно; `WARN` по блоку evidence
ожидаем, если автоотправка включена после исторических заказов и следующий
реальный заказ должен стать первым боевым подтверждением `auto-shipment → webhook
→ waybill/barcode`.

После установки: в админке **Настройки → Доставка** заполнить точку сдачи, данные
отправителя, нажать **«Зарегистрировать вебхук»**, затем **«Сохранить»** и включить
автосоздание накладных (чекбокс). Вебхук нужен чтобы СДЭК слал статусы обратно:
URL вебхука `https://mavita.ru/api/cdek/webhook?secret=<случайный uuid>`.

> С миграции 019 регистрация вебхука вшивает в URL случайный секрет (СДЭК не
> подписывает вебхуки HMAC — секрет в URL единственная аутентификация). Секрет
> хранится в `store_settings.cdek_webhook_secret`; события без него/с чужим
> игнорируются (в лог пишется предупреждение). Если вебхук регистрировался ДО
> миграции — просто нажать «Зарегистрировать вебхук» ещё раз: старая регистрация
> в СДЭК заменится URL-ом с секретом.

### Egress-прокси для Telegram (обход РФ-блокировки)

`api.telegram.org` режется с прод-хоста, поэтому исходящие вызовы Telegram идут
через лёгкий CONNECT-прокси на сервере **rezerv** (`45.145.14.166`, egress вне
блокировки):

- На rezerv: `tinyproxy` (порт 8888), `Allow 45.130.147.108` (только mavita) +
  `ConnectPort 443`; `systemctl enable --now tinyproxy`.
- В `.env` прода: `TELEGRAM_HTTPS_PROXY=http://45.145.14.166:8888`.
- Sender (`lib/telegram-notifications.ts`) при заданной переменной шлёт
  `sendMessage` через undici `ProxyAgent` (зависимость `undici`). URL остаётся
  `api.telegram.org`; CONNECT — сквозной TLS, токен прокси не виден.
- Проверка пути:
  `ssh mavita 'curl -x http://45.145.14.166:8888 https://api.telegram.org/'` →
  быстрый `302`.

Если rezerv недоступен — уведомления копятся в outbox и ретраятся, без потерь.

В первом релизе Telegram-сообщения не содержат персональных данных покупателя.

## Текущий rollout: СДЭК-ПВЗ и автосоздание накладных

На production доставка СДЭК-ПВЗ включена: `DELIVERY_ENABLED=true`, Робокасса в
боевом режиме, ключи СДЭК хранятся зашифрованными в настройках БД, а
`cdek_auto_shipment_enabled` управляет только постановкой новых `create_shipment`
задач после оплаты.

Инварианты текущего режима:

- в прод-`.env` не задавать `CDEK_API_BASE`: код должен ходить в боевой
  `https://api.cdek.ru/v2`;
- не возвращать `CDEK_CLIENT_ID`/`CDEK_CLIENT_SECRET` в `.env`, если ключи уже
  перенесены в encrypted settings;
- после правок в CDEK worker выполнять `npm run build`, `pm2 reload mavita
  --update-env`, затем `sudo systemctl start mavita-cdek.service`;
- если были failed-задачи `poll_waybill` со старой ошибкой генерации PDF, вернуть
  их в очередь SQL-командой из раздела «Печатные формы СДЭК».

---

## Включение СДЭК-ПВЗ с нуля (боевой запуск, живой API)

Сценарий: договор с СДЭК заключён, на руках **боевые** ключи (`client_id` +
`client_secret`), которых раньше **не было** в `.env`. Тогда первичный rollout
«.env → БД» из раздела «Ключи перевозчиков» не нужен — ключи вводятся сразу в
админке. Кода писать не нужно: мультиперевозчиковый ПВЗ-чекаут уже собран и
покрыт тестами (`lib/cdek.ts`, `/api/cdek`, `checkout`, `resolveDeliveryMode`).

> ⚠️ **Главный гейт — `DELIVERY_ENABLED`.** `resolveDeliveryMode()` сначала
> проверяет `process.env.DELIVERY_ENABLED === 'false'` (`emergencyOff`) и при нём
> возвращает `disabled` **независимо** от ключей и `cdek_pickup_enabled` в БД.
> Для активного СДЭК-режима на prod должно быть `DELIVERY_ENABLED=true` или строка
> должна отсутствовать.

> ⚠️ **Боевой vs тестовый хост.** `lib/cdek.ts` по умолчанию ходит на боевой
> `https://api.cdek.ru/v2`. В прод-`.env` **не должно быть** `CDEK_API_BASE`,
> указывающего на тестовый `api.edu.cdek.ru`: боевые ключи там дадут 401/403
> (`auth_failed` на «Проверить связь»). IP-whitelisting/egress-прокси у СДЭК
> проявятся так же.

Порядок (только настройка + перезапуск, без деплоя кода):

1. **Калибровка тарифа.** Измерить готовые коробки (1 свеча / 2 / набор), снять
   в калькуляторе/ЛК СДЭК цену из фактического города отправки до СПб, Москвы,
   миллионника, Сибири и ДВ; в расход включить упаковку, объявленную стоимость и
   возможный возврат невостребованной посылки. Утвердить **один** фикс-тариф ПВЗ
   с запасом (зоны/курьер — отдельный инкремент).
2. **Ключи в админке** `/admin/settings/delivery`: ввести `client_id` +
   `client_secret` СДЭК, **не включая** перевозчик и без тарифа.
3. **«Проверить связь»** → ожидаем `ok` с числом точек по Москве. `auth_failed` →
   ключи/хост/whitelisting (см. гейт хоста). `unavailable` → сеть/таймаут/прокси.
4. Задать `deliveryKopecks` = утверждённый тариф (в копейках) и включить
   `cdek_pickup_enabled` (включение упадёт `CARRIER_INCOMPLETE`, если ключ или
   тариф не заданы — это защита, а не ошибка).
5. **Снять глобальный гейт** в прод-`.env`: заменить `DELIVERY_ENABLED=false` на
   `DELIVERY_ENABLED=true` (или удалить строку — `emergencyOff` срабатывает только
   на литерал `'false'`) и `pm2 reload mavita --update-env`.
6. **Сверить публичные страницы** `/delivery` и `/privacy`: текст про ПВЗ СДЭК и
   передачу данных перевозчику теперь соответствует включённому режиму.
7. **Тестовая покупка на проде** (Робокасса в боевом режиме с 2026-06-21): поиск
   ПВЗ по реальному городу → выбор точки → оплата. Проверить, что заказ `paid`,
   snapshot ПВЗ и `delivery_kopecks` корректны, `items + delivery = total`, пришло
   Telegram-уведомление.
8. **Ручной операционный цикл** на этом заказе: оформить накладную в ЛК СДЭК,
   внести трек в админку, провести через `packing → handed_to_carrier`.
9. **Валидировать отложенный CHECK** после внесения боевых ключей:
   ```sql
   ALTER TABLE store_settings VALIDATE CONSTRAINT store_settings_cdek_complete_check;
   ```
10. **Калибровка:** зафиксировать первые 20–30 отправок (город/вес/габариты/
    факт-счёт СДЭК/доплаты/срок) → решение по зонам, курьеру или следующему
    перевозчику на базе `docs/specs/delivery-options.md`. Старый ручной план
    СДЭК сохранён как `docs/specs/done/cdek-manual-launch.md`.

### Выбор города и ПВЗ на чекауте

Покупатель не вводит код города и не видит весь национальный список. Поток:

- город определяется по IP (префилл, см. MaxMind ниже) и/или вводится с
  автокомплитом — `/api/cdek/cities?q=` возвращает реальные города СДЭК с
  числовым `city_code`;
- по выбранному городу `/api/cdek?cityCode=<код>` отдаёт ПВЗ этого города
  (`type=PVZ`), список фильтруется по адресу/названию на клиенте;
- `getPickupPoint(code)` повторно валидирует выбранную точку в `robokassa/init`.

> Раньше `/api/cdek?city=<название>` уходил в СДЭК как параметр `city`, который
> API игнорирует, и возвращался **весь** список ПВЗ по стране (~10k). Фильтр СДЭК —
> только по `city_code`; свободный текст больше не используется. На «Проверить
> связь» (`Москва`) теперь видно реальное число точек города, а не ~9939.

### Префилл города по IP — MaxMind GeoLite2 (опционально)

Город угадывается по IP локальной базой MaxMind (IP покупателя никуда не уходит).
Фича необязательна: нет базы → город просто не подставляется, автокомплит работает.

1. Зарегистрировать бесплатный аккаунт MaxMind, скачать **GeoLite2-City.mmdb**.
2. Положить на VPS, напр. `/var/www/mavita-repo/shop/data/GeoLite2-City.mmdb`
   (каталог `data/` не перетирается rsync-деплоем — он не в списке исключений, так
   что класть в отдельную папку и НЕ синхронизировать поверх).
3. В `.env`: `GEOIP_DB_PATH=/var/www/mavita-repo/shop/data/GeoLite2-City.mmdb`,
   затем `pm2 reload mavita --update-env`.
4. Базу обновлять периодически (GeoLite2 выходит обновлениями); путь не меняется.

Проверка: на чекауте поле города предзаполнено вашим городом. Если пусто — база
не найдена/не читается (см. `pm2 logs`), но оформление при этом не ломается.

---

## Переключить Робокассу на боевой режим (Пауза 1)

Только с явного подтверждения владельца.

```bash
ssh mavita "sed -i 's/ROBOKASSA_TEST_MODE=true/ROBOKASSA_TEST_MODE=false/' \
  /var/www/mavita-repo/shop/.env && \
  pm2 reload mavita --update-env"
```

---

## PM2 — базовые команды

```bash
pm2 status                   # состояние процессов
pm2 logs mavita --lines 50   # последние логи
pm2 reload mavita --update-env  # перезапуск с обновлёнными env
pm2 save                     # сохранить список процессов (для автостарта)
```

---

## Nginx

```bash
nginx -t                     # проверить конфиг
systemctl reload nginx       # применить без даунтайма
tail -20 /var/log/nginx/access.log   # последние запросы
```

Для login rate-limit Node получает доверенный IP только через Nginx. В `location`,
который проксирует приложение, обязательно:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Не использовать здесь `$proxy_add_x_forwarded_for`: клиент мог прислать свой
`X-Forwarded-For`. Порт Node/PM2 не должен быть доступен напрямую из интернета.

Также обязателен `proxy_set_header Host $host;` — на нём держится same-origin
проверка админки (I8). За прокси `next start` строит `request.url` как `http://`,
поэтому `assertSameOrigin` сверяет хост `Origin` с `Host`, а не полный origin.
Если `Host` не проброшен — вход в админку падает «Неверный Origin» (см. TD-22).

После деплоя Ф4 ежедневно запускать очистку аварийных orphan-файлов (скрипт
удаляет только UUID-файлы без записи в БД и старше часа):

```cron
15 3 * * * cd /var/www/mavita-repo/shop && node scripts/cleanup-product-uploads.mjs
```

---

## Ключи перевозчиков доставки (СДЭК)

Секреты перевозчиков хранятся в `store_settings` **шифрованными** (AES-256-GCM).
Мастер-ключ `SETTINGS_ENC_KEY` — только в `.env` (64 hex-символа или canonical
base64, ровно 32 байта). **Потеря ключа = потеря всех ключей перевозчиков**; бэкап
мастер-ключа хранить отдельно от backup БД.

### Первичный rollout СДЭК (.env → БД), без скрытого отключения доставки

1. Backup БД. Убедиться, что `SETTINGS_ENC_KEY` задан и декодируется в 32 байта.
   Старые `CDEK_CLIENT_*` пока **не удалять**.
2. Применить миграции `005_delivery_multi_carrier.sql`, `006_delivery_carrier_secrets.sql`,
   `007_delivery_test_rate_limit.sql`. Старый runtime продолжает работать от `.env`.
3. Перенести ключи в БД одним из способов (старый runtime ещё обслуживает витрину):
   - backfill: `SETTINGS_ENC_KEY=… CDEK_CLIENT_ID=… CDEK_CLIENT_SECRET=… DATABASE_URL=… npx tsx scripts/backfill-delivery-credentials.ts`
     (тариф СДЭК должен быть уже задан в `store_settings`, иначе включение упадёт);
   - или ввести ключи в админке «Доставка», нажать «Проверить связь», включить.
4. Проверить `/api/checkout/delivery` и оформить тестовый заказ. Затем выпустить
   новый код (он читает только DB-credentials). Откат возможен, пока env-ключи целы.
5. После подтверждённого rollout удалить `CDEK_CLIENT_SECRET`, `CDEK_CLIENT_ID` из `.env`.
6. После заполнения боевых ключей валидировать отложенный CHECK:
   ```sql
   ALTER TABLE store_settings VALIDATE CONSTRAINT store_settings_cdek_complete_check;
   ```

Если окно требует выключить доставку — выставить `DELIVERY_ENABLED=false` (только
этот глобальный выключатель легитимно создаёт заказы без ПВЗ).

### Ротация `SETTINGS_ENC_KEY` (офлайн, обязательно с backup)

1. Backup БД; включить maintenance; остановить все app/worker-процессы (PATCH,
   «Проверить связь» и checkout на это время недоступны — осознанное короткое окно).
2. Задать одновременно `SETTINGS_ENC_KEY_OLD` (текущий) и `SETTINGS_ENC_KEY` (новый):
   ```
   SETTINGS_ENC_KEY_OLD=<старый> SETTINGS_ENC_KEY=<новый> DATABASE_URL=… \
   npx tsx scripts/rotate-delivery-settings-key.ts
   ```
   Скрипт под блокировкой singleton перешифровывает все секреты и проверяет каждый.
3. При ошибке транзакция откатывается — старый ключ остаётся рабочим. При успехе:
   убрать `SETTINGS_ENC_KEY_OLD`, поднять приложение только с новым ключом.
4. Rollback после успешного commit = восстановление backup БД **и** старого ключа.

---

## Запрещено на production

- Прямой `UPDATE` в БД в обход API (нарушает I4).
- `rm -rf` в `/var/www/mavita-repo/shop/public/uploads/` без удаления записей из `product_images`.
- Коммит `.env` с реальными секретами.
- Переключение `ROBOKASSA_TEST_MODE=false` без Паузы 1.
- Действия на VPS без явного подтверждения (контракт агента).
