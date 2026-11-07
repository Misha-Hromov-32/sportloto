import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from app.domain import core
from app.domain.features import favorites
from tests.helpers import login
from tests.test_assistant_chat import seeded  # noqa: F401


@pytest.mark.usefixtures("seeded")
async def test_saved_search_count_matches_city_feed(client: httpx.AsyncClient) -> None:
    headers = await login(client, "u-anna")
    criteria = {"sportIds": ["s-volleyball"], "place@city": "bryansk"}
    filters = [{"field": key, "operator": "eq", "value": value} for key, value in criteria.items()]
    feed = await client.get("/api/events", headers=headers, params={"filters": json.dumps(filters)})
    assert feed.status_code == 200
    saved = await client.post("/api/saved-searches", headers=headers, json={"name": "Волейбол в Брянске", "criteria": criteria, "query": "sport=s-volleyball&city=bryansk"})
    assert saved.status_code == 200
    assert saved.json()["matches"] == feed.json()["total"]


async def test_notification_match_keeps_city_with_explicit_candidate_ids(seeded: FastAPI) -> None:  # noqa: F811
    def matches() -> list:
        return favorites._matching(core.domain, core.domain.user("u-anna"), {"place@city": "bryansk"}, ["e-volley-hall"])
    assert await asyncio.to_thread(seeded.state.domain.store.read, matches) == []
