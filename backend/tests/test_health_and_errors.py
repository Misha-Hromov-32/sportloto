import httpx

from app.main import create_app
from tests.conftest import make_settings


async def test_health_reports_database_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "version": "0.1.0", "assistant": "fake"}


async def test_health_returns_503_when_database_is_down() -> None:
    settings = make_settings(
        "postgresql+asyncpg://vmeste:vmeste@127.0.0.1:1/nowhere", database_connect_timeout=1.0
    )
    app = create_app(settings)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
            response = await http.get("/api/health")
    finally:
        await app.state.db.dispose()

    assert response.status_code == 503
    assert response.json() == {
        "code": "service_unavailable",
        "statusCode": 503,
        "message": "База данных недоступна",
    }


async def test_unknown_route_uses_unified_error(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/nothing-here/at/all")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert response.json()["message"] == "Действие GET /nothing-here/at/all не поддерживается"


async def test_wrong_method_uses_unified_error(client: httpx.AsyncClient) -> None:
    response = await client.delete("/api/health")

    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"


async def test_validation_error_lists_fields_in_russian(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/auth/login", json={"password": "secret"})

    assert response.status_code == 422
    assert response.json() == {
        "code": "validation",
        "statusCode": 422,
        "message": "Проверьте заполнение полей",
        "errors": {"email": "Обязательное поле"},
    }


async def test_broken_json_is_validation_error(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/auth/login", content=b"{oops", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation"
