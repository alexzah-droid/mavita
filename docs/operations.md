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

После `npm ci` установить systemd unit `/etc/systemd/system/mavita-notifications.service`:

```ini
[Unit]
Description=Mavita Telegram notification outbox

[Service]
Type=oneshot
User=mavita
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

## Запрещено на production

- Прямой `UPDATE` в БД в обход API (нарушает I4).
- `rm -rf` в `/var/www/mavita-repo/shop/public/uploads/` без удаления записей из `product_images`.
- Коммит `.env` с реальными секретами.
- Переключение `ROBOKASSA_TEST_MODE=false` без Паузы 1.
- Действия на VPS без явного подтверждения (контракт агента).
