# МАВИТА-ШОП operations runbook

Дата актуализации: 2026-06-21. URL, ключи и запреты — в `docs/environments.md`.

---

## Деплой на production

```bash
# 1) синхронизировать код (секреты, node_modules, .next, фото — не трогаем)
rsync -avz \
  --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='public/uploads' \
  shop/ mavita:/var/www/mavita-repo/shop/

# 2) если изменились package.json или package-lock.json — установить точные зависимости
ssh mavita "cd /var/www/mavita-repo/shop && npm ci"

# 3) пересобрать и перезапустить
ssh mavita "cd /var/www/mavita-repo/shop && npm run build && pm2 reload mavita --update-env"
```

Проверка: `curl -s https://mavita.ru/api/products | head -c 50`

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
> ⚠️ **БЛОКЕР ДОСТАВКИ: `api.telegram.org` недоступен с прод-сервера.** Проверено
> 2026-06-23: curl до Telegram и по IPv4 (`149.154.166.110`), и по IPv6 —
> таймаут (`code=000`, exit 28), при этом обычный интернет работает (`ya.ru` —
> 302 за 0.2с). Это блокировка диапазонов Telegram на российском хостинге, не
> наш баг. Очередь копит события со статусом `pending`/`failed` и
> `last_error = network: ... timeout`. Для доставки нужен сетевой путь до
> Telegram: исходящий прокси (undici `ProxyAgent`/SOCKS), собственный
> Bot-API-реверс-прокси на не-РФ хосте, либо запуск раннера с внешнего хоста.
> Решение за владельцем — без него уведомления не уходят.
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

В первом релизе Telegram-сообщения не содержат персональных данных покупателя.

## Текущий rollout: заказы без СДЭК

В релизе Ф4-К2 код доставки уже присутствует, но до отдельного решения по СДЭК
на VPS должна быть строка `DELIVERY_ENABLED=false`. При этом checkout создаёт
заказ без ПВЗ, `delivery_kopecks=0`, а проверять можно обычный платёжный флоу.
Не добавлять `CDEK_CLIENT_ID`/`CDEK_CLIENT_SECRET` и не включать доставку в рамках
этого rollout: это отдельная внешняя интеграция (Пауза 2).

> Перед открытием checkout покупателям сверить публичные `/delivery` и `/privacy`:
> текущий текст страниц описывает ПВЗ СДЭК и передачу данных перевозчику, тогда
> как выключенный режим этого не делает. Либо обновить/скрыть этот текст отдельным
> изменением кода, либо не публиковать его как действующее условие до включения СДЭК.

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

## Ключи перевозчиков доставки (СДЭК / Ozon)

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
5. После подтверждённого rollout удалить `CDEK_CLIENT_SECRET`, `CDEK_CLIENT_ID`,
   `OZON_API_KEY`, `OZON_CLIENT_ID` из `.env`.
6. После заполнения боевых ключей валидировать отложенные CHECK:
   ```sql
   ALTER TABLE store_settings VALIDATE CONSTRAINT store_settings_cdek_complete_check;
   ALTER TABLE store_settings VALIDATE CONSTRAINT store_settings_ozon_complete_check;
   ```

Если окно требует выключить доставку — выставить `DELIVERY_ENABLED=false` (только
этот глобальный выключатель легитимно создаёт заказы без ПВЗ).

### Каталог ПВЗ Ozon (обязателен до включения Ozon)

Поиск ПВЗ Ozon у клиента идёт по локальной таблице `ozon_pickup_points`, потому что
живой `point/list` отдаёт только id+координаты, а город/адрес — отдельным
`point/info` батчами ≤100. Синхронизация (`scripts/sync-ozon-pickup-points.ts`)
помечает все id прохода `run_id` и фиксирует состояние в `ozon_catalog_sync`.

**Синхронизация НЕ удаляет точки (защита целостности).** Финализация:
- считает реальный overlap среди активных точек в одной транзакции под блокировкой;
- при существенном расхождении (не подтверждено > 2% активных, `MIN_OVERLAP_RATIO`)
  — статус `failed`, **активная выдача не меняется** (новые точки остаются скрытыми,
  существующие активные не скрываются), и шлёт **алерт** (Telegram-канал
  заказов, если настроен; иначе stderr) + ненулевой код выхода для `OnFailure=`;
- иначе точку, отсутствующую **два полных прохода подряд** (`missed_runs`), лишь
  **СКРЫВАЕТ** (`active=false`) — это обратимо: вернулась в `point/list` → снова
  активна. Поиск отдаёт только `active`. Точки не удаляются — потери данных нет.

**Гейт свежести:** успешная полная синхронизация не старше 48 ч — необходимая
техническая проверка `resolveDeliveryMode` и `saveCarrierSettings`. Она сама по
себе не разрешает включить Ozon на checkout: действует дополнительный блокер
FBS-каталога ниже. Несвежий каталог не роняет checkout — Ozon просто перестаёт
предлагаться, СДЭК остаётся.

Запуск вручную (~90k точек, ~900 вызовов; есть таймаут/ретраи и взаимное исключение):

```bash
cd /var/www/mavita-repo/shop && set -a && . ./.env && set +a && npm run delivery:sync-ozon
```

Ежедневно — **через systemd с `EnvironmentFile`** (cron не подхватывает `.env`;
`$SETTINGS_ENC_KEY`/`$DATABASE_URL` в crontab будут пустыми):

```ini
# /etc/systemd/system/mavita-ozon-sync.service
[Unit]
# Доп. эскалация на падение поверх алерта из скрипта (см. ниже).
OnFailure=mavita-alert@%n.service
[Service]
Type=oneshot
WorkingDirectory=/var/www/mavita-repo/shop
EnvironmentFile=/var/www/mavita-repo/shop/.env
ExecStart=/usr/bin/npm run delivery:sync-ozon
User=www-data
```
Сам скрипт при `low_overlap`/падении шлёт алерт в Telegram-канал заказов и **проверяет
факт доставки** (`response.ok`): при недоставке (нет Telegram, неверный chat id/токен,
429/5xx) пишет об этом в лог. Так как Telegram может не сработать, обязательна
**вторая, независимая линия** через `OnFailure=` — конкретный unit ниже шлёт хвост
журнала на отдельный webhook (`ALERT_WEBHOOK_URL` из `.env`):

```ini
# /etc/systemd/system/mavita-alert@.service
[Service]
Type=oneshot
EnvironmentFile=/var/www/mavita-repo/shop/.env
# %i — имя упавшего юнита; шлём последние строки его журнала на независимый канал.
ExecStart=/bin/sh -c 'curl -fsS -m 10 -X POST "$ALERT_WEBHOOK_URL" --data-urlencode "text=МАВИТА: юнит %i упал. $(journalctl -u %i -n 20 --no-pager | tail -c 1500)"'
User=www-data
```
`ALERT_WEBHOOK_URL` — независимый от Telegram канал (Slack/Telegram-бот мониторинга/
почтовый relay). Без него `OnFailure` молча ничего не отправит, поэтому задайте его в
`.env` до включения Ozon в продакшене.
```ini
# /etc/systemd/system/mavita-ozon-sync.timer
[Timer]
OnCalendar=*-*-* 15:30:00
Persistent=true
[Install]
WantedBy=timers.target
```
`systemctl enable --now mavita-ozon-sync.timer`. Если всё же cron — обязательно
сорсить `.env`: `cd …/shop && set -a && . ./.env && set +a && npm run delivery:sync-ozon`.

Миграции `005`–`009`, ключи и синхронизация ПВЗ готовят только справочник точек.
Они **не** разрешают включать Ozon-перевозчика на checkout: до завершения
[FBS-каталога](specs/ozon-fbs-catalog-sync.md) и отдельной фазы order/create
оставить его выключенным, даже если «Проверить связь» успешно.

### Блокер: технический FBS-каталог без витрины Ozon (2026-06-21)

Проверка отдельным ключом показала: стандартный import тестовой карточки
`mavita-9` без отправки остатка создал карточку со статусом `VISIBLE` и
`MODERATED`; Ozon автоматически выдал ей штрихкод. Нулевой остаток **не скрывает**
товар от витрины. Карточка сразу переведена обратимым `POST /v1/product/archive`
в `INVISIBLE`; удаление не использовалось. Архивирование не гарантирует
недоступность по старой прямой ссылке: Ozon указывает срок до 30 дней в своей
[документации](https://docs.ozon.com/global/en/products/upload/created-pdp/archive/).

Не импортировать новые товары, не разархивировать `mavita-9` и не отправлять
FBS-остатки, пока Ozon письменно не подтвердит отдельный режим непубличной
технической карточки для Ozon Доставки. Archive не является решением для
синхронизации: товар нельзя держать доступным для FBS-остатка и одновременно
гарантированно скрытым стандартным import-потоком.

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
