"""Адаптер YandexGPT (Yandex AI Studio, Foundation Models API).

Авторизация API-ключом сервисного аккаунта с ролью ai.languageModels.user, каталог — в x-folder-id.
Структурный ответ — через параметр jsonSchema; эмбеддинги — по одному тексту на запрос,
модели для документов и запросов разные (text-search-doc / text-search-query).
"""

import asyncio
from typing import Any

import httpx

from app.ai.errors import AiInvalidResponseError, AiUnavailableError
from app.ai.provider import ChatMessage, EmbedPurpose, ResponseSchema
from app.core.config import Settings

_EMBED_CONCURRENCY = 4


class YandexGptProvider:
    name = "yandexgpt"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        if settings.yandex_api_key is None or not settings.yandex_folder_id:
            raise ValueError("Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID")
        self._folder = settings.yandex_folder_id
        self._model_uri = f"gpt://{self._folder}/{settings.yandex_model}"
        self._embed_uris: dict[EmbedPurpose, str] = {
            "doc": f"emb://{self._folder}/{settings.yandex_embed_doc_model}",
            "query": f"emb://{self._folder}/{settings.yandex_embed_query_model}",
        }
        self._api_url = settings.yandex_api_url.rstrip("/")
        self._headers = {
            "Authorization": f"Api-Key {settings.yandex_api_key.get_secret_value()}",
            "x-folder-id": self._folder,
        }
        self._client = client or httpx.AsyncClient(timeout=settings.ai_timeout_seconds)

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(f"{self._api_url}{path}", headers=self._headers, json=payload)
        if not response.is_success:
            raise AiUnavailableError(f"YandexGPT ответил статусом {response.status_code}")
        return response.json()

    async def chat(self, messages: list[ChatMessage], *, schema: ResponseSchema, temperature: float) -> str:
        body = await self._post(
            "/completion",
            {
                "modelUri": self._model_uri,
                "completionOptions": {"stream": False, "temperature": temperature, "maxTokens": "2000"},
                "messages": [{"role": m.role, "text": m.content} for m in messages],
                "jsonSchema": {"schema": schema.json_schema},
            },
        )
        try:
            return str(body["result"]["alternatives"][0]["message"]["text"])
        except (KeyError, IndexError, TypeError) as exc:
            raise AiInvalidResponseError("YandexGPT вернул ответ без текста") from exc

    async def embed(self, texts: list[str], *, purpose: EmbedPurpose) -> list[list[float]]:
        semaphore = asyncio.Semaphore(_EMBED_CONCURRENCY)

        async def one(text: str) -> list[float]:
            async with semaphore:
                body = await self._post(
                    "/textEmbedding", {"modelUri": self._embed_uris[purpose], "text": text}
                )
            try:
                return [float(v) for v in body["embedding"]]
            except (KeyError, TypeError, ValueError) as exc:
                raise AiInvalidResponseError("YandexGPT вернул некорректный эмбеддинг") from exc

        return list(await asyncio.gather(*(one(text) for text in texts)))

    async def aclose(self) -> None:
        await self._client.aclose()
