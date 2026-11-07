"""Большой календарь: карта сайта не строит карточки и делится на части."""

from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest

from app.api.routes import seo


@pytest.mark.asyncio
async def test_large_calendar_sitemap_index_and_parts(monkeypatch):
    events = [{"id": f"e-{n}", "status": "published"} for n in range(57_600)]
    data = {"events": events, "orgs": [], "venues": []}

    async def cached(_key, _make):
        return data

    monkeypatch.setattr(seo, "_cached", cached)
    monkeypatch.setattr(seo, "site_url", lambda _: "https://sport.example")
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    index = await seo.sitemap(SimpleNamespace(query_params={}))
    root = ET.fromstring(index.body)
    assert [loc.text for loc in root.findall("s:sitemap/s:loc", ns)] == [
        "https://sport.example/sitemap.xml?part=1",
        "https://sport.example/sitemap.xml?part=2",
    ]
    all_urls = []
    for part in ("1", "2"):
        response = await seo.sitemap(SimpleNamespace(query_params={"part": part}))
        urls = ET.fromstring(response.body).findall("s:url/s:loc", ns)
        assert len(urls) <= 40_000
        all_urls.extend(loc.text for loc in urls)
    assert len(all_urls) == len(set(all_urls)) == 57_600 + len(seo.STATIC_PAGES)
    assert "https://sport.example/events/e-57599" in all_urls
    assert (await seo.sitemap(SimpleNamespace(query_params={"part": "3"}))).status_code == 404


def test_sitemap_collect_selects_only_public_addresses(monkeypatch):
    statements = []

    class Connection:
        def execute(self, statement):
            statements.append(statement)
            return [SimpleNamespace(id="public-id", updated_at=None)]

    monkeypatch.setattr(seo.store, "data", lambda: SimpleNamespace(connection=Connection()))
    result = seo._collect()
    assert set(result) == {"events", "orgs", "venues"}
    assert len(statements) == 3
    assert all({col.name for col in query.selected_columns} <= {"id", "updated_at"} for query in statements)
    assert "visibility" in str(statements[0])
    assert all("status" in str(query) for query in statements)
