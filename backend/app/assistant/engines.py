"""Кто отвечает в режиме с моделью: локальная модель, мост на компьютере или внешний API.

- local — OpenAI-совместимый сервер в своей сети (Ollama, LM Studio, vLLM): адрес и модель;
- api — внешний провайдер: OpenAI-совместимый (адрес, ключ, модель), GigaChat или YandexGPT;
- websocket — программа-мост на компьютере (bridge/), которая отвечает через Codex.
Ответ — JSON-текст по prompt.REPLY_SCHEMA; проверяет его prompt.parse_reply.
"""

import json
from typing import Any

import httpx
from pydantic import SecretStr

from app.ai.gigachat import GigaChatProvider
from app.ai.provider import ChatMessage, ResponseSchema
from app.ai.yandexgpt import YandexGptProvider
from app.assistant import prompt
from app.assistant.bridge import hub
from app.core.config import Settings


class EngineError(RuntimeError):
    pass


async def _openai_compatible(
    url: str, model: str, api_key: str, messages: list[dict[str, str]], wait: float
) -> str:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=wait) as client:
        try:
            response = await client.post(f"{url.rstrip('/')}/chat/completions", headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise EngineError(f"Модель недоступна: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:  # noqa: PLR2004
        raise EngineError(f"Модель ответила ошибкой {response.status_code}")
    try:
        return str(response.json()["choices"][0]["message"]["content"])
    except (KeyError, IndexError, ValueError) as exc:
        raise EngineError("Непонятный ответ модели") from exc


def _schema_hint() -> str:
    return "Формат ответа — JSON по схеме:\n" + json.dumps(prompt.REPLY_SCHEMA, ensure_ascii=False)


async def answer(
    config: dict[str, Any], settings: Settings, ctx_text: str, history: list[dict[str, str]]
) -> tuple[str, str]:
    """Сырой JSON-ответ и подпись того, кто ответил."""
    mode = config["mode"]
    timeout = float(config["timeoutSeconds"])
    talk = prompt.conversation(history)
    if not talk:
        raise EngineError("Пустой вопрос")
    if mode == "websocket":
        try:
            raw = await hub.ask(prompt.flat_prompt(ctx_text, talk), prompt.REPLY_SCHEMA, timeout)
        except RuntimeError as exc:
            raise EngineError(str(exc)) from exc
        return raw, "bridge"

    question = " ".join(m["content"] for m in talk[-3:] if m["role"] == "user")
    system = (
        f"{prompt.system_prompt(question)}\n\n# Данные сайта на этот момент\n\n{ctx_text}\n\n{_schema_hint()}"
    )
    messages = [{"role": "system", "content": system}, *talk]
    return await _chat(config, settings, messages, prompt.REPLY_SCHEMA, timeout)


async def _chat(
    config: dict[str, Any],
    settings: Settings,
    messages: list[dict[str, str]],
    json_schema: dict[str, Any],
    wait: float,
) -> tuple[str, str]:
    """Локальная модель или внешний API: сообщения system/user → JSON-текст по схеме."""
    mode = config["mode"]
    if mode == "local":
        local = config["local"]
        return await _openai_compatible(local["url"], local["model"], "", messages, wait), "local"
    if mode != "api":
        raise EngineError("Режим без модели")

    api = config["api"]
    if not api["apiKey"]:
        raise EngineError("Не задан ключ внешнего API")
    if api["provider"] == "openai":
        return await _openai_compatible(api["url"], api["model"], api["apiKey"], messages, wait), "api"

    chat = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]  # type: ignore[arg-type]
    schema = ResponseSchema(name="assistant_reply", description="Ответ помощника", json_schema=json_schema)
    if api["provider"] == "gigachat":
        tuned = settings.model_copy(
            update={
                "gigachat_auth_key": SecretStr(api["apiKey"]),
                "gigachat_model": api["model"] or settings.gigachat_model,
                "ai_timeout_seconds": wait,
            }
        )
        provider: GigaChatProvider | YandexGptProvider = GigaChatProvider(tuned)
    else:
        tuned = settings.model_copy(
            update={
                "yandex_api_key": SecretStr(api["apiKey"]),
                "yandex_folder_id": api["folderId"] or settings.yandex_folder_id,
                "yandex_model": api["model"] or settings.yandex_model,
                "ai_timeout_seconds": wait,
            }
        )
        provider = YandexGptProvider(tuned)
    try:
        return await provider.chat(chat, schema=schema, temperature=0.2), "api"
    except Exception as exc:
        raise EngineError(f"Внешний API не ответил: {exc.__class__.__name__}") from exc
    finally:
        await provider.aclose()


async def complete(
    config: dict[str, Any],
    settings: Settings,
    instruction: str,
    json_schema: dict[str, Any],
    wait: float = 25,
) -> dict[str, Any]:
    """Короткая задача для модели вне чата (заполнить профиль, вступление к письму).

    Ответ — разобранный JSON по схеме. Режим без модели, нет моста, сбой — EngineError: у вызывающего
    всегда есть ответ без модели.
    """
    mode = config["mode"]
    wait = min(wait, float(config["timeoutSeconds"]))
    if mode == "builtin":
        raise EngineError("Режим без модели")
    if mode == "websocket":
        try:
            raw = await hub.ask(f"{instruction}\n\nСразу верни один JSON-объект по схеме.", json_schema, wait)
        except RuntimeError as exc:
            raise EngineError(str(exc)) from exc
    else:
        hint = "Формат ответа — JSON по схеме:\n" + json.dumps(json_schema, ensure_ascii=False)
        messages = [{"role": "system", "content": hint}, {"role": "user", "content": instruction}]
        raw, _ = await _chat(config, settings, messages, json_schema, wait)
    try:
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
    except ValueError as exc:
        raise EngineError("Модель вернула не JSON") from exc
    if not isinstance(data, dict):
        raise EngineError("Модель вернула не объект")
    return data
