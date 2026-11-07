"""Миграции Alembic совпадают с описанием таблиц в коде: app/db/models и app/domain/schema.py."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.db import models  # noqa: F401  регистрирует таблицы входа
from app.db.base import Base
from app.domain import schema  # noqa: F401  регистрирует доменные таблицы


def test_migrations_match_schema(database_url: str) -> None:
    engine = create_engine(make_url(database_url).set(drivername="postgresql+psycopg"))
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            diff = compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()

    assert diff == []
