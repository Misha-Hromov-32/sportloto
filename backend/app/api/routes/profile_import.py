"""Заполнить профиль из ВКонтакте: `GET /api/profile/vk` — включено ли, `POST /api/profile/vk/preview`.

Предпросмотр только предлагает: «О себе», виды спорта с объяснением, уровень и фото. Переносит человек
сам обычной правкой профиля, поэтому права и проверки те же, что у формы.
"""

import time
from collections import defaultdict, deque
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.api.routes.domain import DomainJSONResponse, run_domain
from app.assistant import config as assistant_config
from app.assistant import engines
from app.assistant.bridge import hub
from app.core.errors import AppError, ErrorCode
from app.domain import provider, store
from app.domain.errors import fail
from app.integrations import vk

router = APIRouter(tags=["профиль"])

_LIMIT_PER_MINUTE = 6
_recent: dict[str, deque[float]] = defaultdict(deque)


def _limit(key: str) -> None:
    now = time.monotonic()
    calls = _recent[key]
    while calls and now - calls[0] > 60:  # noqa: PLR2004
        calls.popleft()
    if len(calls) >= _LIMIT_PER_MINUTE:
        raise AppError(ErrorCode.RATE_LIMIT, "Слишком много попыток подряд. Подождите минуту")
    calls.append(now)


def _vk_token(request: Request) -> str | None:
    """Ключ VK из окружения; пустая переменная в docker compose — тоже «не задан»."""
    secret = request.app.state.settings.vk_service_token
    value = secret.get_secret_value().strip() if secret is not None else ""
    return value or None


@router.get("/profile/vk", summary="Можно ли заполнить профиль из ВКонтакте")
async def vk_status(request: Request) -> Response:
    return DomainJSONResponse({"enabled": _vk_token(request) is not None})


@router.post("/profile/vk/preview", summary="Что можно перенести в профиль со страницы ВКонтакте")
async def vk_preview(request: Request) -> Response:
    settings = request.app.state.settings
    token = _vk_token(request)
    if token is None:
        raise AppError(ErrorCode.BAD_REQUEST, "Заполнение из ВКонтакте пока не включено")
    body = await request.json()
    ref = vk.parse_link(str((body or {}).get("link") or "")) if isinstance(body, dict) else None

    def who() -> tuple[str, list[Any], dict[str, Any], bool]:
        actor = provider.actor()
        if not actor:
            fail("auth_required", "Войдите, чтобы заполнить профиль")
        sports = [s for s in store.data().sports if s.get("status", "active") == "active"]
        model_config = assistant_config.read()
        ready = assistant_config.allows(model_config, "profile") and assistant_config.model_ready(
            model_config, connected=hub.connected
        )
        return actor["id"], sports, model_config, ready

    actor_id, sports, model_config, ready = await run_domain(request, who, write=False)
    if not ref:
        fail(
            "validation",
            "Не похоже на ссылку на страницу ВКонтакте",
            {"link": "Вставьте ссылку вида vk.com/имя или vk.com/id123"},
        )
    _limit(actor_id)
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        try:
            user = await vk.fetch_profile(client, settings.vk_api_url, token, ref)
        except vk.VkError as exc:
            fail("validation", str(exc), {"link": str(exc)})
        photo = await vk.fetch_photo(client, user)
        # Последние 10 записей на стене: читаем на лету, тексты не сохраняем
        closed = bool(user.get("is_closed")) and not user.get("can_access_closed")
        posts = [] if closed else await vk.fetch_posts(client, settings.vk_api_url, token, int(user["id"]))
    found = vk.suggest(user, sports, posts)
    if ready:
        try:
            ai = await engines.complete(
                model_config,
                settings,
                vk.ai_instruction(user, [s["name"] for s in sports], posts),
                vk.AI_SCHEMA,
                wait=25,
            )
            found = vk.merge_ai(found, ai, sports)
        except engines.EngineError:
            pass  # остаётся разбор без модели
    return DomainJSONResponse({**found, "photo": photo})
