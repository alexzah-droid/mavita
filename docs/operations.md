# МАВИТА-ШОП operations runbook

Дата создания: 2026-06-20. URL, ключи и запреты — в `docs/environments.md`.

---

## Деплой на production

```bash
# 1) синхронизировать код (секреты, node_modules, .next, фото — не трогаем)
rsync -avz \
  --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='public/uploads' \
  shop/ mavita:/var/www/mavita-repo/shop/

# 2) пересобрать и перезапустить
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

## Применить схему или seed

```bash
# Идемпотентно (IF NOT EXISTS)
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/schema.sql"
ssh mavita "sudo -u postgres psql -d mavita -f /var/www/mavita-repo/shop/sql/seed.sql"
```

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

После реализации Ф4 ежедневно запускать очистку аварийных orphan-файлов (скрипт
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
