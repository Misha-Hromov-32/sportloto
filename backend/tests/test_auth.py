from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import SEARCH_PARSE
from app.db.models import AuthSession, User, UserRole
from app.main import create_app
from tests.conftest import CONSENTS, UserFactory, make_settings

COOKIE = "vmeste_session"


async def login(client: httpx.AsyncClient, email: str, password: str = "secret-pass") -> httpx.Response:
    return await client.post("/api/auth/login", json={"email": email, "password": password})


async def test_password_is_stored_as_argon2_hash(make_user: UserFactory) -> None:
    user = await make_user(password="secret-pass")

    assert user.password_hash is not None
    assert user.password_hash.startswith("$argon2")
    assert "secret-pass" not in user.password_hash


async def test_login_sets_httponly_cookie_and_returns_user(
    client: httpx.AsyncClient, make_user: UserFactory
) -> None:
    user = await make_user(email="anna@vmeste.demo")

    response = await login(client, "anna@vmeste.demo")

    assert response.status_code == 200
    body = response.json()
    assert {k: body[k] for k in ("id", "name", "email", "role", "demo")} == {
        "id": user.id,
        "name": "Анна Петрова",
        "email": "anna@vmeste.demo",
        "role": "user",
        "demo": None,
    }
    # Токен — для заголовка Authorization (своя сессия у каждой вкладки), identity — в форме контракта API.
    assert len(body["token"]) >= 40
    assert body["identity"]["id"] == user.id
    assert body["identity"]["role"] == "user"
    set_cookie = response.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie


async def test_login_ignores_email_case_and_spaces(client: httpx.AsyncClient, make_user: UserFactory) -> None:
    await make_user(email="anna@vmeste.demo")

    response = await login(client, "  Anna@VMESTE.demo ")

    assert response.status_code == 200


@pytest.mark.parametrize(("email", "password"), [("anna@vmeste.demo", "wrong"), ("nobody@vmeste.demo", "x")])
async def test_login_rejects_bad_credentials_without_hinting(
    client: httpx.AsyncClient, make_user: UserFactory, email: str, password: str
) -> None:
    await make_user(email="anna@vmeste.demo")

    response = await login(client, email, password)

    assert response.status_code == 401
    assert response.json() == {
        "code": "invalid_credentials",
        "statusCode": 401,
        "message": "Неверная почта или пароль",
    }
    assert "set-cookie" not in response.headers


async def test_user_without_password_cannot_login_by_password(
    client: httpx.AsyncClient, make_user: UserFactory
) -> None:
    await make_user(email="demo@vmeste.demo", password=None)

    response = await login(client, "demo@vmeste.demo", "anything")

    assert response.status_code == 401


async def test_registration_requires_password(client: httpx.AsyncClient) -> None:
    # Без пароля в демо-режиме входят по одной почте: зарегистрированный аккаунт так открываться не должен.
    response = await client.post(
        "/api/auth/register", json={"name": "Вера", "email": "vera@example.test", **CONSENTS}
    )

    assert response.status_code == 422
    assert response.json()["errors"] == {"password": "Не короче 8 символов"}


async def test_me_requires_session(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == {
        "code": "auth_required",
        "statusCode": 401,
        "message": "Войдите, чтобы продолжить",
    }


async def test_me_returns_current_user(client: httpx.AsyncClient, make_user: UserFactory) -> None:
    user = await make_user(email="anna@vmeste.demo")
    await login(client, "anna@vmeste.demo")

    response = await client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["id"] == user.id


async def test_logout_ends_session(
    client: httpx.AsyncClient, make_user: UserFactory, session: AsyncSession
) -> None:
    await make_user(email="anna@vmeste.demo")
    await login(client, "anna@vmeste.demo")

    response = await client.post("/api/auth/logout")

    assert response.status_code == 204
    assert (
        f'{COOKIE}=""' in response.headers["set-cookie"]
        or "max-age=0" in response.headers["set-cookie"].lower()
    )
    assert (await client.get("/api/auth/me")).status_code == 401
    assert await session.scalar(select(func.count()).select_from(AuthSession)) == 0


async def test_old_token_stops_working_after_logout(
    client: httpx.AsyncClient, make_user: UserFactory
) -> None:
    await make_user(email="anna@vmeste.demo")
    token = (await login(client, "anna@vmeste.demo")).cookies[COOKIE]
    await client.post("/api/auth/logout")

    response = await client.get("/api/auth/me", headers={"Cookie": f"{COOKIE}={token}"})

    assert response.status_code == 401


async def test_expired_session_is_rejected(
    client: httpx.AsyncClient, make_user: UserFactory, session: AsyncSession
) -> None:
    await make_user(email="anna@vmeste.demo")
    await login(client, "anna@vmeste.demo")
    await session.execute(update(AuthSession).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    await session.commit()

    response = await client.get("/api/auth/me")

    assert response.status_code == 401


async def test_deactivated_user_loses_access(
    client: httpx.AsyncClient, make_user: UserFactory, session: AsyncSession
) -> None:
    user = await make_user(email="anna@vmeste.demo")
    await login(client, "anna@vmeste.demo")
    await session.execute(update(User).where(User.id == user.id).values(is_active=False))
    await session.commit()

    assert (await client.get("/api/auth/me")).status_code == 401


async def test_session_token_is_stored_hashed(
    client: httpx.AsyncClient, make_user: UserFactory, session: AsyncSession
) -> None:
    await make_user(email="anna@vmeste.demo")
    token = (await login(client, "anna@vmeste.demo")).cookies[COOKIE]

    stored = await session.scalar(select(AuthSession.token_hash))

    assert stored is not None
    assert stored != token
    assert len(stored) == 64


async def test_demo_login_by_user_id(client: httpx.AsyncClient, make_user: UserFactory) -> None:
    await make_user(
        user_id="u-anna", password=None, demo=(1, "Участница, новичок", "Поиск и запись на занятия")
    )

    response = await client.post("/api/auth/demo-login", json={"userId": "u-anna"})

    assert response.status_code == 200
    assert response.json()["demo"] == {
        "title": "Участница, новичок",
        "hint": "Поиск и запись на занятия",
        "order": 1,
    }
    assert (await client.get("/api/auth/me")).json()["id"] == "u-anna"


async def test_demo_login_refuses_regular_account(client: httpx.AsyncClient, make_user: UserFactory) -> None:
    await make_user(user_id="u-real")

    response = await client.post("/api/auth/demo-login", json={"userId": "u-real"})

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_demo_login_can_be_disabled(database_url: str, make_user: UserFactory) -> None:
    await make_user(user_id="u-anna", demo=(1, "Участница", "Подсказка"))
    app = create_app(make_settings(database_url, demo_login_enabled=False))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
            response = await http.post("/api/auth/demo-login", json={"userId": "u-anna"})
            accounts = await http.get("/api/demo/accounts")
    finally:
        await app.state.db.dispose()

    assert response.status_code == 403
    assert response.json() == {
        "code": "forbidden",
        "statusCode": 403,
        "message": "Быстрый вход отключён. Войдите по почте и паролю",
    }
    assert accounts.json() == []


async def test_demo_accounts_are_listed_in_order(client: httpx.AsyncClient, make_user: UserFactory) -> None:
    await make_user(
        user_id="u-admin", name="Ирина Админова", role=UserRole.ADMIN, demo=(7, "Администратор", "Допуск")
    )
    await make_user(user_id="u-anna", name="Анна Петрова", demo=(1, "Участница", "Запись"))
    await make_user(user_id="u-plain", name="Обычный Пользователь")

    response = await client.get("/api/demo/accounts")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "u-anna",
            "name": "Анна Петрова",
            "initials": "АП",
            "age": None,
            "role": "user",
            "title": "Участница",
            "hint": "Запись",
            "orgs": [],
        },
        {
            "id": "u-admin",
            "name": "Ирина Админова",
            "initials": "ИА",
            "age": None,
            "role": "admin",
            "title": "Администратор",
            "hint": "Допуск",
            "orgs": [],
        },
    ]


async def test_admin_endpoint_requires_login(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/admin/ai/stats")

    assert response.status_code == 401


async def test_admin_endpoint_forbidden_for_regular_user(
    client: httpx.AsyncClient, make_user: UserFactory
) -> None:
    await make_user(email="anna@vmeste.demo")
    await login(client, "anna@vmeste.demo")

    response = await client.get("/api/admin/ai/stats")

    assert response.status_code == 403
    assert response.json() == {
        "code": "forbidden",
        "statusCode": 403,
        "message": "Это доступно только администратору",
    }


async def test_admin_sees_assistant_stats(
    app: FastAPI, client: httpx.AsyncClient, make_user: UserFactory
) -> None:
    await make_user(email="admin@vmeste.demo", role=UserRole.ADMIN)
    await app.state.ai.run(SEARCH_PARSE, "теннис утром")
    await app.state.ai.run(SEARCH_PARSE, "теннис утром")
    await login(client, "admin@vmeste.demo")

    response = await client.get("/api/admin/ai/stats", params={"days": 1})

    assert response.status_code == 200
    [row] = response.json()
    assert row["kind"] == "search_parse"
    assert row["total"] == 2
    assert row["succeeded"] == 2
    assert row["cached"] == 1
    assert row["fallbacks"] == 0
