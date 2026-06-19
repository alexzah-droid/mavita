# МАВИТА-ШОП operations runbook

> Создать как `docs/operations.md` вместе с первым деплоем на VPS.
> URL, ключи и запреты не дублировать здесь — они живут в `docs/environments.md`.

## Деплой на production

Только после Паузы 1.

```bash
# На VPS
cd /var/www/mavita
git pull origin main
npm ci --production
npm run build
pm2 reload mavita
```

## Откат

```bash
git revert <commit> && git push
# затем повторить деплой
pm2 reload mavita
```

Проверка отката: `curl https://<domain>/api/health` → 200.

## Backup / restore PostgreSQL

### Backup

```bash
pg_dump -U mavita mavita > /backups/mavita_$(date +%Y%m%d_%H%M%S).sql
```

### Restore

```bash
psql -U mavita mavita < /backups/mavita_<timestamp>.sql
```

## Миграции схемы

Порядок:

1. локально на копии;
2. production после backup и Паузы 1.

Необратимая конверсия данных = Пауза 2.

```bash
psql -U mavita mavita -f sql/migrations/<migration>.sql
```

## Ротация фото

Загруженные фото живут в `/var/www/mavita/public/uploads/products/`.
Удаление через admin-панель — API атомарно удаляет файл и запись в `product_images`.
Прямое удаление через `rm` без удаления записи в БД — запрещено (нарушает I5).

## Запрещено на production

См. `docs/environments.md` §Запреты.
