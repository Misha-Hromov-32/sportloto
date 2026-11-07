# Сценарии запросов к API

Сценарий — последовательность запросов к HTTP API бэкенда (`backend/app/domain`). Прогон поднимает сервер
в процессе на отдельной базе `vmeste_scenarios`, замораживает часы на одном моменте, заново загружает
демо-данные и выполняет шаги по порядку. Перед каждым шагом выполняются проверки по времени (резервы,
напоминания), как фоновый тик.

Результат — код ответа и код ошибки каждого шага. Ответ 5xx — всегда ошибка прогона.

```sh
scripts/scenarios/run.sh scripts/scenarios/flows-core.json          # S1–S6: создание, допуск, запись, заявки, вопросы, снятие
scripts/scenarios/run.sh scripts/scenarios/flows-participation.json # запись: резерв из листа ожидания, порог, состав, план Б, серия, команда, дети, приглашения, напоминания
scripts/scenarios/run.sh scripts/scenarios/flows-community.json     # сообщество: встречающий, спрос, подбор, модерация, жалобы, импорт, площадки, инвентарь, избранное, MCP
scripts/scenarios/run.sh scripts/scenarios/flows-review.json        # разбор замечаний
scripts/scenarios/run.sh scripts/scenarios/flows-stoplist.json      # стоп-лист организатора и «Убрать из участников»
scripts/scenarios/run.sh scripts/scenarios/flows-payments.json      # оплата на сайте (провайдер fake)
scripts/scenarios/run.sh scripts/scenarios/flows-account.json       # удаление аккаунта
scripts/scenarios/run.sh scripts/scenarios/flows-swipe.json         # режим «По одной»: лента и разбор заявок
```

Другой момент времени задаётся переменной `SCENARIOS_NOW` (ISO, по умолчанию `2026-10-19T03:00:00.000Z`).

## Эталон и сравнение

Записать коды ответов как эталон и сравнить с ним после правок:

```sh
scripts/scenarios/run.sh scripts/scenarios/flows-core.json --out /tmp/core.codes.json     # записать
scripts/scenarios/run.sh scripts/scenarios/flows-core.json --expect /tmp/core.codes.json  # сравнить
```

С `--expect` каждый шаг, у которого изменился код ответа или код ошибки, выводится в отчёте,
а прогон завершается с ошибкой.

## Обход

Сценарий «обход» (около 4900 запросов) строится из демо-данных, а не хранится в репозитории: все чтения под
каждой демо-ролью и гостем — списки, карточки, GET-действия. Он ловит ответы 5xx и расхождения в правах.

```sh
docker compose -f deploy/docker-compose.yml --profile test run --rm -T \
  -v "$PWD/scripts/scenarios:/scenarios" backend-test python /scenarios/make_crawl.py > /tmp/crawl.json
scripts/scenarios/run.sh /tmp/crawl.json --out /tmp/crawl.codes.json
```

## Формат сценария

Массив шагов. `as` — кто выполняет (id пользователя из демо-данных или `"{{N.ok.id}}"` зарегистрированного
на шаге N; `null` — гость). Демо-аккаунты входят через `demo-login`, остальные участники демо-данных — по почте
без пароля. Необязательное поле `note` — пояснение шага, оно печатается в отчёте.

| `op` | Поля | Что делает |
|---|---|---|
| `list` | `resource`, `filters`, `sorters`, `pagination` | `GET /api/<resource>` (getList Refine) |
| `one` | `resource`, `id`, `meta` | `GET /api/<resource>/<id>` |
| `many` | `resource`, `ids` | getMany |
| `create`, `update`, `delete` | `resource`, `id`, `body` | `POST`, `PUT`, `DELETE` ресурса |
| `custom` | `method`, `url`, `body`, `query` | действие (`POST /api/events/:id/join` и т. п.) |
| `register` | `body` | регистрация |
| `delete-account` | `body` | удаление своего аккаунта (`POST /api/auth/delete-account`) |
| `advance` | `minutes` | сдвинуть часы |
| `reset` | — | заново загрузить демо-данные |

В строках можно ссылаться на результат предыдущего шага: `"{{3.ok.id}}"` — поле `id` ответа шага 3.
