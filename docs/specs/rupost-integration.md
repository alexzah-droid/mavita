# Спека: Почта России + мультиперевозчиковый чекаут

**Статус:** **готово к реализации** (wire-контракт подтверждён live-исследованием 2026-06-24; §2/§3/§5 синхронизированы).
**Дата:** 2026-06-24 (ревизия 5 — live-исследование официальной спецификации)
**Зависимости:** миграции 003–012 применены; `SETTINGS_ENC_KEY` в `.env`
**Спецификация otpravka:** https://otpravka.pochta.ru/specification (раздел Authorization, Clean, Backlog/Shipment, Batch, Forms)

> **Подтверждено live-исследованием 2026-06-24:**
> 1. Базовый URL — `https://otpravka-api.pochta.ru`; авторизация всегда парой `Authorization: AccessToken <token>` + `X-User-Authorization: Basic <key>`.
> 2. `<key>` — уже готовый `base64(login:password)` из ЛК otpravka. Хранится в БД зашифрованным (`rupost_user_auth_key_enc`); вводится через AdminPanel.
> 3. `PUT /1.0/user/backlog` создаёт заказ в «Неразобранном» и возвращает внутренний id. ШПИ появляется только при формировании партии через `POST /1.0/user/shipment`.
> 4. Принадлежность одного backlog-заказа читается напрямую: `GET /1.0/shipment/{id}` возвращает `batch-name` и `barcode`; состав партии — пагинированный `GET /1.0/batch/{name}/shipment`.
> 5. Формы: `GET /1.0/forms/{id}/f7pdf` и `GET /1.0/forms/{batch-name}/f103pdf`; check-in: `POST /1.0/batch/{batch-name}/checkin`; безопасная проверка доступа: `GET /1.0/settings`.
>
> **Осталось проверить с реальными учётными данными:** допустимые для договора `mail-type`/поля backlog, дедупликацию `order-num` после таймаута и повторный check-in. До первого live-вызова флоу партий останавливается в `needs_review` при неоднозначном remote-ответе.

---

## 0. История ревизий

### Ревизия 5 — live-исследование otpravka (2026-06-24)
| Факт официальной спецификации | Изменение решения |
|---|---|
| Ключ пользователя — готовый Base64 `login:password`, используется как `Basic <key>` | Убраны `RUPOST_LOGIN`/`RUPOST_PASSWORD` и ошибочный SHA-256. Токен и ключ шифруются в `store_settings` отдельными полями. |
| Backlog не назначает ШПИ | `created` заменён на `backlog`: после оплаты есть только `remote_id`; `barcode` появляется при создании удалённой партии. |
| Партия создаётся `POST /1.0/user/shipment` из remote ID | Уточнён `createBatch`; прежний `POST /1.0/batch` запрещён. |
| Для заказа есть прямой `GET /1.0/shipment/{id}` | Reconciliation партии проверяет членство без сканирования всех партий; пагинация нужна лишь для сверки состава. |
| Формы и check-in имеют другие пути | Зафиксированы `f7pdf`, `f103pdf`, `POST /batch/{name}/checkin`, `GET /settings`. |

### Ревизия 4 — claim-token P0 + честные гарантии партий (3-е ревью)
| Замечание | Решение в ревизии 4 |
|-----------|---------------------|
| **P0** У claim нет владельца: после TTL-возврата поздний ответ 1-го воркера пишет результат в claim 2-го | Добавлен **`claim_token UUID`** в `rupost_shipments` и `rupost_batches`. Claim ставит новый токен; каждый settle/UPDATE требует `AND claim_token=$token`; sweep обнуляет токен при TTL-возврате. Поздний `UPDATE … WHERE claim_token=$tokenA` → 0 строк. §2, §3, §9.2, §10 |
| **P1** Гарантия «дубль партии исключён» опиралась на непроверенный wire-контракт | Статус спеки → «готово к API-валидации». Reconciliation партии при неоднозначности (нет membership / разные партии / неполный/пагинированный список / API не даёт состав) **останавливается в `needs_review`** для ручного разбора, БЕЗ повторного `createBatch`. §10, шапка |
| **P2** Rate-limit нельзя переиспользовать из миграции 007 (требует `actor_login_at`, checkout анонимный) | Заведена отдельная таблица **`rupost_normalize_attempts (ip, session_key, created_at)`** в миграции 013; лимит по IP/session, без actor. §3, §4 |
| (следствие) Партия получила idle/claimed разделение | Статусы партии: `pending_create`/`pending_checkin` (idle) ↔ `creating`/`checking_in` (claimed, токен) + `needs_review`. Управляется тем же воркером `rupost:drain`. §2, §10 |

### Ревизия 3 — блокеры 2-го ревью
| Замечание | Решение в ревизии 3 |
|-----------|---------------------|
| **P0** Воркер допускал параллельное создание (claim ставил только `locked_at`, статус оставался `pending`) | Добавлен статус **`creating`** в state machine. Claim переводит `pending\|failed → creating` в одной транзакции **до** внешнего вызова — второй воркер строку не видит. Зависшие `creating` возвращает sweep по TTL (10 мин). §2, §9.2 |
| **P1** `remote_id` нужен, но его не было в миграции | `remote_id BIGINT` добавлен в `rupost_shipments`: обязателен для `backlog`/`batch_pending`/`in_batch`/`handed` (state-check), partial UNIQUE при `IS NOT NULL`. §2, §3 |
| **P1** Операции над партией имели тот же разрыв идемпотентности | Партия получила полноценную state machine `creating → open → checking_in → checked_in → handed` + поля ретраев. createBatch/checkIn идут через локальный барьер `creating`/`checking_in` → remote → reconciliation по составу (`findBatchByMembership`). Вторая удалённая партия исключена. §2, §10 |
| Hardening публичного `/normalize` | Rate limit (механизм миграции 007), лимит длины адреса (≤300), таймаут к Почте (5с), обобщённое сообщение об ошибке, без записи в БД. §4 |
| `failed` допускал barcode / в партии | `failed` строго до создания: `barcode`/`remote_id`/`batch_id` все NULL. Ошибки уровня партии — в state machine партии, не в `failed`. §2 |

### Ревизия 2 — P0/P1/P2 первого ревью
| Замечание | Решение в ревизии 2 |
|-----------|---------------------|
| **P0** Создание отправления в callback не идемпотентно | Убрали синхронный вызов Почты из `robokassa/result`. Введена таблица-сущность `rupost_shipments` (UNIQUE по `order_id`) со своим жизненным циклом и ретраями. Enqueue — внутри транзакции `markOrderPaid`. Отдельный воркер `rupost:drain` создаёт отправление с reconciliation (search-before-create по `order-num`). §2, §9 |
| **P1** Нет модели партии для Ф103 | Введена сущность `rupost_batches` (remote `batch_name`, дата сдачи, статус) и связь `rupost_shipments.batch_id`. §2, §10 |
| **P1** Контракт создания не определён, адрес не нормализуется | Адрес нормализуется через `POST /1.0/clean/address` **на чекауте до оплаты**, снимок сохраняется в заказе. Typed-контракт, единицы (копейки/граммы), `rupost_sender_*` в input, модель ошибок. §4, §5 |
| **P1** Авто-трек конфликтует с `transitionFulfillment` | Трек (barcode) живёт в `rupost_shipments.barcode`, НЕ в `orders.tracking_number` до сдачи. §11 |
| **P1** Псевдокод callback не соответствует API | `markOrderPaid` возвращает только статус — внешний вызов убран из callback совсем. Enqueue тем же `client` внутри транзакции. §9 |
| **P2** Constraint разрешает неконсистентные состояния | `orders.tracking_number` и его constraint НЕ трогаем. Ранний barcode — в `rupost_shipments.barcode`. §2, §3 |
| `declaredValue = total_kopecks` неверно | Объявленная ценность = **`items_kopecks`** (стоимость вложения, без доставки). §5 |

---

## 1. Контекст и решения

### Что добавляем
- Новый перевозчик **Почта России** (otpravka.pochta.ru API, токен уже есть; договор оформлен как самозанятый)
- Адресная доставка: клиент вводит ФИО + адрес + индекс — вместо выбора ПВЗ
- Адрес нормализуется API Почты на чекауте; нормализованный снимок сохраняется в заказе
- Фиксированный тариф (из `store_settings`, без live-расчёта по весу)
- После оплаты: воркер асинхронно и идемпотентно создаёт заказ в «Неразобранном»; ШПИ появляется только при формировании партии
- Для оператора: партии, печать Ф7п + Ф103, check-in, сдача на почту — из админки

### Ключевые архитектурные решения
| Вопрос | Решение |
|--------|---------|
| Авторизация otpravka | Токен и готовый ключ пользователя зашифрованы в `store_settings.rupost_api_token_enc` / `rupost_user_auth_key_enc`; отдельные логин/пароль не храним |
| Создание backlog-заказа | **Асинхронно**: enqueue в txn `markOrderPaid` → воркер `rupost:drain` (мирроринг `order_notification_outbox`) |
| Идемпотентность | `rupost_shipments.order_id UNIQUE` + `order-num = order_id` у Почты + search-before-create при неопределённом исходе |
| Где живёт barcode/трек | `rupost_shipments.barcode` после создания удалённой партии; копируется в `orders.tracking_number` только на `handed_to_carrier` |
| Нормализация адреса | На чекауте, до оплаты, через `POST /1.0/clean/address`; снимок в `orders` |
| Объявленная ценность | `items_kopecks` (без доставки) |
| Единицы otpravka | Деньги — **копейки**, масса — **граммы** (совпадает с нашей БД) |
| Constraint трека | Существующий `orders_tracking_number_check` НЕ меняется |

---

## 2. Доменная модель

Две новые сущности. `rupost_shipments` — одновременно доменная сущность отправления **и** очередь (outbox): несёт и lifecycle-состояние, и поля ретраев. Это устраняет рассинхрон между «очередью» и «фактом».

```
orders (1) ──< (0..1) rupost_shipments (N) >── (0..1) rupost_batches
```

### `rupost_shipments` — отправление + очередь
| Поле | Тип | Назначение |
|------|-----|-----------|
| `id` | BIGSERIAL PK | |
| `order_id` | INTEGER **UNIQUE** FK→orders | один заказ → максимум одно отправление (гарантия от дублей) |
| `status` | TEXT | `pending` → `creating` → `backlog` → `batch_pending` → `in_batch` → `handed`; `failed` (только до создания backlog) |
| `barcode` | TEXT | трек Почты (ШПИ), NULL до `in_batch` |
| `remote_id` | BIGINT | id заказа в «Неразобранном»; NULL до `backlog` |
| `order_num` | TEXT NOT NULL | идемпотентный ключ у Почты = `order_id` строкой; для search-before-create |
| `batch_id` | BIGINT FK→rupost_batches NULL | проставляется при локальном резервировании `batch_pending` |
| `attempt_count` | INTEGER DEFAULT 0 | для backoff |
| `available_at` | TIMESTAMPTZ DEFAULT now() | когда воркер может взять (backoff) |
| `locked_at` | TIMESTAMPTZ | момент claim'а (для TTL-восстановления зависших `creating`) |
| `claim_token` | UUID | **владелец текущего claim'а**; пишется при `creating`, проверяется в каждом success/failure UPDATE; NULL вне `creating` |
| `last_error` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Состояния (state machine):**
- `pending` — поставлено в очередь, ещё не создавалось (`claim_token` NULL)
- `creating` — **claim'нуто воркером** (есть `claim_token`), идёт внешний вызов
- `backlog` — создано в «Неразобранном», есть `remote_id`, но ещё нет ШПИ
- `batch_pending` — оператор локально закрепил backlog-заказ за партией; внешняя партия ещё не создана, ШПИ нет
- `in_batch` — создана удалённая партия: есть `batch_id`, `barcode` и `remote_id`
- `handed` — партия сдана на почту
- `failed` — создание провалилось (только до создания: `barcode`/`remote_id`/`batch_id` все NULL). Ошибки уровня партии в `failed` НЕ переводят — ими управляет state machine партии (§10).

State-машинный CHECK:
```sql
CONSTRAINT rupost_shipments_state_check CHECK (
  (status = 'pending'  AND barcode IS NULL     AND remote_id IS NULL     AND batch_id IS NULL AND claim_token IS NULL)
  OR (status = 'creating' AND barcode IS NULL  AND remote_id IS NULL     AND batch_id IS NULL AND locked_at IS NOT NULL AND claim_token IS NOT NULL)
  OR (status = 'backlog'  AND barcode IS NULL     AND remote_id IS NOT NULL AND batch_id IS NULL     AND claim_token IS NULL)
  OR (status = 'batch_pending' AND barcode IS NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
  OR (status = 'in_batch' AND barcode IS NOT NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
  OR (status = 'handed'   AND barcode IS NOT NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
  OR (status = 'failed'   AND barcode IS NULL     AND remote_id IS NULL     AND batch_id IS NULL AND claim_token IS NULL)
)
```
> `creating` + `claim_token` закрывают гонку воркеров **полностью**, включая поздний ответ после TTL-возврата:
> - claim переводит `pending|failed → creating`, ставит `locked_at` и **новый `claim_token`** в одной транзакции; второй воркер строку в `creating` не выбирает (claim фильтрует по `pending|failed`).
> - Зависшую `creating` (воркер завис/упал) sweep возвращает в `pending` по TTL и **обнуляет `claim_token`**.
> - Если первый воркер «оживёт» после возврата и попытается записать результат, его `UPDATE … WHERE id=$id AND claim_token=$tokenA` **не совпадёт** (там уже либо NULL, либо `$tokenB` второго воркера) → запись в чужой claim невозможна. Без токена «только `status='creating'`» этого не ловит. См. §9.2.

### `rupost_batches` — партия (для Ф103 и сдачи)
| Поле | Тип | Назначение |
|------|-----|-----------|
| `id` | BIGSERIAL PK | |
| `remote_batch_name` | TEXT UNIQUE | имя партии от Почты (`batch-name`); NULL до `open` |
| `sending_date` | DATE | плановая дата сдачи |
| `status` | TEXT | см. ниже |
| `attempt_count` | INTEGER DEFAULT 0 | backoff для remote-операций |
| `available_at` | TIMESTAMPTZ DEFAULT now() | когда воркер может взять idle-партию (backoff) |
| `locked_at` | TIMESTAMPTZ | момент claim'а (TTL-восстановление) |
| `claim_token` | UUID | владелец claim'а; пишется при `creating`/`checking_in`, проверяется в каждом UPDATE; NULL в idle/терминальных |
| `last_error` | TEXT | |
| `created_by_actor_login_at` | BIGINT | кто собрал |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Партии управляются тем же воркером**, что и отправления (idle-состояние → claim в processing-состояние с токеном → remote → settle). Оператор лишь инициирует переходы; remote-вызовы делает воркер. Состояния:
- `pending_create` — **idle**: состав закреплён (shipments уже `batch_pending`), remote `createBatch` ещё не делался (`remote_batch_name` NULL, `claim_token` NULL)
- `creating` — **claimed**: воркер выполняет `createBatch`/reconcile (`claim_token` NOT NULL)
- `open` — Почта присвоила `remote_batch_name`; можно печатать Ф7п/Ф103
- `pending_checkin` — **idle**: оператор запросил check-in, воркер ещё не выполнил
- `checking_in` — **claimed**: воркер выполняет `checkInBatch` (`claim_token` NOT NULL)
- `checked_in` — приём подтверждён, готова к физической сдаче
- `handed` — оператор отнёс и подтвердил (локальный переход, без remote)
- `needs_review` — **остановка на ручной разбор**: reconciliation не смог однозначно установить состояние у Почты (см. §10). Воркер такие НЕ трогает; разбирает оператор.

State-машинный CHECK:
```sql
CONSTRAINT rupost_batches_state_check CHECK (
  (status = 'pending_create'  AND remote_batch_name IS NULL     AND claim_token IS NULL)
  OR (status = 'creating'        AND remote_batch_name IS NULL     AND claim_token IS NOT NULL AND locked_at IS NOT NULL)
  OR (status = 'open'            AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
  OR (status = 'pending_checkin' AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
  OR (status = 'checking_in'     AND remote_batch_name IS NOT NULL AND claim_token IS NOT NULL AND locked_at IS NOT NULL)
  OR (status = 'checked_in'      AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
  OR (status = 'handed'          AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
  OR (status = 'needs_review'    AND claim_token IS NULL)   -- remote_batch_name может быть NULL или NOT NULL
)
```
> Та же дисциплина claim_token, что у отправлений: idle (`pending_create`/`pending_checkin`) → claimed (`creating`/`checking_in`, токен) → settle с проверкой токена. Поздний ответ зависшего воркера в чужой claim не запишется. `needs_review` — терминал до вмешательства оператора (никаких авто-ретраев remote).

> **Почему партия — сущность, а не `getBatchLabel(barcodes)`:** список «новых» меняется между печатью Ф7п, печатью Ф103 и сдачей. Партия фиксирует состав в момент сборки; Ф103 и check-in работают по `remote_batch_name`, а не по «текущему списку». Статусы `creating`/`checking_in` дают тот же барьер идемпотентности, что и `creating` у отправлений (§10).

---

## 3. Миграция 013

Файл: `shop/sql/migrations/013_rupost.sql`. **Идемпотентна**, безопасна для существующих заказов.

```sql
BEGIN;

-- ── orders: адресная доставка + нормализованный снимок ──────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address          TEXT,    -- нормализованная строка одной строкой (для показа/печати)
  ADD COLUMN IF NOT EXISTS delivery_postal_code      TEXT,    -- нормализованный индекс (6 цифр)
  ADD COLUMN IF NOT EXISTS delivery_address_snapshot JSONB;   -- структурный снимок clean/address (region/place/street/house/room/quality)

-- индекс = 6 цифр, если задан
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_postal_code_format_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_postal_code_format_check
      CHECK (delivery_postal_code IS NULL OR delivery_postal_code ~ '^\d{6}$');
  END IF;
END $$;

-- при rupost_address все три поля обязательны
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_rupost_address_complete_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_rupost_address_complete_check CHECK (
      delivery_method IS DISTINCT FROM 'rupost_address'
      OR (
        delivery_address      IS NOT NULL AND char_length(btrim(delivery_address)) > 0
        AND delivery_postal_code IS NOT NULL AND delivery_postal_code ~ '^\d{6}$'
        AND delivery_address_snapshot IS NOT NULL
      )
    );
  END IF;
END $$;

-- расширить method/carrier-чек: добавить rupost_address/rupost
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_method_check CHECK (
  (delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0)
  OR (delivery_method = 'cdek_pickup'    AND delivery_carrier = 'cdek')
  OR (delivery_method = 'ozon_pickup'    AND delivery_carrier = 'ozon')
  OR (delivery_method = 'rupost_address' AND delivery_carrier = 'rupost')
);

-- ⚠️ orders_tracking_number_check НЕ трогаем: ранний barcode живёт в rupost_shipments,
-- в orders.tracking_number попадает только на handed_to_carrier (существующий инвариант сохраняется).

-- ── store_settings: Почта России ────────────────────────────────────────────
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS rupost_enabled            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rupost_delivery_kopecks   INTEGER,
  ADD COLUMN IF NOT EXISTS rupost_api_token_enc      BYTEA,
  ADD COLUMN IF NOT EXISTS rupost_user_auth_key_enc  BYTEA,
  ADD COLUMN IF NOT EXISTS rupost_sender_name        TEXT,
  ADD COLUMN IF NOT EXISTS rupost_sender_address     TEXT,
  ADD COLUMN IF NOT EXISTS rupost_sender_postal_code TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='store_settings'::regclass AND conname='store_settings_rupost_delivery_nonnegative') THEN
    ALTER TABLE store_settings ADD CONSTRAINT store_settings_rupost_delivery_nonnegative
      CHECK (rupost_delivery_kopecks IS NULL OR rupost_delivery_kopecks >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='store_settings'::regclass AND conname='store_settings_rupost_complete_check') THEN
    ALTER TABLE store_settings ADD CONSTRAINT store_settings_rupost_complete_check CHECK (
      rupost_enabled = false OR (
        rupost_api_token_enc      IS NOT NULL
        AND rupost_user_auth_key_enc IS NOT NULL
        AND rupost_delivery_kopecks   IS NOT NULL
        AND rupost_sender_name        IS NOT NULL AND char_length(btrim(rupost_sender_name)) > 0
        AND rupost_sender_address     IS NOT NULL AND char_length(btrim(rupost_sender_address)) > 0
        AND rupost_sender_postal_code IS NOT NULL AND rupost_sender_postal_code ~ '^\d{6}$'
      )
    );
  END IF;
END $$;

-- ── rupost_batches ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rupost_batches (
  id BIGSERIAL PRIMARY KEY,
  remote_batch_name TEXT UNIQUE,
  sending_date DATE,
  status TEXT NOT NULL DEFAULT 'pending_create'
    CHECK (status IN ('pending_create','creating','open','pending_checkin','checking_in','checked_in','handed','needs_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  claim_token UUID,
  last_error TEXT,
  created_by_actor_login_at BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rupost_batches_state_check CHECK (
    (status = 'pending_create'  AND remote_batch_name IS NULL     AND claim_token IS NULL)
    OR (status = 'creating'        AND remote_batch_name IS NULL     AND claim_token IS NOT NULL AND locked_at IS NOT NULL)
    OR (status = 'open'            AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
    OR (status = 'pending_checkin' AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
    OR (status = 'checking_in'     AND remote_batch_name IS NOT NULL AND claim_token IS NOT NULL AND locked_at IS NOT NULL)
    OR (status = 'checked_in'      AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
    OR (status = 'handed'          AND remote_batch_name IS NOT NULL AND claim_token IS NULL)
    OR (status = 'needs_review'    AND claim_token IS NULL)
  )
);

-- воркер берёт idle-партии; зависшие creating/checking_in восстанавливает sweep по TTL
CREATE INDEX IF NOT EXISTS idx_rupost_batches_ready
  ON rupost_batches (available_at, id) WHERE status IN ('pending_create','pending_checkin');
CREATE INDEX IF NOT EXISTS idx_rupost_batches_stuck
  ON rupost_batches (locked_at) WHERE status IN ('creating','checking_in');

-- ── rupost_shipments (отправление + очередь) ────────────────────────────────
CREATE TABLE IF NOT EXISTS rupost_shipments (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','creating','backlog','batch_pending','in_batch','handed','failed')),
  barcode TEXT,
  remote_id BIGINT,                          -- id в «Неразобранном», для формирования партии
  order_num TEXT NOT NULL,
  batch_id BIGINT REFERENCES rupost_batches(id) ON DELETE RESTRICT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  claim_token UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rupost_shipments_state_check CHECK (
    (status = 'pending'  AND barcode IS NULL     AND remote_id IS NULL     AND batch_id IS NULL AND claim_token IS NULL)
    OR (status = 'creating' AND barcode IS NULL  AND remote_id IS NULL     AND batch_id IS NULL AND locked_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (status = 'backlog'  AND barcode IS NULL     AND remote_id IS NOT NULL AND batch_id IS NULL     AND claim_token IS NULL)
    OR (status = 'batch_pending' AND barcode IS NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
    OR (status = 'in_batch' AND barcode IS NOT NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
    OR (status = 'handed'   AND barcode IS NOT NULL AND remote_id IS NOT NULL AND batch_id IS NOT NULL AND claim_token IS NULL)
    OR (status = 'failed'   AND barcode IS NULL     AND remote_id IS NULL     AND batch_id IS NULL AND claim_token IS NULL)
  ),
  CONSTRAINT rupost_shipments_barcode_format_check CHECK (
    barcode IS NULL OR char_length(btrim(barcode)) BETWEEN 10 AND 32
  )
);

-- remote_id уникален у Почты (один backlog-item) — partial unique, NULL до backlog
CREATE UNIQUE INDEX IF NOT EXISTS uq_rupost_shipments_remote_id
  ON rupost_shipments (remote_id) WHERE remote_id IS NOT NULL;

-- воркер берёт готовые к попытке pending/failed; creating восстанавливает sweep по TTL
CREATE INDEX IF NOT EXISTS idx_rupost_shipments_ready
  ON rupost_shipments (available_at, id) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_rupost_shipments_stuck
  ON rupost_shipments (locked_at) WHERE status = 'creating';

-- ── rupost_normalize_attempts — анонимный rate-limit /checkout/rupost/normalize ─
-- delivery_test_attempts (миграция 007) НЕ подходит: требует actor_login_at, а
-- checkout публичный и actor'а не имеет. Отдельный лимитер по IP (+ session-ключ).
CREATE TABLE IF NOT EXISTS rupost_normalize_attempts (
  id          BIGSERIAL PRIMARY KEY,
  ip          TEXT NOT NULL,
  session_key TEXT,                          -- опц. cart/session, если есть; иначе только IP
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rupost_normalize_attempts_window
  ON rupost_normalize_attempts (ip, created_at);

COMMIT;
```

**Тест-файл** `013_rupost.test.ts`:
- orders: `rupost_address` без address/snapshot → ошибка; индекс 5 цифр → ошибка; валидный → OK; старые cdek/ozon не ломаются
- store_settings: `rupost_enabled=true` без токена, user key или реквизитов → ошибка
- rupost_shipments: `pending` с barcode → ошибка; `creating` без `locked_at`/`claim_token` → ошибка; `backlog` с barcode или без `remote_id` → ошибка; `batch_pending` без `batch_id` или с barcode → ошибка; `in_batch` без `batch_id`/barcode → ошибка; `failed` с непустым `barcode` → ошибка; второй shipment на тот же `order_id` → UNIQUE violation; два `backlog` с одинаковым `remote_id` → UNIQUE violation
- rupost_batches: `pending_create` с `remote_batch_name`/`claim_token` → ошибка; `creating` без `claim_token` → ошибка; `open` без `remote_batch_name` или с `claim_token` → ошибка; `checking_in` без `claim_token` → ошибка; `needs_review` с `claim_token` → ошибка; статус вне множества → ошибка

---

## 4. Нормализация адреса на чекауте

**Когда:** клиент ввёл адрес + индекс и нажал «продолжить» (до оплаты).
**Эндпоинт:** `POST /api/checkout/rupost/normalize` (server-only, использует токен Почты).

Под капотом — otpravka `POST /1.0/clean/address`:
```jsonc
// запрос к Почте
[ { "id": "1", "original-address": "москва тверская 7 кв 10, 125009" } ]
// ответ (ключевые поля)
[ {
  "id": "1",
  "index": "125009",
  "region": "г Москва",
  "place": "г Москва",
  "street": "ул Тверская",
  "house": "7",
  "room": "10",
  "address-type": "DEFAULT",
  "quality-code": "GOOD",            // GOOD | POSTAL_BOX | ON_DEMAND | UNDEF_05 | ...
  "validation-code": "VALIDATED"     // VALIDATED | OVERRIDDEN | CONFIRMED_MANUALLY | NOT_VALIDATED
} ]
```

Логика `/api/checkout/rupost/normalize`:
1. Отправить сырой ввод в `clean/address`.
2. Если `quality-code` ∈ {`GOOD`, `POSTAL_BOX`, `ON_DEMAND`} и `validation-code` ∈ {`VALIDATED`, `CONFIRMED_MANUALLY`, `OVERRIDDEN`} → **успех**: вернуть фронтенду нормализованную одну строку + индекс + полный snapshot.
3. Иначе → `{ ok: false, message: 'Адрес не распознан, проверьте написание' }`.
4. Ответ фронтенду:
```typescript
type NormalizeResult =
  | { ok: true; address: string; postalCode: string; snapshot: RupostAddressSnapshot }
  | { ok: false; message: string }

type RupostAddressSnapshot = {
  index: string; region: string; place: string;
  street: string | null; house: string | null; room: string | null;
  qualityCode: string; validationCode: string;
}
```

Фронтенд кладёт `snapshot` в состояние формы и отправляет его в `robokassa/init` — заказ хранит **уже нормализованный** адрес. Повторная нормализация на сервере при создании заказа (защита от подмены клиентом) — см. §8.

> Без нормализации до оплаты возможен заказ с адресом, который Почта откажется принять уже после оплаты — деньги взяты, отправление не создаётся. Нормализация на чекауте переносит этот отказ в момент, когда клиент ещё может исправить ввод.

### Защита публичного эндпоинта `/api/checkout/rupost/normalize`
Эндпоинт публичный и проксирует платную/квотируемую операцию Почты — без защиты его можно использовать для выбивания квоты `clean/address`.

- **Rate limit — ОТДЕЛЬНЫЙ анонимный лимитер, не миграция 007.** `delivery_test_attempts` (007) требует `actor_login_at NOT NULL`, а checkout публичный — actor'а нет. Поэтому в миграции 013 заведена `rupost_normalize_attempts (ip, session_key, created_at)` (§3). Лимит — скользящее окно по `ip` (и по `session_key`, если есть cart/session-cookie): напр. ≤ 15 запросов/5 мин на IP. Превышение → 429 без вызова Почты. Паттерн «общая таблица между PM2-воркерами» взят у 007, но схема своя (по IP, без actor).
- **Длина ввода:** адрес ≤ 300 симв.; иначе 400 до вызова Почты (не транжирим квоту на мусор) — согласовано с `rupost_normalize_attempts`/CHECK длины на входе.
- **Таймаут к Почте:** 5 с; при таймауте/5xx — `{ ok: false, message: 'Сервис проверки адреса временно недоступен, попробуйте позже' }`, статус 503.
- **Безопасное сообщение:** наружу — только обобщённый текст; точную причину/тело ответа Почты писать в лог, не в ответ клиенту (не светим внутренности otpravka).
- **Запись только в лимитер:** эндпоинт пишет лишь строку в `rupost_normalize_attempts`; на доменные данные не влияет — идемпотентная проверка.

---

## 5. Otpravka API — клиент `lib/rupost.ts`

> Контракт ниже сверен 2026-06-24 с опубликованной спецификацией otpravka. До production запуска остаётся проверить реальные допустимые сервисы/поля именно для этой учётной записи, но не переизобретать маршруты или авторизацию.

### Аутентификация (два заголовка одновременно)
```
Authorization:        AccessToken {RUPOST_API_TOKEN}
X-User-Authorization: Basic {RUPOST_USER_AUTH_KEY}
```
`RUPOST_USER_AUTH_KEY` — уже готовое значение `base64(login:password)`, которое выдал/сгенерировал личный кабинет. Интеграция не хранит и не преобразует логин или пароль. Оба секрета расшифровываются только сервером из `store_settings`.

### Единицы
- **Деньги** — копейки (`mass`-независимо). `insr-value` (объявленная ценность) в копейках.
- **Масса** — граммы (`mass`).
- Совпадает с нашей БД (`*_kopecks`, вес в граммах) — конвертаций нет.

### Контракт модуля
```typescript
// lib/rupost.ts

// ── вход для создания отправления ───────────────────────────────────────────
export interface RupostShipmentInput {
  orderNum: string                 // = String(order.id), идемпотентный ключ
  // получатель
  recipientName: string            // ФИО (нормализованное clean/fio желательно, но не обязательно)
  recipientPhone: string           // 10 цифр без +7 ('tel-address' у Почты)
  // адрес получателя — из нормализованного снимка заказа (НЕ свободный текст)
  indexTo: string                  // 6 цифр
  regionTo: string
  placeTo: string
  streetTo: string | null
  houseTo: string | null
  roomTo: string | null
  // отправление
  massGrams: number                // RUPOST_DEFAULT_WEIGHT_GRAMS
  declaredValueKopecks: number     // = order.items_kopecks (стоимость вложения, БЕЗ доставки)
  // отправитель — из store_settings.rupost_sender_*
  senderName: string
  senderAddress: string
  senderIndex: string
}

export interface RupostBacklogResult {
  remoteId: number                 // id заказа в «Неразобранном»
}

// ── операции ────────────────────────────────────────────────────────────────
// PUT /1.0/user/backlog: создать заказ в «Неразобранном». ШПИ здесь ещё нет.
export async function createBacklog(input: RupostShipmentInput, auth: RupostAuth): Promise<RupostBacklogResult>

// Reconciliation: найти уже созданное отправление по order-num (для идемпотентности после таймаута).
export async function findBacklogByOrderNum(orderNum: string, auth: RupostAuth): Promise<RupostBacklogResult | null>

// POST /1.0/user/shipment: сформировать партию из списка remoteId. Возвращает remote batch-name.
export async function createBatch(remoteIds: number[], sendingDate: string, auth: RupostAuth): Promise<{ batchName: string }>

// GET /1.0/shipment/{id}: прямое чтение состояния backlog-заказа, включая batch-name и barcode.
export async function getShipment(remoteId: number, auth: RupostAuth): Promise<{ batchName: string | null; barcode: string | null }>

// Reconciliation партии: прочитать getShipment для каждого remoteId; одна и та же
// непустая batchName у всех элементов = успех. Для аудита полного состава использовать
// пагинированный GET /1.0/batch/{name}/shipment.
export async function findBatchByMembership(remoteIds: number[], auth: RupostAuth): Promise<{ batchName: string } | null>

// PDF Ф7п (адресный ярлык) одного отправления по его remoteId.
export async function getF7pLabel(remoteId: number, auth: RupostAuth): Promise<Buffer>

// PDF Ф103 (опись партии) по remote batch-name.
export async function getF103(batchName: string, auth: RupostAuth): Promise<Buffer>

// Подготовить партию к сдаче (check-in / приём).
export async function checkInBatch(batchName: string, auth: RupostAuth): Promise<void>

// Проверка токена/учётки для кнопки «Проверить связь».
export async function testConnection(auth: RupostAuth): Promise<{ ok: boolean; error?: string }>

// Нормализация адреса (используется /api/checkout/rupost/normalize).
export async function cleanAddress(raw: string, auth: RupostAuth): Promise<RupostAddressSnapshot | null>

export interface RupostAuth { apiToken: string; userAuthKey: string }
```

### Подтверждённые эндпоинты otpravka
```
POST /1.0/clean/address            — нормализация адреса
PUT  /1.0/user/backlog             — создать заказ(ы) в «Неразобранном»; ответ содержит remote id, не ШПИ
GET  /1.0/backlog/search?query=    — поиск в "Неразобранном" по order-num (reconciliation)
POST /1.0/user/shipment            — сформировать партию из remote id
GET  /1.0/shipment/{id}             — batch-name и barcode конкретного заказа
GET  /1.0/batch/{name}/shipment     — состав партии (пагинация)
GET  /1.0/forms/{id}/f7pdf          — Ф7п (PDF)
GET  /1.0/forms/{batchName}/f103pdf — Ф103 (PDF)
POST /1.0/batch/{batchName}/checkin — отправить электронную Ф103 / подготовить приём
GET  /1.0/settings                  — проверка токена и ключа (testConnection)
```

### Тело создания backlog-заказа (ключевые поля)
```jsonc
{
  "order-num": "<order_id>",          // идемпотентность + поиск
  "mail-type": "ONLINE_PARCEL",
  "mail-category": "ORDINARY",
  "mass": 500,                         // граммы
  "insr-value": 180000,               // копейки = items_kopecks
  "address-type-to": "DEFAULT",
  "index-to": 125009,
  "region-to": "г Москва",
  "place-to": "г Москва",
  "street-to": "ул Тверская",
  "house-to": "7",
  "room-to": "10",
  "recipient": "Иванова Анна Петровна",
  "tel-address": 9991234567,          // 10 цифр
  "dimension-type": "S"               // габаритная группа (фикс для свечей)
}
```

### Модель ошибок
- HTTP 2xx + per-item `errors[]` в ответе backlog → если есть `errors` для нашего item, считаем создание неуспешным (не сохраняем `remote_id`, ретрай).
- HTTP 4xx (кроме 401/403) → невосстановимо для этих данных: `status='failed'`, `last_error`, БЕЗ авто-ретрая (нужен ручной разбор оператором).
- HTTP 401/403 → проблема авторизации: ретрай с большим backoff (возможно протух токен) + сигнал в админку.
- HTTP 5xx / таймаут → восстановимо: ретрай с backoff; **перед следующим create — `findBacklogByOrderNum`** (backlog мог успеть создаться до обрыва).

---

## 6. Расширение `lib/store-settings.ts`

```typescript
export type Carrier = 'cdek' | 'ozon' | 'rupost'
export type DeliveryMethod = 'cdek_pickup' | 'ozon_pickup' | 'rupost_address'

type CarrierMode = 'pickup' | 'address'
export const CARRIER_MODE: Record<Carrier, CarrierMode> = { cdek: 'pickup', ozon: 'pickup', rupost: 'address' }

// Собрать auth для рантайма: токен + готовый user key из БД (decrypt).
export async function getRupostAuth(): Promise<RupostAuth>
```

### `resolveDeliveryMode()` — ветка rupost
Включить `rupost` в активные, если: `rupost_enabled=true`, токен и user key расшифровываются, заданы реквизиты отправителя и `rupost_delivery_kopecks IS NOT NULL`. Иначе — не предлагать (как СДЭК/Ozon при неполной конфигурации).

### Ответ `/api/checkout/delivery`
```typescript
type ActiveCarrier =
  | { carrier: 'cdek' | 'ozon'; mode: 'pickup';  deliveryKopecks: number }
  | { carrier: 'rupost';        mode: 'address'; deliveryKopecks: number }
```

---

## 7. Чекаут — UI (`app/(shop)/checkout/page.tsx`)

```
[Контакты — всегда]  ФИО * · Email * · Телефон *

[Доставка — если mode != 'disabled']
  ┌ переключатель перевозчиков (только если активных > 1) ┐
  │  СДЭК ПВЗ   ·   Ozon ПВЗ   ·   Почта России           │
  └───────────────────────────────────────────────────────┘
  · СДЭК / Ozon  → текущий виджет ПВЗ
  · Почта России → адресная форма:
        Адрес (улица, дом, кв) *
        Индекс * (маска 6 цифр)
        [Проверить адрес] → /api/checkout/rupost/normalize
        ↳ успех: показать нормализованный адрес «Москва, ул Тверская, 7–10, 125009» (зелёная галка)
        ↳ ошибка: «Адрес не распознан, проверьте написание»

[Итог]  товары + доставка (тариф из /api/checkout/delivery)
```

**Состояние формы:**
```typescript
type DeliveryState =
  | { carrier: 'cdek' | 'ozon'; pickupPoint: PickupPoint | null }
  | { carrier: 'rupost'; address: string; postalCode: string; snapshot: RupostAddressSnapshot | null }
  | null
```
**Правила:** один активный перевозчик → без переключателя. Переключение перевозчика сбрасывает выбор. Для rupost кнопка оплаты неактивна, пока `snapshot === null` (адрес не подтверждён нормализацией).

---

## 8. Создание заказа (`POST /api/robokassa/init`, `lib/orders.ts`)

### Тело запроса
```typescript
type DeliveryInput =
  | { method: 'cdek_pickup' | 'ozon_pickup'; pickupPointCode: string; expectedDeliveryKopecks: number }
  | { method: 'rupost_address'; address: string; postalCode: string; snapshot: RupostAddressSnapshot; expectedDeliveryKopecks: number }
```

### `createOrder()` — ветка rupost_address
1. **Доступность:** `resolveDeliveryMode()` подтверждает, что `rupost` активен; иначе 503.
2. **Тариф:** `expectedDeliveryKopecks` == серверный `rupost_delivery_kopecks`; иначе 409 `PRICE_CHANGED`.
3. **Re-нормализация (анти-подмена):** сервер сам вызывает `cleanAddress(address+index)` и сверяет с присланным `snapshot` (index, place, street, house). Расхождение или плохой quality → 400 `ADDRESS_INVALID`. Это гарантирует, что в заказ попадёт адрес, который Почта реально примет.
4. **INSERT orders:**
   ```
   delivery_method='rupost_address', delivery_carrier='rupost',
   delivery_address=<нормализованная одна строка>,
   delivery_postal_code=<index>,
   delivery_address_snapshot=<серверный snapshot JSONB>,
   pickup_point_*=NULL
   ```
5. Никаких вызовов pickup-provider. Никакого создания отправления (оно — после оплаты).

---

## 9. После оплаты: enqueue + воркер (идемпотентно)

### 9.1 Enqueue внутри транзакции `markOrderPaid`
В `lib/orders.ts`, в той же транзакции, что ставит `paid` (рядом с `enqueueOrderNotification`):

```typescript
// внутри withTransaction, после успешного UPDATE ... RETURNING id:
await enqueueOrderNotification(client, { orderId: invId, eventType: 'payment_paid', eventKey: `order:${invId}:paid` })

// NEW: если заказ rupost — поставить отправление в очередь (тем же client, атомарно с paid)
await enqueueRupostShipment(client, invId)  // INSERT ... ON CONFLICT (order_id) DO NOTHING
```

`enqueueRupostShipment(client, orderId)`:
```sql
INSERT INTO rupost_shipments (order_id, order_num, status)
SELECT o.id, o.id::text, 'pending'
FROM orders o
WHERE o.id = $1 AND o.delivery_carrier = 'rupost'
ON CONFLICT (order_id) DO NOTHING;
```
`ON CONFLICT DO NOTHING` + `UNIQUE(order_id)` → повторный callback (`already_paid`) не плодит строки. Callback `robokassa/result` **не меняется** — он по-прежнему дергает только `markOrderPaid`. Внешних вызовов в callback нет (P0/P1 закрыты).

### 9.2 Воркер `scripts/rupost-shipment-worker.ts` (`npm run rupost:drain`)
Мирроринг `drainNotificationOutbox`. Запуск — по крону на VPS (как `notifications:drain`; см. docs/operations.md).

`drainRupostShipments(limit=10)` цикл:
```
claimNext():
  -- claim атомарно: pending|failed → creating + НОВЫЙ claim_token, в ОДНОЙ транзакции.
  -- claim_token — владелец попытки; ниже он требуется в каждом settle-UPDATE.
  token = uuidv4()
  BEGIN;
    SELECT * FROM rupost_shipments
     WHERE status IN ('pending','failed') AND available_at <= now()
     ORDER BY available_at, id LIMIT 1
     FOR UPDATE SKIP LOCKED;        -- нет строки → выходим
    UPDATE rupost_shipments
       SET status='creating', locked_at=now(), claim_token=$token, attempt_count=attempt_count+1
     WHERE id=<row.id>;
  COMMIT;                           -- 'creating' + token зафиксированы ДО внешнего вызова
  return { row, token }

processClaimed(row, token):
  auth = await getRupostAuth()
  order = SELECT нужные PII заказа (recipient, snapshot, items_kopecks) WHERE id = row.order_id
  try:
    // RECONCILIATION перед созданием (идемпотентность после таймаута)
    existing = await findBacklogByOrderNum(row.order_num, auth)
    result = existing ?? await createBacklog(buildInput(order, settings), auth)
    // settle ТОЛЬКО если claim всё ещё наш — иначе строку перехватил sweep+другой воркер:
    UPDATE rupost_shipments
       SET status='backlog', remote_id=result.remoteId,
           last_error=NULL, locked_at=NULL, claim_token=NULL
     WHERE id=row.id AND status='creating' AND claim_token=$token   -- ← ключевое условие
    // affectedRows=0 → наш claim истёк (TTL-возврат), результат игнорируем; владеет другой воркер
  catch (err):
    classify(err) — тоже ТОЛЬКО при claim_token=$token:
      recoverable (5xx/timeout/401/403): status='failed', available_at=now()+backoff(attempt), locked_at=NULL, claim_token=NULL, last_error=...
      permanent (4xx data):               status='failed', available_at=now()+'100 years', locked_at=NULL, claim_token=NULL, last_error=... (ручной разбор)
```

**Sweep зависших `creating`** (часть того же `rupost:drain`, перед claim-циклом):
```sql
-- воркер упал/завис между COMMIT('creating') и settle → строка застряла в 'creating'.
-- Вернуть в 'pending', ОБНУЛИВ claim_token: это инвалидирует поздний settle прежнего
-- воркера (его claim_token больше не совпадёт). Следующая попытка через reconciliation
-- подберёт уже созданное (если успело) и не создаст дубль.
UPDATE rupost_shipments
   SET status='pending', locked_at=NULL, claim_token=NULL, available_at=now(),
       last_error=COALESCE(last_error,'') || ' [recovered from stuck creating]'
 WHERE status='creating' AND locked_at < now() - interval '10 minutes';
```

- **Барьер от параллельного создания + позднего ответа (P0 закрыт полностью):** claim ставит `creating` + уникальный `claim_token` атомарно. Второй воркер `creating` не видит. Если первый воркер завис дольше TTL, sweep вернул строку в `pending` и обнулил токен; второй воркер взял её с **новым** токеном. «Оживший» первый воркер делает `UPDATE … WHERE claim_token=$tokenA` → **0 строк** (там NULL или `$tokenB`) — записать результат в чужой claim невозможно. (Версия без токена «`WHERE status='creating'`» здесь записала бы в claim второго воркера.)
- **Идемпотентность у Почты:** `order-num = order_id` + `findBacklogByOrderNum` перед каждым create. Таймаут после создания → следующая попытка находит уже созданный backlog и сохраняет только `remote_id`, не создавая дубль. `remote_id` уникален (partial unique index). ШПИ не ожидаем до формирования партии.

> **Замечание по согласованности с Ozon order-lifecycle** (`docs/specs/ozon-fbs-order-lifecycle.md`): обе фазы используют один паттерн «enqueue в txn paid → воркер с claim→processing-статус + **claim_token** + sweep + backoff». Шаблон (крон-драйнер, SKIP LOCKED, token-guarded settle) общий — переиспользовать утилиты claim/backoff/sweep.

---

## 10. Партии и операционный флоу (админка)

Страница `/admin/shipping/rupost`.

### Состав
- **«Готовы к отправке»**: `rupost_shipments.status='backlog'` (удалённый id есть, ШПИ ещё не назначен).
- **«Партии»**: список `rupost_batches` со статусами.

Remote-операции партии (createBatch, checkIn) выполняет **тот же воркер** `rupost:drain`, по той же дисциплine, что и отправления (§9.2): оператор переводит партию в idle-статус (`pending_create`/`pending_checkin`), воркер claim'ит её в processing (`creating`/`checking_in`) с `claim_token`, делает remote, settl'ит под проверкой токена. Это закрывает разрыв «remote сначала, локально потом».

> **Степень гарантии.** Официальный контракт подтверждает прямое чтение принадлежности каждого backlog-заказа через `GET /1.0/shipment/{id}`. Тем не менее после таймаута, неполного ответа или разных `batch-name` reconciliation НЕ повторяет `createBatch`, а останавливает партию в `needs_review`.

#### Шаг 1. Собрать партию
**1a. Локальная транзакция оператора (claim состава, без remote):**
```sql
BEGIN;
  SELECT id, remote_id FROM rupost_shipments
  WHERE status='backlog' AND id = ANY($selected)
   FOR UPDATE SKIP LOCKED;                          -- реально доступные строки
  INSERT INTO rupost_batches (status, sending_date, created_by_actor_login_at)
    VALUES ('pending_create', $date, $actor) RETURNING id;   -- idle, remote_batch_name=NULL, claim_token=NULL
  UPDATE rupost_shipments
     SET status='batch_pending', batch_id=$batchId
   WHERE id = ANY($actuallyLocked);                 -- состав закреплён локально и эксклюзивно
COMMIT;
```
Состав зафиксирован: shipments теперь `batch_pending`, принадлежат только этой партии — повторная сборка их не возьмёт. ШПИ до remote-вызова отсутствует, поэтому переводить их в `in_batch` на этом шаге нельзя.

**1b. Воркер: claim `pending_create → creating` (+token) → `createBatch` → settle:**
```
token=uuidv4(); claim: pending_create → creating, claim_token=$token, locked_at=now()  (txn)
remoteIds = SELECT remote_id FROM rupost_shipments WHERE batch_id=$batchId
try:
  { batchName } = await createBatch(remoteIds, sendingDate, auth)
  remoteShipments = await Promise.all(remoteIds.map((id) => getShipment(id, auth)));
  // каждый ответ обязан содержать тот же batchName и непустой barcode
  // иначе → needs_review, без повторного createBatch
  // один локальный txn: сначала UPDATE партии WHERE claim_token=$token; если affectedRows=1,
  // затем обновить все её batch_pending shipments до in_batch с полученными barcode.
  // Если claim потерян — не менять shipments: их владельцем уже стал другой воркер.
catch (timeout/5xx):
  // НЕ создаём вторую партию. Возвращаем в idle для reconciliation:
  UPDATE rupost_batches SET status='pending_create', claim_token=NULL, locked_at=NULL,
         available_at=now()+backoff, last_error=...
   WHERE id=$batchId AND claim_token=$token
```

**1c. Reconciliation повторного `pending_create` (воркер, перед обычным createBatch):**
Если `attempt_count > 0` (т.е. createBatch уже мог пройти у Почты), сначала проверяем состояние, потом решаем:
```
membership = await findBatchByMembership(remoteIds, auth)  // GET /1.0/shipment/{id} для каждого id
switch membership:
  case ONE_BATCH(allRemoteIds в одной партии, имя N):
        → прочитать barcode всех remoteIds и в одном txn adopt: SET remote_batch_name=N, status='open';
          shipments batch_pending → in_batch с сохранением barcode // успех
  case NONE(ни один remote_id не имеет batch-name):
        → createBatch заново (создания не было)                    // безопасный ретрай
  case AMBIGUOUS(часть в партии / разные batch-name / отсутствует barcode / сверка пагинированного состава оборвалась):
        → SET status='needs_review', last_error='reconcile ambiguous: <деталь>'   // СТОП, не ретраим
```
`needs_review` означает: оператор вручную сверяет партию в ЛК otpravka и приводит локальное состояние в соответствие (есть удалённая партия → ввести её имя/перевести в `open`; нет → вернуть в `pending_create`). Автоматических remote-ретраев в этом статусе нет.

**Sweep зависшей `creating`** (воркер упал внутри 1b): по TTL вернуть `creating → pending_create`, обнулив `claim_token` (поздний settle прежнего воркера не пройдёт). Дальше — путь 1c.

#### Шаг 2. Печать Ф7п
`getF7pLabel(remote_id)` по каждому отправлению (объединить в один PDF). Доступно после того, как worker подтвердил `in_batch` и сохранил ШПИ. Ярлыки на коробки.

#### Шаг 3. Печать Ф103
`getF103(remote_batch_name)` → опись (один PDF). Состав зафиксирован на 1a, имя — на 1b/1c.

#### Шаг 4. Check-in
Оператор: `open → pending_checkin` (idle, локально). Воркер: claim `pending_checkin → checking_in` (+token) → `checkInBatch` → settle:
```
token=uuidv4(); claim: pending_checkin → checking_in, claim_token=$token  (txn)
try:
  await checkInBatch(remote_batch_name, auth)
  UPDATE ... SET status='checked_in', claim_token=NULL, locked_at=NULL WHERE id=$batchId AND claim_token=$token
catch (timeout/5xx):
  UPDATE ... SET status='pending_checkin', claim_token=NULL, available_at=now()+backoff, last_error=... WHERE claim_token=$token
```
Check-in идемпотентен у Почты: «уже принята» трактуем как успех → `checked_in`. Sweep зависшей `checking_in` зеркалит `creating`. Если повтор неоднозначен (API не даёт статус приёма) → `needs_review`.

#### Шаг 5. Сдать на почту
Оператор отнёс, подписал Ф103 → кнопка «Сдано» (локально, без remote; из `checked_in`). В одной транзакции: `rupost_batches.status='handed'`; каждый shipment партии `status='handed'`; перевод исполнения заказа (§11).

> Состав партии неизменен после 1a; Ф7п/Ф103/приём согласованы по `remote_batch_name`. Барьеры `creating`/`checking_in` + `claim_token` + остановка в `needs_review` при неоднозначности заменяют ложную гарантию «дубль исключён всегда» на честную: **при ясном ответе API — без дублей; при неясном — стоп на ручной разбор, без слепых remote-ретраев.**

---

## 11. Переход исполнения для rupost (трек уже есть)

Текущий `transitionFulfillment` ([lib/admin-orders-db.ts:54](/Users/admin/Downloads/Vibe/20260522-МАВИТА-КП/shop/lib/admin-orders-db.ts#L54)) на `packing→handed_to_carrier` **требует** `trackingNumber` аргументом и пишет его в `orders.tracking_number` и в событие. Для Почты ручного ввода нет — barcode уже в `rupost_shipments`.

**Решение:** carrier-aware переход. При сдаче партии (§10 шаг 5) для каждого заказа выполнить переход, где трек берётся из `rupost_shipments.barcode`, а не из аргумента:

```typescript
// в той же транзакции, что и rupost_batches → 'handed':
// для каждого order_id партии:
//   гарантировать fulfillment_status = 'packing' (если 'new' — сначала new→packing)
//   затем packing→handed_to_carrier, где
//     tracking := rupost_shipments.barcode (NOT NULL по state-check для in_batch)
//   UPDATE orders SET fulfillment_status='handed_to_carrier', tracking_number = <barcode>
//   INSERT order_admin_events(... to='handed_to_carrier', tracking_number=<barcode>, actor_login_at)
//   enqueueOrderNotification(client, fulfillment_changed)
```

Реализация — расширить `transitionFulfillment` необязательным источником трека ИЛИ добавить `handRupostBatch(batchId, actorLoginAt)`, который проводит переходы пакетно. Существующий ручной путь (СДЭК/Ozon: оператор вводит трек) сохраняется без изменений.

На этом шаге barcode копируется в `orders.tracking_number` — **существующий** `orders_tracking_number_check` (трек разрешён при `handed_to_carrier`) выполняется. Constraint не меняли.

---

## 12. Админка — настройки Почты России

Секция на странице настроек доставки (рядом с СДЭК/Ozon).
```
[✓] Включить доставку Почтой России
Стоимость доставки: [350] ₽
Токен otpravka API:  [•••••••••f2a] [Изменить]   (зашифрован; profile → Настройки → API)
Ключ авторизации:    [•••••••••9K=] [Изменить]   (готовый Base64 user key; зашифрован)
ФИО отправителя:     [Захарова Виктория Борисовна]
Адрес отправителя:   [Санкт-Петербург, ул …, д …]
Индекс отправителя:  [190000]
[Проверить связь] → testConnection()        [Сохранить]
```
Эндпоинты:
```
GET  /api/admin/settings/delivery              — текущие настройки (токен маскирован)
POST /api/admin/settings/delivery/rupost       — сохранить (encryptSecret для токена и user key)
POST /api/admin/settings/delivery/rupost/test  — проверить связь
```
Логин и пароль ЛК не принимаются и не хранятся: в форме вводится только уже сгенерированный ключ авторизации пользователя.

---

## 13. Трекинг для клиента

На `/order/{token}`: если по заказу есть `rupost_shipments.barcode` — показать трек + ссылку, **независимо** от `orders.tracking_number`:
```
Трек-номер: 12345678901234
[Отследить на сайте Почты России →]  https://www.pochta.ru/tracking#<barcode>
```
Данные брать из `rupost_shipments` (join по order_id), не из `orders.tracking_number` (тот заполняется позже, на сдаче).

---

## 14. Переменные окружения (`.env.example`)
```bash
# Почта России / otpravka-api.pochta.ru
RUPOST_DEFAULT_WEIGHT_GRAMS=500  # вес посылки по умолчанию (граммы)
```
`rupost_api_token_enc` и `rupost_user_auth_key_enc` — в БД, шифруются `SETTINGS_ENC_KEY` (как секреты СДЭК/Ozon). Ни токен, ни ключ, ни логин/пароль не добавляются в `.env` или в репозиторий.

---

## 15. Синхронизация `sql/schema.sql`
После 013 внести вручную в `schema.sql`: новые колонки `orders` (+3) и их CHECK; колонки `store_settings` (+7, включая `rupost_user_auth_key_enc`) и `store_settings_rupost_complete_check`; таблицы `rupost_batches`, `rupost_shipments` (вкл. `remote_id`, `claim_token`, `batch_pending` и все CHECK/индексы), `rupost_normalize_attempts`. `orders_tracking_number_check` — **без изменений**.

---

## 16. Чеклист реализации (порядок)
```
[x] 0.  API-ИССЛЕДОВАНИЕ: подтверждены auth, маршруты, получение membership и жизненный цикл backlog→партия→ШПИ.
        Перед production остались реальные проверки допустимых полей договора, retry `order-num` и повторного check-in.
[ ] 1.  Миграция 013 + 013_rupost.test.ts (orders cols, store_settings с токеном+user key, rupost_batches,
        rupost_shipments c remote_id+claim_token+batch_pending, rupost_normalize_attempts; все state-check)
[ ] 2.  lib/rupost.ts — cleanAddress, createBacklog, findBacklogByOrderNum, createBatch, getShipment,
        findBatchByMembership, getF7pLabel, getF103, checkInBatch, testConnection; строго по путям §5
[ ] 3.  lib/store-settings.ts — Carrier+'rupost', CARRIER_MODE, getRupostAuth(), resolveDeliveryMode ветка rupost
[ ] 4.  /api/checkout/delivery — ответ с mode:'address' для rupost
[ ] 5.  /api/checkout/rupost/normalize — нормализация + hardening: лимитер rupost_normalize_attempts (IP/session,
        НЕ миграция 007), таймаут 5с, длина ≤300, обобщ. ошибка
[ ] 6.  lib/orders.ts — createOrder ветка rupost_address (re-нормализация, INSERT snapshot);
        enqueueRupostShipment(client) внутри markOrderPaid txn
[ ] 7.  scripts/rupost-worker.ts + npm run rupost:drain — единый воркер (отправления И партии):
        sweep зависших creating/checking_in (TTL, обнулить claim_token) → claim(idle → processing, +claim_token) →
        remote → settle ТОЛЬКО при claim_token=$token → backoff; неоднозначный reconcile партии → needs_review
[ ] 8.  checkout/page.tsx — переключатель перевозчиков + адресная форма + кнопка «Проверить адрес»
[ ] 9.  /api/admin/settings/delivery/rupost (+/test) — настройки + шифрование токена и user key; test → GET /1.0/settings
[ ] 10. AdminPanel — секция настроек Почты России
[ ] 11. lib/rupost-batches.ts + /api/admin/rupost/* — собрать (1a: claim состава → pending_create),
        check-in (open → pending_checkin), сдать (checked_in → handed); Ф7п/Ф103; разбор needs_review оператором.
        Remote createBatch/checkIn делает воркер (п.7), не админ-запрос
[ ] 12. transitionFulfillment carrier-aware ИЛИ handRupostBatch() — трек из rupost_shipments.barcode
[ ] 13. /admin/shipping/rupost — UI: «готовы к отправке» + «партии» + операции
[ ] 14. /order/[token] — показать трек из rupost_shipments + ссылка pochta.ru
[ ] 15. Обновить sql/schema.sql + .env.example
[ ] 16. docs/operations.md — крон rupost:drain (вкл. sweep отправлений и партий), смена токена/user key,
        ручной разбор shipments.failed и batches.needs_review
```

---

## 17. За рамками
- DaData-подсказки адреса (есть нормализация Почты — достаточно для запуска)
- Live-расчёт тарифа по весу (сейчас фикс; при необходимости — вес в `products`)
- Email-уведомления клиенту с треком
- Наложенный платёж (не нужен — предоплата через Робокассу)
- Возвраты (otpravka поддерживает; отдельная фаза)
- Авто-обновление статусов доставки через tracking API (сейчас статус «доставлено» ставит оператор)
