"""Bounded SQL selection and authoritative hydration; live parity uses the read-only probe."""

import copy
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from app.domain import clock, core, event_query, provider, seed, store
from app.domain.schema import COLLECTIONS
from app.core.errors import AppError


@pytest.fixture
def sql_feed(monkeypatch):
    monkeypatch.setattr(clock, "_frozen", clock.parse("2026-10-19T03:00:00Z"))
    source = seed.build_seed(clock.now())
    db = store.Database(None, strict=True)
    for path in COLLECTIONS:
        rows = source
        for part in path.split("."):
            rows = rows.get(part, []) if isinstance(rows, dict) else []
        db._data[path] = rows
    db._state = {"settings": source["settings"]}
    collection = COLLECTIONS["events"]
    db.events = [db._row(collection, db._values(collection, row)) for row in db.events]
    monkeypatch.setattr(store, "data", lambda: db)
    monkeypatch.setattr(core, "domain", core.Domain())
    monkeypatch.setattr(provider, "registry", provider._core_resources)
    return db


def test_city_feed_uses_count_and_bounded_select_then_hydrates_page(sql_feed, monkeypatch):
    db = sql_feed
    conditions = [{"field": "place@city", "operator": "eq", "value": "krasnoyarsk"}]
    pagination = {"mode": "server", "currentPage": 2, "pageSize": 3}
    expected = provider.get_list("events", conditions, pagination=pagination)
    events = db._data.pop("events")
    by_id = {event["id"]: event for event in events}
    page = [by_id[event["id"]] for event in expected["data"]]
    assert page
    queries = []

    class Result(list):
        def scalar_one(self):
            return expected["total"]

    class Connection:
        def execute(self, query):
            sql = str(query.compile(dialect=postgresql.dialect()))
            queries.append(query)
            assert " WHERE " in sql.replace("\n", " ")
            assert "status" in sql and "visibility IS DISTINCT FROM" in sql
            assert "asin" in sql and "duration_min * INTERVAL '1 minute'" in sql
            if "count(*)" in sql:
                return Result()
            assert "LIMIT" in sql and "OFFSET" in sql
            assert query._limit_clause.value == 3
            assert query._offset_clause.value == 3
            return Result(SimpleNamespace(_mapping=db._values(COLLECTIONS["events"], row)) for row in page)

    db._conn = Connection()
    # Organizer history is tested separately; this test isolates the two page queries.
    monkeypatch.setattr(core.domain, "_organizer_events_for_read", lambda ref: [
        row for row in events if row["organizer"] == ref
    ])
    assert provider.get_list("events", conditions, pagination=pagination) == expected
    assert len(queries) == 2
    assert "events" not in db._data


@pytest.mark.parametrize("zone,start,end", [
    ("Europe/Moscow", "2027-01-31T21:00:00Z", "2027-02-28T21:00:00Z"),
    ("Asia/Krasnoyarsk", "2027-01-31T17:00:00Z", "2027-02-28T17:00:00Z"),
])
def test_month_sql_uses_half_open_bounds_in_request_city(sql_feed, monkeypatch, zone, start, end):
    db = sql_feed
    db._data.pop("events")
    statements = []

    class Result(list):
        def scalar_one(self):
            return 0

    class Connection:
        def execute(self, query):
            statements.append(query)
            return Result()

    db._conn = Connection()
    monkeypatch.setattr(core.domain, "event_views", lambda _u, rows, _opts: rows)
    with clock.zone(zone):
        result = event_query.feed_page(
            [{"field": "month", "operator": "eq", "value": "2027-02"}], [],
            {"mode": "server", "pageSize": 20}, {"month": "2027-02"}, None,
        )
    assert result == {"data": [], "total": 0}
    for query in statements:
        params = query.compile().params
        assert params["starts_at_1"] == clock.parse(start)
        assert params["starts_at_2"] == clock.parse(end)
        sql = str(query)
        assert "starts_at >=" in sql and "starts_at <" in sql
    assert "events" not in db._data


@pytest.mark.parametrize("params,filters,sorters,pagination", [
    ({"scope": "admin"}, [], [], {"pageSize": 20}),
    ({"forYou": True}, [], [], {"pageSize": 20}),
    ({"q": "running"}, [], [], {"pageSize": 20}),
    ({}, [{"field": "counts.confirmed", "operator": "gte", "value": 1}], [], {"pageSize": 20}),
    ({}, [], [{"field": "organizerView.facts.held", "order": "desc"}], {"pageSize": 20}),
])
def test_sql_declines_conditions_requiring_authoritative_domain_filtering(
    sql_feed, params, filters, sorters, pagination,
):
    sql_feed._data.pop("events")
    assert event_query.feed_page(filters, sorters, pagination, params, None) is None


def test_sql_never_bypasses_loaded_event_mutations(sql_feed):
    original = copy.deepcopy(sql_feed.events[0])
    sql_feed.events[0]["title"] = "Changed in this transaction"
    assert event_query.feed_page([], [], {"pageSize": 20}, {}, None) is None
    assert sql_feed.events[0]["title"] != original["title"]


def test_admin_event_page_counts_all_statuses_but_only_reads_requested_rows(sql_feed, monkeypatch):
    db = sql_feed
    db._data.pop("events")
    queries = []
    class Result(list):
        def scalar_one(self):
            return 57822
    class Connection:
        def execute(self, query):
            queries.append(query)
            if "count(*)" not in str(query):
                assert query._limit_clause.value == 6
                assert "starts_at DESC" in str(query)
            assert "visibility" not in str(query.whereclause)
            return Result()
    db._conn = Connection()
    monkeypatch.setattr(core.domain, "event_views", lambda *_args: [])
    monkeypatch.setattr(core.domain, "_match_for", lambda _actor: None)
    monkeypatch.setattr(core.domain, "_actor_point", lambda _actor: None)
    actual = event_query.feed_page([], [], {"mode": "server", "pageSize": 6}, {"scope": "admin"}, {"id": "admin", "role": "admin"})
    assert actual == {"data": [], "total": 57822}
    assert len(queries) == 2


@pytest.mark.parametrize("mode", ["off", "client"])
def test_large_legacy_landing_request_fails_before_hydration(sql_feed, monkeypatch, mode):
    db = sql_feed
    db._data.pop("events")
    queries = []

    class Result:
        def scalar_one(self):
            return 19200

    class Connection:
        def execute(self, query):
            queries.append(query)
            assert "count(*)" in str(query), "Must not select the complete catalogue"
            return Result()

    db._conn = Connection()
    monkeypatch.setattr(core.domain, "event_views", lambda *_args: pytest.fail("No hydration on oversized requests"))
    with pytest.raises(AppError, match="Каталог слишком большой"):
        event_query.feed_page(
            [{"field": "aiFlag", "operator": "eq", "value": "none"},
             {"field": "place@city", "operator": "eq", "value": "bryansk"}],
            [{"field": "startsAt", "order": "asc"}], {"mode": mode},
            {"aiFlag": "none", "place@city": "bryansk"}, None,
        )
    assert len(queries) == 1
    assert "events" not in db._data


@pytest.mark.parametrize("actor,real_flag", [(None, False), ({"id": "u", "role": "user"}, False),
                                           ({"id": "a", "role": "admin"}, True)])
def test_landing_query_limits_upcoming_and_preserves_moderation_visibility(sql_feed, monkeypatch, actor, real_flag):
    db = sql_feed
    db._data.pop("events")
    queries = []

    class Result(list):
        def scalar_one(self):
            return 19200

    class Connection:
        def execute(self, query):
            queries.append(query)
            sql = str(query.compile(dialect=postgresql.dialect()))
            assert "starts_at >" in sql
            # The public view masks every moderation flag as 'none'.
            where = sql.split("WHERE", 1)[1]
            assert ("ai_flag =" in where) == real_flag
            if "count(*)" not in sql:
                assert query._limit_clause.value == 48
            return Result()

    db._conn = Connection()
    monkeypatch.setattr(core.domain, "event_views", lambda *_args: [])
    monkeypatch.setattr(core.domain, "_match_for", lambda _actor: None)
    monkeypatch.setattr(core.domain, "_actor_point", lambda _actor: None)
    filters = [{"field": "aiFlag", "operator": "eq", "value": "none"},
               {"field": "state", "operator": "eq", "value": "upcoming"}]
    assert event_query.feed_page(filters, [], {"mode": "server", "pageSize": 48},
                                 {"aiFlag": "none", "state": "upcoming"}, actor) == {"data": [], "total": 19200}
    assert len(queries) == 2
    assert "events" not in db._data


def test_urgent_sql_filters_badges_before_total_and_page(sql_feed, monkeypatch):
    db = sql_feed
    template = copy.deepcopy(db.events[0])
    rows = []
    for id_, start in [
        ("urgent-expired", "2026-10-19T03:30:00.000Z"),
        ("urgent-full", "2026-10-20T10:00:00.000Z"),
        ("urgent-active", "2026-10-20T11:00:00.000Z"),
        ("urgent-closed", "2026-10-20T12:00:00.000Z"),
    ]:
        row = copy.deepcopy(template)
        row.update(id=id_, startsAt=start, status="published", visibility="public", capacity=None)
        if id_ == "urgent-full":
            row["capacity"] = 0
        rows.append(row)
    db.events = rows
    db.urgent_calls = [
        {"eventId": row["id"], "need": 2, "baseline": 0,
         "closedAt": clock.iso(clock.now()) if row["id"] == "urgent-closed" else None}
        for row in rows
    ]
    conditions = [{"field": "urgent", "operator": "nnull", "value": True}]
    expected = provider.get_list("events", conditions, pagination={"pageSize": 1})
    assert [row["id"] for row in expected["data"]] == ["urgent-active"]
    assert expected["total"] == 1
    db._data.pop("events")
    queries = []

    class Connection:
        def execute(self, query):
            queries.append(query)
            assert query._limit_clause is None, "Badge filtering must precede pagination"
            candidates = query.compile().params["id_1"]
            assert set(candidates) == {"urgent-expired", "urgent-full", "urgent-active"}
            return [SimpleNamespace(_mapping=db._values(COLLECTIONS["events"], row))
                    for row in rows if row["id"] in candidates]

    db._conn = Connection()
    monkeypatch.setattr(core.domain, "_organizer_events_for_read", lambda ref: [
        row for row in rows if row["organizer"] == ref
    ])
    assert provider.get_list("events", conditions, pagination={"pageSize": 1}) == expected
    assert len(queries) == 1
    assert "events" not in db._data


def test_urgent_without_open_calls_returns_empty_without_event_select(sql_feed):
    sql_feed._data.pop("events")
    sql_feed.urgent_calls = []
    assert event_query.feed_page(
        [{"field": "urgent", "operator": "nnull"}], [], {"pageSize": 6}, {}, None,
    ) == {"data": [], "total": 0}
