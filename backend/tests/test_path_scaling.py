"""Public and private page readers keep results while rejecting full event loads."""
import copy
from collections import Counter
from types import SimpleNamespace

import pytest

from tests.test_calendar_scaling import calendar_domain
from app.domain import core, provider
from app.domain import clock
from app.domain.features import analytics, calendar, favorites, plan_b, references, series, share, venues
from app.domain.schema import COLLECTIONS


def prepare(database):
    collection = COLLECTIONS["events"]
    database.events = [database._row(collection, database._values(collection, event)) for event in database.events]


def scoped(database):
    events = database._data.pop("events")
    collection = COLLECTIONS["events"]
    queries = []
    class Result(list):
        def first(self):
            return self[0] if self else None
        def scalar_one(self):
            params = queries[-1].compile().params
            if "sport_id_1" in params:
                return sum(e["sportId"] == params["sport_id_1"] for e in events)
            return len(events)
        def all(self):
            return list(Counter(e["sportId"] for e in events).items())
    class Connection:
        def execute(self, query):
            queries.append(query)
            if "jsonb_path_query_array" in str(query):
                key = "districtId" if "districtId" in str(query.compile().params) else "ruleId"
                source = copy.deepcopy(events)
                if key == "districtId":
                    for event in source:
                        event["place"].pop("districtId", None)
                counts = Counter(obj[k] for event in source for obj, k in references._walk(event, key) if isinstance(obj.get(k), str))
                return SimpleNamespace(all=lambda: list(counts.items()))
            if "jsonb_typeof" in str(query):
                counts = Counter(e["place"]["districtId"] for e in events if isinstance(e["place"].get("districtId"), str))
                return SimpleNamespace(all=lambda: list(counts.items()))
            # Global dashboards may project a few fields; full rich records need WHERE.
            assert query.whereclause is not None or len(query.selected_columns) <= 7, str(query)
            return Result(SimpleNamespace(_mapping={**database._values(collection, copy.deepcopy(event)), "ord": i * 1024})
                          for i, event in enumerate(events))
    database._conn = Connection()
    return queries


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-olga", "u-maria"])
def test_venue_schedule_and_card_keep_results_without_full_calendar(calendar_domain, user_id):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user(user_id)
    venue = database.venues[0]
    expected = venues.venue_details(database, actor, venue["id"])
    queries = scoped(database)
    assert venues.venue_details(database, actor, venue["id"]) == expected
    assert "events" not in database._data
    assert any("venue_id" in str(query.whereclause) for query in queries)


@pytest.mark.parametrize("user_id", ["u-anna", "u-olga", "u-andrey"])
def test_favorites_and_offline_cards_keep_privacy_and_results(calendar_domain, user_id):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user(user_id)
    expected = favorites.favorites_view(domain, actor)
    offline = share.offline_cards(domain, actor)
    scoped(database)
    assert favorites.favorites_view(domain, actor) == expected
    assert share.offline_cards(domain, actor) == offline
    assert "events" not in database._data


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-maria"])
def test_alternatives_use_same_ranking_with_scoped_sport_and_date(calendar_domain, user_id):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user(user_id)
    expected = plan_b.plan_b_view(domain.participation_host, actor, "e-run-tatyshev")
    queries = scoped(database)
    assert plan_b.plan_b_view(domain.participation_host, actor, "e-run-tatyshev") == expected
    assert "events" not in database._data
    assert any("sport_id" in str(query.whereclause) and "starts_at" in str(query.whereclause) for query in queries)


def test_series_reads_only_its_series_and_preserves_order(calendar_domain):
    domain, database = calendar_domain
    prepare(database)
    event = next(e for e in database.events if e.get("series"))
    expected = series.series_events(domain.participation_host, event)
    queries = scoped(database)
    assert series.series_events(domain.participation_host, event) == expected
    assert "events" not in database._data
    assert any("series" in str(query.whereclause) for query in queries)


@pytest.mark.parametrize("user_id", ["u-anna", "u-olga"])
def test_personal_conflicts_and_organizing_keep_results(calendar_domain, user_id):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user(user_id)
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    expected = calendar.find_conflicts(domain.participation_host, actor, event)
    organizing = domain.list_events(actor, {"scope": "organizing"})
    scoped(database)
    assert calendar.find_conflicts(domain.participation_host, actor, event) == expected
    assert domain.list_events(actor, {"scope": "organizing"}) == organizing
    assert "events" not in database._data


def test_admin_dashboards_and_sport_counts_use_small_projections(calendar_domain):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user("u-maria")
    expected = domain.admin_stats(actor)
    cities = references.admin_cities(actor)
    sport = domain.sport_details("s-running")
    counts = domain.admin_event_counts(actor)
    scoped(database)
    assert domain.admin_stats(actor) == expected
    assert references.admin_cities(actor) == cities
    assert domain.sport_details("s-running") == sport
    assert domain.admin_event_counts(actor) == counts
    assert "events" not in database._data


def test_admin_district_and_rule_counters_keep_all_nested_references(calendar_domain):
    domain, database = calendar_domain
    prepare(database)
    actor = domain.user("u-maria")
    expected_districts = references.admin_districts(actor, {})
    expected_rules = references.admin_rules(actor)
    queries = scoped(database)
    assert references.admin_districts(actor, {}) == expected_districts
    assert references.admin_rules(actor) == expected_rules
    assert "events" not in database._data
    assert sum("jsonb_path_query_array" in str(query) for query in queries) == 2


def test_daily_demo_date_refresh_does_not_load_or_shift_added_calendar(calendar_domain):
    domain, database = calendar_domain
    prepare(database)
    seed_id = "e-run-tatyshev"
    original = database.record("events", seed_id)["startsAt"]
    unrelated = database.record("events", "e-chess-kids")["startsAt"]
    database._state["seededAt"] = "2026-10-18T03:00:00.000Z"
    database.settings["seedIds"] = {"events": [seed_id]}
    queries = scoped(database)
    assert provider.refresh_dates()
    assert "events" not in database._data
    assert domain._event(seed_id)["startsAt"] == provider._shift_iso(original, 1)
    assert domain._event("e-chess-kids")["startsAt"] == unrelated
    assert set(queries[0].compile().params["id_1"]) == {seed_id}


@pytest.mark.parametrize("user_id", ["u-anna", "u-dmitry", "u-maria"])
def test_personalized_page_matches_full_results_but_only_hydrates_page(calendar_domain, monkeypatch, user_id):
    domain, database = calendar_domain
    actor = domain.user(user_id)
    filters = [{"field": "forYou", "operator": "eq", "value": True}]
    expected = domain.list_events(actor, {"forYou": True})
    calls = []
    view = domain.event_view
    def counted(actor, event, opts=None):
        calls.append(event["id"])
        return view(actor, event, opts)
    monkeypatch.setattr(domain, "event_view", counted)
    with provider.acting_as(user_id):
        actual = provider.get_list("events", filters, pagination={"mode": "server", "pageSize": 3})
    assert actual == {"data": expected[:3], "total": len(expected)}
    assert len(calls) <= 3
