"""Тесты работают с настоящим PostgreSQL из deploy/docker-compose.yml, в отдельной базе vmeste_test.

База создаётся автоматически, схема пересоздаётся миграциями Alembic в начале прогона,
после каждого теста таблицы очищаются.
"""

import asyncio
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.base import Base
from app.db.models import User, UserRole
from app.main import create_app
from app.services.users import create_user

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://vmeste:vmeste@localhost:5433/vmeste_test"
)


async def _ensure_database(url: str) -> None:
    parsed = make_url(url)
    try:
        connection = await asyncpg.connect(
            host=parsed.host,
            port=parsed.port,
            user=parsed.username,
            password=parsed.password,
            database="postgres",
            timeout=5,
        )
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.exit(
            f"Тестовая база недоступна ({parsed.host}:{parsed.port}): {exc}. "
            "Поднимите её: docker compose -f deploy/docker-compose.yml up -d db",
            returncode=2,
        )
    try:
        exists = await connection.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", parsed.database)
        if not exists:
            await connection.execute(f'CREATE DATABASE "{parsed.database}"')
    finally:
        await connection.close()


def _migrate(url: str) -> None:
    asyncio.run(_ensure_database(url))
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["database_url"] = url
    config.attributes["configure_logger"] = False
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(scope="session")
def database_url() -> str:
    # Alembic запускает свой цикл событий, поэтому — в отдельном потоке, вне цикла pytest-asyncio.
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(_migrate, TEST_DATABASE_URL).result()
    return TEST_DATABASE_URL


def make_settings(database_url: str, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "database_url": database_url,
        "ai_provider": "fake",
        "sse_heartbeat_seconds": 0.3,
        "sse_retry_ms": 1000,
        "domain_strict": True,
        "demo_seed_on_start": False,
        "domain_tick_seconds": 0,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture
def settings(database_url: str) -> Settings:
    return make_settings(database_url)


async def _truncate(app: FastAPI) -> None:
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    async with app.state.db.engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    try:
        yield application
    finally:
        application.state.broker.close_all()
        await _truncate(application)
        await application.state.ai.provider.aclose()
        await application.state.db.dispose()
        application.state.domain.store.dispose()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest.fixture
async def session(app: FastAPI) -> AsyncIterator[AsyncSession]:
    async with app.state.db.sessionmaker() as db_session:
        yield db_session


UserFactory = Callable[..., Awaitable[User]]


@pytest.fixture
def make_user(session: AsyncSession) -> UserFactory:
    counter = 0

    async def factory(
        *,
        email: str | None = None,
        name: str = "Анна Петрова",
        password: str | None = "secret-pass",
        role: UserRole = UserRole.USER,
        user_id: str | None = None,
        demo: tuple[int, str, str] | None = None,
    ) -> User:
        nonlocal counter
        counter += 1
        user = await create_user(
            session,
            email=email or f"user{counter}@vmeste.demo",
            name=name,
            password=password,
            role=role,
            user_id=user_id,
            demo=demo,
        )
        await session.commit()
        return user

    return factory


# Отметки согласий формы регистрации: без них сервер аккаунт не создаёт.
CONSENTS = {"acceptTerms": True, "personalDataConsent": True, "publicProfileConsent": True}
