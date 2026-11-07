"""Чат-помощник: режимы для администратора, ответ моделью с подбором встреч, мост, разбор ответа."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.assistant import prompt
from app.assistant.bridge import BridgeHub, BridgeUnavailableError, hub
from app.domain import clock, provider, seed
from tests.helpers import NOW, login


@pytest.fixture
async def seeded(app: FastAPI) -> AsyncIterator[FastAPI]:
    clock.set_frozen(NOW)
    await asyncio.to_thread(app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW)))
    try:
        yield app
    finally:
        clock.set_frozen(None)


async def enable_bridge(client: httpx.AsyncClient, admin: dict[str, str]) -> None:
    await client.post("/api/admin/assistant/bridge-key", headers=admin)
    saved = await client.put(
        "/api/admin/assistant", headers=admin, json={"enabled": True, "mode": "websocket"}
    )
    assert saved.status_code == 200, saved.text


def reply(**overrides: Any) -> str:
    base: dict[str, Any] = {
        "text": "Нашёл встречи по волейболу.",
        "links": [{"label": "Открыть поиск", "to": "/events"}],
        "search": None,
        "action": None,
        "question": None,
        "options": [],
    }
    return json.dumps({**base, **overrides}, ensure_ascii=False)


@pytest.mark.usefixtures("seeded")
async def test_settings_only_for_admin(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/admin/assistant")).status_code == 401
    anna = await login(client, "u-anna")
    assert (await client.get("/api/admin/assistant", headers=anna)).status_code == 403
    admin = await login(client, "u-maria")
    body = (await client.get("/api/admin/assistant", headers=admin)).json()
    assert body["mode"] == "builtin"
    assert body["bridge"]["connected"] is False


@pytest.mark.usefixtures("seeded")
async def test_admin_switches_mode_and_key_is_masked(client: httpx.AsyncClient) -> None:
    admin = await login(client, "u-maria")
    bad = await client.put("/api/admin/assistant", headers=admin, json={"mode": "magic"})
    assert bad.status_code == 422
    assert "mode" in bad.json()["errors"]

    saved = await client.put(
        "/api/admin/assistant",
        headers=admin,
        json={
            "enabled": True,
            "mode": "api",
            "api": {"provider": "openai", "apiKey": "sk-secret-123456789", "model": "m"},
        },
    )
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["mode"] == "api"
    assert view["api"]["apiKeySet"] is True
    assert "secret" not in json.dumps(view)
    # Пустой ключ при сохранении формы не стирает сохранённый
    again = await client.put("/api/admin/assistant", headers=admin, json={"api": {"apiKey": ""}})
    assert again.json()["api"]["apiKeySet"] is True
    public = (await client.get("/api/assistant/config")).json()
    assert (public["mode"], public["ready"], public["images"]) == ("api", True, False)


@pytest.mark.usefixtures("seeded")
async def test_builtin_mode_sends_chat_to_fallback(client: httpx.AsyncClient) -> None:
    public = (await client.get("/api/assistant/config")).json()
    assert (public["mode"], public["ready"], public["images"]) == ("builtin", False, False)
    response = await client.post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "text": "Привет"}], "cityId": "krasnoyarsk"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "assistant_unavailable"


@pytest.mark.usefixtures("seeded")
async def test_bridge_mode_answers_with_site_events(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = await login(client, "u-maria")
    await enable_bridge(client, admin)
    assert (await client.get("/api/assistant/config")).json()["ready"] is False

    seen: dict[str, Any] = {}

    async def ask(text: str, schema: dict[str, Any], _wait: float) -> str:
        seen["prompt"] = text
        seen["schema"] = schema
        return reply(
            search="волейбол на выходных",
            action={
                "type": "navigate",
                "summary": "Открыть чужой сайт",
                "params": dict.fromkeys(prompt.ACTION_PARAMS) | {"path": "//evil.example"},
            },
            links=[{"label": "Чужой сайт", "to": "https://evil.example"}, {"label": "Мои", "to": "/me"}],
        )

    monkeypatch.setattr(type(hub), "connected", property(lambda _: True))
    monkeypatch.setattr(hub, "ask", ask)
    anna = await login(client, "u-anna")
    response = await client.post(
        "/api/assistant/chat",
        headers=anna,
        json={"messages": [{"role": "user", "text": "Куда сходить в выходные?"}], "cityId": "krasnoyarsk"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["engine"] == "bridge"
    assert body["links"] == [{"label": "Мои", "to": "/me"}]
    assert body["action"] is None
    assert body["match"]["items"], "подбор встреч делает система сайта"
    assert "Подборка «Для вас»" in seen["prompt"]
    assert "Куда сходить в выходные?" in seen["prompt"]
    assert seen["schema"] is prompt.REPLY_SCHEMA


async def test_bridge_errors_become_fallback(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fail(*_: object) -> str:
        raise BridgeUnavailableError("Мост не ответил вовремя")

    monkeypatch.setattr(type(hub), "connected", property(lambda _: True))
    monkeypatch.setattr(hub, "ask", fail)
    clock.set_frozen(NOW)
    try:
        app = client._transport.app  # type: ignore[attr-defined]
        await asyncio.to_thread(
            app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW))
        )
        admin = await login(client, "u-maria")
        await enable_bridge(client, admin)
        response = await client.post(
            "/api/assistant/chat", json={"messages": [{"role": "user", "text": "Привет"}]}
        )
    finally:
        clock.set_frozen(None)
    assert response.status_code == 503


@pytest.mark.usefixtures("seeded")
async def test_bridge_key_is_shown_once_and_survives_demo_reset(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    admin = await login(client, "u-maria")
    issued = (await client.post("/api/admin/assistant/bridge-key", headers=admin)).json()
    key = issued["key"]
    assert key.startswith("stb_")
    assert issued["bridge"]["keySet"] is True
    view = (await client.get("/api/admin/assistant", headers=admin)).json()
    assert key not in json.dumps(view)

    await asyncio.to_thread(app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW)))
    from app.assistant import config  # noqa: PLC0415

    assert await app.state.domain.call(lambda: config.bridge_key_ok(key), write=False)
    assert not await app.state.domain.call(lambda: config.bridge_key_ok(key + "x"), write=False)


class FakeSocket:
    """WebSocket для хаба: входящие сообщения из очереди, исходящие — в список."""

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.sent: list[dict[str, Any]] = []
        self.closed: int | None = None

    async def accept(self) -> None:
        return None

    async def receive_text(self) -> str:
        text = await self.incoming.get()
        if text == "__close__":
            raise RuntimeError("closed")
        return text

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))

    async def close(self, code: int = 1000) -> None:
        self.closed = code


async def test_hub_routes_request_to_bridge_and_back() -> None:
    local = BridgeHub()
    ws = FakeSocket()

    async def check(key: str) -> bool:
        return key == "stb_ok"

    task = asyncio.create_task(local.serve(ws, check))  # type: ignore[arg-type]
    await ws.incoming.put(json.dumps({"type": "hello", "key": "stb_ok", "name": "ПК", "engine": "codex"}))
    for _ in range(50):
        if local.connected:
            break
        await asyncio.sleep(0.01)
    assert local.status()["clients"][0]["name"] == "ПК"

    asking = asyncio.create_task(local.ask("вопрос", {"type": "object"}, 5))
    for _ in range(50):
        if any(m["type"] == "request" for m in ws.sent):
            break
        await asyncio.sleep(0.01)
    request = next(m for m in ws.sent if m["type"] == "request")
    assert request["prompt"] == "вопрос"
    await ws.incoming.put(json.dumps({"type": "response", "id": request["id"], "ok": True, "content": "{}"}))
    assert await asking == "{}"

    await ws.incoming.put("__close__")
    await task
    assert not local.connected
    with pytest.raises(BridgeUnavailableError):
        await local.ask("ещё", {}, 1)


async def test_hub_rejects_wrong_key() -> None:
    local = BridgeHub()
    ws = FakeSocket()

    async def check(_: str) -> bool:
        return False

    await ws.incoming.put(json.dumps({"type": "hello", "key": "stb_bad"}))
    await local.serve(ws, check)  # type: ignore[arg-type]
    assert ws.closed == 4401
    assert not local.connected


def test_parse_reply_keeps_only_safe_fields() -> None:
    raw = "Вот ответ: " + reply(
        action={
            "type": "create_event",
            "summary": "Создать встречу",
            "params": dict.fromkeys(prompt.ACTION_PARAMS)
            | {"sport": "Волейбол", "capacity": "12", "price": -5, "date": "2026-10-25"},
        },
        options=["Да", "", "Нет"],
    )
    parsed = prompt.parse_reply(raw)
    assert parsed["action"]["params"] == {
        "sport": "Волейбол",
        "capacity": 12,
        "price": 0,
        "date": "2026-10-25",
    }
    assert parsed["options"] == ["Да", "Нет"]
    with pytest.raises(ValueError, match="текста"):
        prompt.parse_reply(json.dumps({"text": ""}))
