"""Удаление аккаунта и журнал согласий (152-ФЗ): что удаляется, что обезличивается, кто не может удалить."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import LEGAL_VERSION
from app.db.models import AuthSession, User, UserConsent
from app.domain import clock, provider, seed
from tests.conftest import CONSENTS

NOW = clock.parse("2026-10-19T03:00:00.000Z")


@pytest.fixture
async def seeded(app: FastAPI) -> AsyncIterator[FastAPI]:
    clock.set_frozen(NOW)
    await asyncio.to_thread(app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW)))
    try:
        yield app
    finally:
        clock.set_frozen(None)


async def login(client: httpx.AsyncClient, email: str, password: str = "") -> dict[str, str]:
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {response.json()['token']}"}


def filters(*items: tuple[str, str, Any]) -> dict[str, str]:
    return {
        "filters": json.dumps([{"field": f, "operator": op, "value": v} for f, op, v in items]),
        "pagination": json.dumps({"mode": "off"}),
    }


async def consents(session: AsyncSession, user_id: str) -> list[UserConsent]:
    rows = await session.scalars(select(UserConsent).where(UserConsent.user_id == user_id))
    return sorted(rows, key=lambda c: c.kind)


@pytest.mark.usefixtures("seeded")
async def test_registration_records_three_consents(client: httpx.AsyncClient, session: AsyncSession) -> None:
    created = await client.post(
        "/api/auth/register",
        json={"name": "Вера Новикова", "email": "vera@example.ru", "password": "long-secret", **CONSENTS},
    )

    assert created.status_code == 200, created.text
    rows = await consents(session, created.json()["id"])
    assert [c.kind for c in rows] == ["personal_data", "public_profile", "terms"]
    assert {c.version for c in rows} == {LEGAL_VERSION}
    assert all(c.ip and c.created_at and c.revoked_at is None for c in rows)


@pytest.mark.usefixtures("seeded")
async def test_delete_account_needs_password_and_closes_everything(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    created = await client.post(
        "/api/auth/register",
        json={"name": "Вера Новикова", "email": "vera@example.ru", "password": "long-secret", **CONSENTS},
    )
    user_id = created.json()["id"]
    client.cookies.clear()
    vera = {"Authorization": f"Bearer {created.json()['token']}"}
    joined = await client.post("/api/events/e-run-tatyshev/join", json={}, headers=vera)
    assert joined.json()["my"]["status"] == "confirmed"

    wrong = await client.post("/api/auth/delete-account", json={"password": "nope-nope"}, headers=vera)
    assert wrong.status_code == 422
    assert "password" in wrong.json()["errors"]

    deleted = await client.post("/api/auth/delete-account", json={"password": "long-secret"}, headers=vera)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"ok": True}

    # Сессии нет, войти нельзя, согласия отозваны, профиль обезличен.
    assert (await client.get("/api/auth/me", headers=vera)).status_code == 401
    again = await client.post("/api/auth/login", json={"email": "vera@example.ru", "password": "long-secret"})
    assert again.status_code == 401
    assert await session.scalar(select(func.count()).where(AuthSession.user_id == user_id)) == 0
    assert all(c.revoked_at is not None for c in await consents(session, user_id))
    user = await session.get(User, user_id)
    assert user is not None
    assert (user.name, user.role, user.is_active, user.password_hash) == (
        "Удалённый пользователь",
        "deleted",
        False,
        None,
    )
    assert user.email == f"{user_id}@deleted.invalid"

    # Место освободилось, организатор узнал об отмене записи.
    dmitry = await login(client, "dmitry@vmeste.demo")
    manage = (await client.get("/api/events/e-run-tatyshev", headers=dmitry)).json()["manage"]
    assert all(p["user"]["id"] != user_id for p in manage["confirmed"])
    notes = (await client.get("/api/notifications", params=filters(), headers=dmitry)).json()["data"]
    assert notes[0]["type"] == "left"
    assert (await client.get(f"/api/users/{user_id}", headers=dmitry)).status_code == 404

    # С той же почтой можно зарегистрироваться заново.
    fresh = await client.post(
        "/api/auth/register",
        json={"name": "Вера Новикова", "email": "vera@example.ru", "password": "long-secret", **CONSENTS},
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["id"] != user_id


@pytest.mark.usefixtures("seeded")
async def test_deleted_organizer_cancels_events_and_messages_lose_author(client: httpx.AsyncClient) -> None:
    nikita = await login(client, "nikita@vmeste.demo")

    deleted = await client.post("/api/auth/delete-account", json={}, headers=nikita)
    assert deleted.status_code == 200, deleted.text

    dmitry = await login(client, "dmitry@vmeste.demo")
    event = (await client.get("/api/events/e-basket-collect", headers=dmitry)).json()
    assert event["status"] == "cancelled"
    notes = (await client.get("/api/notifications", params=filters(), headers=dmitry)).json()["data"]
    cancelled = [n for n in notes if n["type"] == "cancelled" and "e-basket-collect" in n["link"]]
    assert cancelled
    assert "организатор удалил аккаунт" in cancelled[0]["text"]

    messages = (
        await client.get("/api/messages", params=filters(("eventId", "eq", "e-volley-hall")), headers=dmitry)
    ).json()["data"]
    authors = {m["id"]: m["author"] for m in messages}
    assert authors["m-3"]["name"] == "Удалённый пользователь"
    assert authors["m-3"]["id"] == ""
    assert (await client.get("/api/users/u-nikita", headers=dmitry)).status_code == 404
    people = (await client.get("/api/people/suggest", params={"q": "Никита"}, headers=dmitry)).json()
    assert all(p["id"] != "u-nikita" for p in people)


@pytest.mark.usefixtures("seeded")
async def test_demo_accounts_and_org_owners_cannot_delete(client: httpx.AsyncClient) -> None:
    anna = await login(client, "anna@vmeste.demo")
    valentina = await login(client, "valentina@vmeste.demo")

    demo = await client.post("/api/auth/delete-account", json={}, headers=anna)
    owner = await client.post("/api/auth/delete-account", json={}, headers=valentina)
    guest = await client.post("/api/auth/delete-account", json={})

    assert demo.status_code == 403
    assert demo.json()["message"].startswith("Демо-аккаунт удалить нельзя")
    assert owner.status_code == 409
    assert "представитель организации" in owner.json()["message"]
    assert guest.status_code == 401
    # Отказ ничего не меняет: аккаунт работает.
    assert (await client.get("/api/auth/me", headers=anna)).status_code == 200
