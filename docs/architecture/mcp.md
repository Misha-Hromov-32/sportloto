# MCP: подключение внешнего ассистента

Правила: `backend/app/domain/features/mcp.py`. Типы — `frontend/src/types/mcp.ts`, консоль и выпуск токенов — `/settings/assistant`.

Токен задаёт пользователя и области доступа; доменные действия проходят через те же правила, что и интерфейс. Хранится только SHA-256 токена, предусмотрены отзыв, истечение срока, подтверждение изменений (`confirm: true`), журнал без содержимого запросов, лимит 30 вызовов в минуту и до 10 активных токенов. Версия протокола: `2025-06-18`.

## Точка протокола на сервере

`POST /mcp` в корне сайта (Streamable HTTP, только запрос — ответ; `GET /mcp` отвечает 405):

```
POST /mcp
Authorization: Bearer stp_…
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

- Методы: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.
- Нет токена, неизвестный, отозванный или истёкший — HTTP 401, ошибка `-32001` с причиной в `data.reason`. Нет нужной области — 403, `-32003`. Больше 30 вызовов в минуту — 429, `-32029` с `retryAfterSec`.
- Неверный JSON — 400, `-32700`; не объект JSON-RPC 2.0 или пакет — 400, `-32600`; уведомление без `id` — 202 без тела.
- Отказ инструмента или ошибка аргументов — 200 с `isError: true` и `structuredContent.error`.

Встроенная консоль вызывает те же правила через `POST /api/mcp` с телом `{ authorization, message }` и получает `{ httpStatus, response }`.

Для подключения по интернету нужен HTTPS (внешний прокси перед `web`).

Проверка: `tests/test_ai_switches.py::test_mcp_is_closed_until_enabled` (адрес закрыт, пока MCP выключен в админке).
