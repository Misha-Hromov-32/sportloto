"""Адаптер GigaChat API (Сбер).

Авторизация: ключ авторизации (Basic) обменивается на access token на 30 минут через OAuth-эндпоинт.
Ответ по схеме получаем через вызов функции: модель обязана вернуть аргументы функции `schema.name`.
Сертификаты GigaChat выпущены НУЦ Минцифры: путь к корневому сертификату задаётся в GIGACHAT_CA_BUNDLE.
"""

import asyncio
import json
import time
import uuid
from typing import Any

import httpx

from app.ai.errors import AiInvalidResponseError, AiUnavailableError
from app.ai.provider import ChatMessage, EmbedPurpose, ResponseSchema
from app.core.config import Settings

_TOKEN_REFRESH_MARGIN = 60.0


class GigaChatProvider:
    name = "gigachat"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        if settings.gigachat_auth_key is None:
            raise ValueError("Не задан GIGACHAT_AUTH_KEY")
        self._auth_key = settings.gigachat_auth_key.get_secret_value()
        self._scope = settings.gigachat_scope
        self._model = settings.gigachat_model
        self._embeddings_model = settings.gigachat_embeddings_model
        self._oauth_url = settings.gigachat_oauth_url
        self._api_url = settings.gigachat_api_url.rstrip("/")
        verify: str | bool = settings.gigachat_ca_bundle or settings.gigachat_verify_ssl
        self._client = client or httpx.AsyncClient(verify=verify, timeout=settings.ai_timeout_seconds)
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    async def _access_token(self, *, force: bool = False) -> str:
        async with self._token_lock:
            if not force and self._token and time.time() < self._token_expires_at - _TOKEN_REFRESH_MARGIN:
                return self._token
            response = await self._client.post(
                self._oauth_url,
                headers={
                    "Authorization": f"Basic {self._auth_key}",
                    "RqUID": str(uuid.uuid4()),
                    "Accept": "application/json",
                },
                data={"scope": self._scope},
            )
            _raise_for_status(response)
            body = response.json()
            self._token = str(body["access_token"])
            # expires_at приходит в миллисекундах от эпохи.
            self._token_expires_at = float(body.get("expires_at", 0)) / 1000 or time.time() + 1800
            return self._token

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(2):
            token = await self._access_token(force=attempt > 0)
            response = await self._client.post(
                f"{self._api_url}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                json=payload,
            )
            if response.status_code == 401 and attempt == 0:  # noqa: PLR2004
                continue
            _raise_for_status(response)
            return response.json()
        raise AiUnavailableError("GigaChat отклонил токен доступа")

    async def chat(self, messages: list[ChatMessage], *, schema: ResponseSchema, temperature: float) -> str:
        body = await self._post(
            "/chat/completions",
            {
                "model": self._model,
                "messages": [{"role": m.role, "content": m.content} for m in messages],
                # GigaChat не принимает нулевую температуру.
                "temperature": max(temperature, 0.01),
                "functions": [
                    {"name": schema.name, "description": schema.description, "parameters": schema.json_schema}
                ],
                "function_call": {"name": schema.name},
            },
        )
        try:
            message = body["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AiInvalidResponseError("GigaChat вернул ответ без сообщения") from exc
        call = message.get("function_call")
        if isinstance(call, dict) and "arguments" in call:
            arguments = call["arguments"]
            return arguments if isinstance(arguments, str) else json.dumps(arguments, ensure_ascii=False)
        return str(message.get("content", ""))

    async def embed(self, texts: list[str], *, purpose: EmbedPurpose) -> list[list[float]]:  # noqa: ARG002
        body = await self._post("/embeddings", {"model": self._embeddings_model, "input": texts})
        try:
            items = sorted(body["data"], key=lambda item: item.get("index", 0))
            return [[float(v) for v in item["embedding"]] for item in items]
        except (KeyError, TypeError, ValueError) as exc:
            raise AiInvalidResponseError("GigaChat вернул некорректные эмбеддинги") from exc

    async def aclose(self) -> None:
        await self._client.aclose()


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    # Тело ответа не логируем и не пробрасываем: в нём может оказаться текст пользователя.
    raise AiUnavailableError(f"GigaChat ответил статусом {response.status_code}")
