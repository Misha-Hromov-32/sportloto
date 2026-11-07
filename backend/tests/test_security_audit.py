import httpx
import pytest

from app.db.models import UserRole
from app.main import create_app
from tests.conftest import CONSENTS, UserFactory, make_settings
from tests.helpers import login, seeded  # noqa: F401


async def test_production_http_rejects_demo_admin_even_with_demo_flags_enabled(
    database_url: str, make_user: UserFactory
) -> None:
    await make_user(
        user_id="u-audit-admin",
        email="audit-admin@example.test",
        role=UserRole.ADMIN,
        password="isolated-test-password",
        demo=(1, "Administrator", "Test only"),
    )
    app = create_app(
        make_settings(database_url, app_env="prod", demo_login_enabled=True, demo_reset_enabled=True)
    )
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as http:
            assert (await http.get("/api/demo/accounts")).json() == []
            assert (
                await http.post("/api/auth/demo-login", json={"userId": "u-audit-admin"})
            ).status_code == 403
            assert (
                await http.post("/api/auth/login", json={"email": "audit-admin@example.test", "password": ""})
            ).status_code == 401
            assert (await http.post("/api/demo/reset", json={})).status_code == 404
            assert (await http.get("/api/admin/ai/stats")).status_code == 401
            assert (
                await http.get("/api/admin/ai/stats", headers={"Authorization": "Bearer u-audit-admin"})
            ).status_code == 401
    finally:
        await app.state.db.dispose()
        app.state.domain.store.dispose()


@pytest.mark.parametrize(
    "city,expected", [("bryansk", "Брянск"), ("moscow", "Москва"), ("krasnoyarsk", "Красноярск")]
)
async def test_registration_keeps_selected_city_and_ignores_privileged_fields(
    client: httpx.AsyncClient, city: str, expected: str
) -> None:
    response = await client.post(
        "/api/auth/register",
        headers={"X-City": city},
        json={
            "name": "Тестовый участник",
            "email": "audit-city@mail.ru",
            "password": "isolated-test-password",
            "role": "admin",
            "isActive": True,
            "demo": {"order": 1},
            **CONSENTS,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["identity"]["city"] == expected
    assert response.json()["role"] == "user"
    assert response.json()["demo"] is None
    assert (await client.get("/api/admin/ai/stats")).status_code == 403


async def test_regular_user_cannot_take_over_another_account_or_delete_its_event(
    client: httpx.AsyncClient, seeded
) -> None:
    anna = await login(client, "u-anna")
    own_profile = await client.put("/api/users/u-anna", json={"role": "admin"}, headers=anna)
    assert own_profile.status_code == 200
    assert own_profile.json()["userRole"] == "user"
    assert (await client.get("/api/admin/ai/stats", headers=anna)).status_code == 403
    assert (await client.put("/api/users/u-maria", json={"role": "user"}, headers=anna)).status_code == 403
    events = (await client.get("/api/events")).json()["data"]
    foreign = next(e for e in events if e["organizer"] != {"kind": "user", "id": "u-anna"})
    assert (await client.delete("/api/events/" + foreign["id"], headers=anna)).status_code == 403
    assert (await client.get("/api/events/" + foreign["id"])).status_code == 200


async def test_production_account_without_password_cannot_use_regular_login(
    database_url: str, make_user: UserFactory
) -> None:
    await make_user(email="seeded@example.test", password=None)
    app = create_app(make_settings(database_url, app_env="prod", demo_login_enabled=True))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as http:
            for password in ["", "secret-pass"]:
                assert (
                    await http.post(
                        "/api/auth/login", json={"email": "seeded@example.test", "password": password}
                    )
                ).status_code == 401
    finally:
        await app.state.db.dispose()
        app.state.domain.store.dispose()
