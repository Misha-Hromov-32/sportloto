"""Общее для тестов на демо-данных: момент «сейчас», вход под демо-аккаунтом, фильтры Refine."""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.domain import clock, provider, seed

NOW = clock.parse("2026-10-19T03:00:00.000Z")  # понедельник, 10:00 по Красноярску
DAY = timedelta(days=1)


@pytest.fixture
async def seeded(app: FastAPI) -> AsyncIterator[FastAPI]:
    clock.set_frozen(NOW)
    await asyncio.to_thread(app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW)))
    try:
        yield app
    finally:
        clock.set_frozen(None)


async def login(client: httpx.AsyncClient, user_id: str) -> dict[str, str]:
    response = await client.post("/api/auth/demo-login", json={"userId": user_id})
    assert response.status_code == 200, response.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {response.json()['token']}"}


def filters(*items: tuple[str, str, Any]) -> dict[str, str]:
    return {
        "filters": json.dumps([{"field": f, "operator": op, "value": v} for f, op, v in items]),
        "pagination": json.dumps({"mode": "off"}),
    }
