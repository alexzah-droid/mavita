# DOCS — реестр документов МАВИТА-ШОП

Дата актуализации: 2026-06-30

Каждый документ живёт в одном месте. Остальные ссылаются, не дублируют.

Для планирования roadmap использовать активные planning specs из `docs/specs/`
и текущие статусы в `ROADMAP.md`/`docs/tech-debt.md`. Документы в
`docs/specs/done/` — источник факта реализации или historical reference; они не
становятся новым ТЗ без отдельной актуализации.

## Корневые документы

| Документ | Содержит | Статус |
| --- | --- | --- |
| `PROJECT_CORE.md` | контракт агента, инварианты, статус фаз | актуален (2026-06-28) |
| `CLAUDE.md` | вход для агента: стек, команды, архитектура кратко | актуален |
| `DOCS.md` | этот реестр | актуален |
| `ROADMAP.md` | план развития по фазам Ф0–Ф5, статусы (**источник статуса**) | актуален (2026-06-28) |
| `TESTING_PLAN.md` | трассировка тестов по инвариантам и требованиям | актуален (2026-06-28) |
| `architecture.md` | стек, схема БД, флоу оплаты, деплой | актуален (2026-06-28) |
| `architecture-components.md` | sequence/граф компонентов флоу оплаты | актуален (2026-06-28) |
| `brand.md` | бренд МАВИТА: миссия, ЦА, визуальная система, тон | актуален |

## docs/

| Документ | Содержит | Статус |
| --- | --- | --- |
| `docs/business-requirements.md` | каталог бизнес-требований и функций (`FR-*`/`BR-*`) — основа трассировки и справки | актуален (2026-06-28) |
| `docs/decisions.md` | журнал архитектурных и продуктовых решений | актуален (2026-06-25) |
| `docs/lessons-learned.md` | выученные уроки и обязательный preflight для внешних интеграций | актуален (2026-06-21) |
| `docs/tech-debt.md` | реестр техдолга и эксплуатационных замечаний | актуален (2026-06-28) |
| `docs/specs/` | спецификации фич (создаются по шаблону) | начат |
| `docs/specs/done/admin-products.md` | Ф4-компонент: авторизация + управление товарами и витриной (видимость, скидки) | ✅ реализована, на проде (2026-06-20) |
| `docs/specs/done/admin-orders.md` | Ф4-компонент: заказы, snapshot доставки, исполнение и безопасная отмена | ✅ реализован; production rollout подтверждается отдельно по VPS |
| `docs/specs/done/cdek-pvz.md` | Интеграция СДЭК: поиск ПВЗ + прокси `/api/cdek` | ✅ реализован; checkout использует текущий CDEK flow |
| `docs/specs/done/cdek-widget.md` | Виджет СДЭК с картой, `servicePath` `/api/cdek/widget`, fallback на ручной поток | ✅ реализован в репозитории |
| `docs/specs/delivery-options.md` | Стратегическая основа roadmap по доставке: порядок перевозчиков, gates, ограничения тарифа/snapshot | актуален как planning input (2026-06-30) |
| `docs/specs/done/cdek-manual-launch.md` | Переходный план ручного запуска СДЭК без API | historical/reference; реализовано иначе через API/виджет/outbox |
| `docs/specs/done/admin-delivery-settings.md` | Админ-модуль настроек СДЭК: шифрованные ключи в БД, тариф, «Проверить связь», семантика включения | ✅ реализована (2026-06-21) |
| `docs/specs/done/cdek-auto-shipment.md` | Автосоздание отправлений СДЭК, outbox, webhook, waybill/barcode | ✅ реализовано; sandbox пройден, prod readiness OK |
| `docs/specs/admin-security.md` | Security roadmap админки: текущий auth, PG-backed limiter, audit, TTL, TOTP | актуален как planning input (2026-06-30) |
| `docs/specs/yandex-delivery-pvz.md` | Яндекс Доставка: организационный gate, ПВЗ/постаматы по РФ и план безопасной интеграции | roadmap-кандидат после Gate 0 (2026-06-30) |
| `docs/specs/rupost-integration.md` | Почта России: индекс roadmap и границы фаз | planning index; не реализовано |
| `docs/specs/rupost-api-revalidation.md` | Почта России: API/live revalidation gate перед разработкой | обязательный preflight |
| `docs/specs/rupost-address-checkout.md` | Почта России: адресный checkout, нормализация, snapshot заказа | планируемая фаза после API gate |
| `docs/specs/rupost-batches-admin.md` | Почта России: worker, backlog, партии, Ф7п/Ф103, check-in, сдача | планируемая фаза после checkout/API gate |
| `docs/environments.md` | стенды, SSH, VPS, запреты | актуален |
| `docs/operations.md` | runbook деплоя, backup, откат | актуален (создан 2026-06-20) |
| `docs/legal-business-guide.md` | юр./бухгалтерия для самозанятого, Робокасса, 54-ФЗ (справочник) | reference |

## docs/project-bootstrap/

| Документ | Содержит |
| --- | --- |
| `README.md` | мета-описание bootstrap-комплекта |
| `ANTIPATTERNS.md` | типовые ловушки drift для этого проекта |
| `prompts/phase-F0-skeleton.md` | промпт для старта Фазы 0 |
| `templates/spec.template.md` | шаблон спецификации фичи |
| `templates/environments.template.md` | шаблон для docs/environments.md |
| `templates/operations.template.md` | шаблон для docs/operations.md |
| `templates/env.example.template` | шаблон для .env.example |

## КП-материалы (статика, не магазин)

| Файл | Содержит |
| --- | --- |
| `index.html` | бандлированное КП (в корне) — не редактировать |
| `archive/Мавита - четыре направления (один файл).html` | HTML-презентация четырёх направлений |
| `archive/mavita_kp.pdf` | PDF-версия КП |
