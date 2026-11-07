"""Данные платформы: ресурсы и действия API (docs/architecture/api.md) по HTTP.

Один обработчик на `/api/{путь}`:
- сначала ищется действие по таблице маршрутов (`POST /events/:id/join`, `GET /sports/suggest`, …);
- иначе это ресурс Refine: `GET /events` — список, `GET /events/:id` — карточка, `POST /events` — создание,
  `PUT /events/:id` — правка, `DELETE /events/:id` — удаление.

Список принимает фильтры, сортировку и страницы Refine JSON-строками в параметрах `filters`, `sorters`,
`pagination` и отвечает `{ data, total }`. GET выполняется на снимке данных, остальное — изменяющей
транзакцией. Пояс для подписей дат — по городу из заголовка `X-City`.
"""

import asyncio
import hmac
import json
import time
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.assistant import config as assistant_config
from app.core.errors import AppError, ErrorCode
from app.core.security import hash_session_token
from app.domain import clock, provider, store
from app.domain.lib.cities import city_by_id
from app.domain.routing import Route

router = APIRouter(tags=["данные платформы"])

# GET /api/_many/<ресурс>?ids=a,b — getMany Refine.
_MANY = "_many"
_COLLECTION = 1  # /events
_ITEM = 2  # /events/e-1
# Адреса служебных обработчиков: другой метод на них — 405, а не поиск ресурса.
_RESERVED = ("/health", "/stream", "/auth/", "/admin/ai/", "/access/", "/seo/", "/delivery/")


def session_token(request: Request) -> str | None:
    """Токен сессии: заголовок `Authorization: Bearer …` (своя сессия у каждой вкладки) или cookie."""
    header = request.headers.get("authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip() or None
    return request.cookies.get(request.app.state.settings.session_cookie_name)


def display_zone(request: Request) -> str:
    city = city_by_id(request.headers.get("x-city"))
    return city["timeZone"] if city else clock.DEFAULT_ZONE


async def run_domain[T](
    request: Request, fn: Callable[[], T], *, write: bool, user_id: str | None = None
) -> T:
    """Выполнить правило в транзакции от имени владельца сессии запроса (или явно указанного пользователя)."""
    token = session_token(request) if user_id is None else None
    return await request.app.state.domain.call(
        fn,
        write=write,
        token_hash=hash_session_token(token) if token else None,
        user_id=user_id,
        zone=display_zone(request),
    )


class DomainJSONResponse(JSONResponse):
    """JSON без экранирования кириллицы и без пробелов."""

    def render(self, content: object) -> bytes:
        return json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


async def _payload(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION, "Некорректный JSON", errors={"_": "Некорректный JSON"}) from exc
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AppError(ErrorCode.BAD_REQUEST, "Тело запроса должно быть объектом")
    return value


def _json_param(request: Request, name: str) -> object:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise AppError(
            ErrorCode.VALIDATION, f"Параметр {name} — не JSON", errors={name: "Некорректный JSON"}
        ) from exc


def from_bot(request: Request) -> bool:
    """Запрос подписан секретом бота (заголовок `X-Bot-Secret`)."""
    secret = request.app.state.settings.bot_api_secret.get_secret_value()
    given = request.headers.get("x-bot-secret", "")
    return bool(secret) and hmac.compare_digest(given.encode(), secret.encode())


async def _assistant(
    request: Request, handler: Route, groups: list[str], payload: dict[str, Any], query: dict[str, Any]
) -> object:
    """Вызов помощника: режим сбоя с запасным путём, журнал без текста запроса."""
    started = time.perf_counter()
    if from_bot(request) and not await run_domain(
        request, lambda: assistant_config.feature_on("bots"), write=False
    ):
        # Бот сам уйдёт на запасной путь: обычный поиск и создание по шагам
        raise AppError(ErrorCode.ASSISTANT_UNAVAILABLE, provider.ASSISTANT_DOWN)

    def elapsed() -> float:
        return (time.perf_counter() - started) * 1000

    failure, mode = await run_domain(request, provider.assistant_failure, write=False)
    if failure:
        if mode == "timeout":
            await asyncio.sleep(provider.ASSISTANT_TIMEOUT_SECONDS)
        await run_domain(request, lambda: provider.log_assistant(handler, elapsed(), ok=False), write=True)
        raise AppError(
            ErrorCode.ASSISTANT_UNAVAILABLE,
            provider.ASSISTANT_TIMEOUT if mode == "timeout" else provider.ASSISTANT_DOWN,
            extra=provider.assistant_fallback(handler, payload),
        )

    def run() -> object:
        result = handler.handle(groups, payload, query)
        provider.log_assistant(handler, elapsed(), ok=True)
        return result

    return await run_domain(request, run, write=True)


async def _resource(request: Request, method: str, segments: list[str], payload: dict[str, Any]) -> object:
    """CRUD ресурса Refine: список, карточка, getMany, создание, правка, удаление."""
    if method == "get" and len(segments) == _ITEM and segments[0] == _MANY:
        resource = segments[1]
        ids = [i for i in (request.query_params.get("ids") or "").split(",") if i]
        return await run_domain(request, lambda: provider.get_many(resource, ids), write=False)
    if len(segments) == _COLLECTION and method in {"get", "post"}:
        resource = segments[0]
        if method == "post":
            return await run_domain(request, lambda: provider.create(resource, payload), write=True)
        filters, sorters, pagination = (_json_param(request, k) for k in ("filters", "sorters", "pagination"))
        return await run_domain(
            request,
            lambda: provider.get_list(resource, filters, sorters, pagination),  # type: ignore[arg-type]
            write=False,
        )
    if len(segments) == _ITEM and method in {"get", "put", "patch", "delete"}:
        resource, id_ = segments
        if method == "get":
            meta = _json_param(request, "meta")
            return await run_domain(request, lambda: provider.get_one(resource, id_, meta), write=False)  # type: ignore[arg-type]
        if method == "delete":
            return await run_domain(request, lambda: provider.delete_one(resource, id_), write=True)
        return await run_domain(request, lambda: provider.update(resource, id_, payload), write=True)
    raise AppError(ErrorCode.NOT_FOUND, f"Действие {method.upper()} /{'/'.join(segments)} не поддерживается")


@router.post("/access/can", summary="Подсказка прав для интерфейса")
async def access_can(request: Request) -> Response:
    """Подсказка прав для `accessControlProvider.can`: `{resource, action, params?}` → `{can, reason?}`."""
    body = await _payload(request)
    result = await run_domain(
        request,
        lambda: provider.can(
            str(body.get("resource", "")), str(body.get("action", "")), body.get("params") or {}
        ),
        write=False,
    )
    return DomainJSONResponse(result)


def _actor_is_admin() -> bool:
    actor = provider.actor_id()
    return any(u["id"] == actor and u["role"] == "admin" for u in store.data().users)


_MCP = "/mcp"
# Выключаются на публичном сервере (DEMO_RESET_ENABLED=false).
_DEMO_SWITCHES = ("/demo/reset", "/demo/assistant-failure")


async def _require_demo_admin(request: Request, url_path: str) -> None:
    """Сброс демо-данных и демо-переключатели: только в демо-режиме и только администратору.

    Выключенные сброс и переключатели отвечают, как неизвестный маршрут, — администратору тоже.
    """
    settings = request.app.state.settings
    if not settings.demo_login_enabled or (not settings.demo_reset_enabled and url_path in _DEMO_SWITCHES):
        raise AppError(ErrorCode.NOT_FOUND)
    if not await run_domain(request, _actor_is_admin, write=False):
        raise AppError(ErrorCode.FORBIDDEN)


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def dispatch(path: str, request: Request) -> Response:
    method = request.method.lower()
    url_path = "/" + path.strip("/")
    if not request.app.state.settings.payments_enabled and (
        (url_path.startswith("/payments") and url_path != "/payments/settings")
        or (
            method != "get"
            and (
                url_path.startswith(("/orders", "/me/payouts", "/admin/payments", "/admin/payouts"))
                or (url_path.startswith("/shelf/") and url_path.endswith("/buy"))
            )
        )
    ):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Оплата на сайте отключена")
    if any(url_path == r.rstrip("/") or url_path.startswith(r) for r in _RESERVED):
        raise AppError(ErrorCode.METHOD_NOT_ALLOWED)
    payload = await _payload(request) if method != "get" else {}

    if (url_path == _MCP or url_path.startswith(f"{_MCP}/")) and not await run_domain(
        request, lambda: assistant_config.feature_on("mcp"), write=False
    ):
        raise AppError(ErrorCode.NOT_FOUND)

    if method == "get" and url_path == "/demo/accounts" and not request.app.state.settings.demo_login_enabled:
        return DomainJSONResponse([])
    if method != "get" and url_path.startswith("/demo/"):
        await _require_demo_admin(request, url_path)

    found = provider.registry().find_route(method, url_path)
    if found is None:
        segments = [s for s in url_path.split("/") if s]
        return DomainJSONResponse(await _resource(request, method, segments, payload))
    handler, groups = found
    query = dict(request.query_params)
    if handler.assistant:
        return DomainJSONResponse(await _assistant(request, handler, groups, payload, query))
    result = await run_domain(request, lambda: handler.handle(groups, payload, query), write=method != "get")
    return DomainJSONResponse(result)
