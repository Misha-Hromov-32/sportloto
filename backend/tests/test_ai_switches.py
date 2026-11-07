"""ИИ выключен по умолчанию, включается в админке с ключом и данными, каждая функция — отдельно."""

import asyncio
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.assistant import config
from app.assistant.bridge import hub
from app.domain import store
from tests.helpers import login
from tests.test_assistant_chat import enable_bridge, reply, seeded  # noqa: F401  фикстура seeded

ON_API = {
    "enabled": True,
    "mode": "api",
    "features": dict.fromkeys(config.FEATURES, True),
    "api": {"provider": "openai", "apiKey": "sk-key-123456789"},
}
RUDE_TEXT = "Все вы идиоты и дебилы, приходите на встречу"


async def _features(client: httpx.AsyncClient) -> dict[str, bool]:
    return (await client.get("/api/assistant/config")).json()["features"]


async def _admin_put(client: httpx.AsyncClient, body: dict[str, Any]) -> httpx.Response:
    return await client.put("/api/admin/assistant", headers=await login(client, "u-maria"), json=body)


async def _ask(client: httpx.AsyncClient, headers: dict[str, str] | None = None) -> httpx.Response:
    return await client.post(
        "/api/assistant/chat",
        headers=headers or {},
        json={"messages": [{"role": "user", "text": "Привет"}], "cityId": "krasnoyarsk"},
    )


@pytest.mark.usefixtures("seeded")
async def test_everything_is_off_by_default(client: httpx.AsyncClient) -> None:
    public = (await client.get("/api/assistant/config")).json()
    assert public["ready"] is False
    assert public["images"] is False
    assert set(public["features"]) == set(config.FEATURES)
    assert {name for name, on in public["features"].items() if on} == {"forms", "search", "premoderation"}

    view = (await client.get("/api/admin/assistant", headers=await login(client, "u-maria"))).json()
    assert view["enabled"] is False


async def test_saved_settings_without_switch_stay_off(
    seeded: FastAPI,  # noqa: F811  фикстура из test_assistant_chat
    client: httpx.AsyncClient,
) -> None:
    """Сервер с уже настроенным мостом после обновления остаётся выключенным, пока его не включат."""

    def old_settings() -> None:
        db = store.data()
        db.settings = {**db.settings, "assistant": {"mode": "websocket"}}

    await asyncio.to_thread(seeded.state.domain.store.write, old_settings)
    assert {name for name, on in (await _features(client)).items() if on} == {
        "forms",
        "search",
        "premoderation",
    }


@pytest.mark.usefixtures("seeded")
@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"enabled": True, "mode": "websocket"}, "bridge"),
        ({"enabled": True, "mode": "api"}, "api.apiKey"),
        ({"enabled": True, "mode": "local", "local": {"model": ""}}, "local.model"),
        (
            {"enabled": True, "mode": "api", "api": {"provider": "yandexgpt", "apiKey": "k-123456789"}},
            "api.folderId",
        ),
    ],
)
async def test_cannot_enable_without_key_and_data(
    client: httpx.AsyncClient, body: dict[str, Any], field: str
) -> None:
    refused = await _admin_put(client, body)
    assert refused.status_code == 422
    assert field in refused.json()["errors"]
    assert not (await _features(client))["chat"]


@pytest.mark.usefixtures("seeded")
async def test_enabling_turns_features_on_and_each_can_be_turned_off(client: httpx.AsyncClient) -> None:
    assert (await _admin_put(client, ON_API)).status_code == 200
    assert all((await _features(client)).values())

    saved = await _admin_put(client, {"features": {"forms": False, "unknown": True}})
    assert saved.json()["features"]["forms"] is False
    assert "unknown" not in saved.json()["features"]
    public = await _features(client)
    assert public["forms"] is False
    assert public["search"] is True

    await _admin_put(client, {"enabled": False})
    assert {name for name, on in (await _features(client)).items() if on} == {
        "search",
        "premoderation",
        "mcp",
    }
    view = (await client.get("/api/admin/assistant", headers=await login(client, "u-maria"))).json()
    assert view["api"]["apiKeySet"] is True, "ключ остаётся для следующего включения"
    assert view["features"]["forms"] is False


@pytest.mark.usefixtures("seeded")
async def test_chat_uses_model_only_when_enabled(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def ask(*_: object) -> str:
        return reply()

    monkeypatch.setattr(type(hub), "connected", property(lambda _: True))
    monkeypatch.setattr(hub, "ask", ask)

    assert (await _ask(client)).status_code == 503, "выключено: чат отвечает сам, без модели"

    admin = await login(client, "u-maria")
    await enable_bridge(client, admin)
    answered = await _ask(client)
    assert answered.status_code == 200, answered.text
    assert answered.json()["engine"] == "bridge"

    await _admin_put(client, {"features": {"chat": False}})
    assert (await client.get("/api/assistant/config")).json()["ready"] is False
    assert (await _ask(client)).status_code == 503


async def test_premoderation_flags_only_when_enabled(
    seeded: FastAPI,  # noqa: F811  фикстура из test_assistant_chat
    client: httpx.AsyncClient,
) -> None:
    anna = await login(client, "u-anna")

    async def flag_of_new_message() -> str | None:
        response = await client.post(
            "/api/messages", headers=anna, json={"eventId": "e-run-tatyshev", "text": RUDE_TEXT}
        )
        assert response.status_code == 200, response.text
        rows = await asyncio.to_thread(seeded.state.domain.store.read, lambda: store.data().messages)
        return next(m for m in rows if m["id"] == response.json()["id"])["aiFlag"]

    await _admin_put(client, {"features": {"premoderation": False}})
    assert await flag_of_new_message() == "none"
    await _admin_put(client, ON_API)
    assert await flag_of_new_message() != "none"


@pytest.mark.usefixtures("seeded")
async def test_mcp_is_closed_until_enabled(client: httpx.AsyncClient) -> None:
    await _admin_put(client, {"enabled": False, "features": {"mcp": False}})
    anna = await login(client, "u-anna")
    rpc = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    assert (await client.get("/api/mcp/catalog", headers=anna)).status_code == 404
    assert (await client.get("/api/mcp/tokens", headers=anna)).status_code == 404
    assert (await client.post("/mcp", json=rpc)).status_code == 404

    await _admin_put(client, {"features": {"mcp": True}})
    assert (await client.get("/api/mcp/catalog", headers=anna)).status_code == 200
    assert (await client.post("/mcp", json=rpc)).status_code != 404

    await _admin_put(client, {"features": {"mcp": False}})
    assert (await client.get("/api/mcp/catalog", headers=anna)).status_code == 404
