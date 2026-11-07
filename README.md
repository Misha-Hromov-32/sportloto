<div align="center">

<img src="docs/assets/readme/cover.jpg" alt="Спорт и точка" width="100%"/>

# Спорт и точка

Найдите компанию для тренировки, игры или прогулки.

[![Сайт](docs/assets/readme/site-button.svg)](https://sport.up-point.tech)
[![Презентация](docs/assets/readme/presentation-button.svg)](docs/presentation/sport-i-tochka.pdf)
[![Видео](docs/assets/readme/video-button.svg)](docs/video/README.md)
[![Документация](docs/assets/readme/docs-button.svg)](docs/README.md)

Кейс «Столото» · Финал чемпионата России по продуктовому программированию · Красноярск, 2026

[Проверки сборки и тестов](https://github.com/Misha-Hromov-32/sportloto/actions/workflows/ci.yml)
· [Сообщить об ошибке](https://github.com/Misha-Hromov-32/sportloto/issues/new/choose)
· [Предложить изменение](CONTRIBUTING.md)

</div>

## Что здесь можно делать

Искать спортивные встречи в Брянске, Москве и Красноярске, записываться на занятия и собирать свои.
До записи видно время, место, условия, организатора и свободные места.

- Найти встречу по спорту, району, дате и уровню подготовки. Посмотреть список или карту.
- Записаться сразу, подать заявку организатору или встать в лист ожидания.
- Спросить о встрече в обсуждении и получить ответ организатора.
- Найти партнёра для занятий через объявления «Ищу компанию».
- Создать страницу клуба, назначить управляющих и проводить встречи от его имени.
- Взять инвентарь на время или предложить свой на общей полке.
- Сохранить поиск, добавить встречу в избранное и подписаться на организатора.

Администратор проверяет клубы и рассматривает жалобы на встречи и сообщения.
Для входа нужны почта и пароль, при регистрации — подтверждение почты.

## Стек

| Часть         | Технологии                                     |
| ------------- | ---------------------------------------------- |
| Интерфейс     | React 19, TypeScript, Vite, Ant Design, Refine |
| Карта         | Leaflet, MapLibre                              |
| Сервер        | Python 3.12, FastAPI, SQLAlchemy, Alembic      |
| База данных   | PostgreSQL с pgvector                          |
| Развёртывание | Docker Compose, nginx                          |

## Запуск

Нужны Docker и Compose v2.

```bash
git clone https://github.com/Misha-Hromov-32/sportloto.git
cd sportloto
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml up -d --build --wait
```

Перед запуском задайте пароль базы и остальные настройки в `deploy/.env`.
На Windows файл можно скопировать командой `Copy-Item deploy/.env.example deploy/.env`.

Сайт откроется на <http://localhost:8080>, состояние сервера — <http://localhost:8080/api/health>.
Настройка сервера и тестового стенда описана в [инструкции по развёртыванию](docs/release/DEPLOY.md).

## Разработка

```bash
docker compose -f deploy/docker-compose.yml --profile dev up -d --build db backend-dev frontend-dev mailpit
```

Интерфейс: <http://localhost:5173>. Тестовые письма: <http://127.0.0.1:8025>.

## Проверки

```bash
cd frontend
npm ci
npm run check
npm audit
```

```bash
cd backend
uv sync --frozen
TEST_DATABASE_URL=postgresql+asyncpg://user:password@localhost:5433/sport_test uv run pytest -q
```

Тесты пересоздают схему базы — используйте отдельную тестовую БД.
В GitHub Actions запускаются проверки интерфейса, сборка, тесты сервера и ботов.
Сценарии API — в [scripts/scenarios](scripts/scenarios/README.md).

## В репозитории

| Папка                | Что внутри                                          |
| -------------------- | --------------------------------------------------- |
| `frontend/`          | интерфейс                                           |
| `backend/`           | API, правила, миграции и тесты                      |
| `deploy/`            | Dockerfile, Compose и nginx                         |
| `scripts/scenarios/` | сценарии проверки API                               |
| `docs/`              | описание продукта, архитектура, презентация и видео |

О проблемах безопасности можно сообщить по [этой инструкции](SECURITY.md).
