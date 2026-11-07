"""Daily digests bound the calendar before hydrating event cards."""

import copy
from types import SimpleNamespace

import pytest

from app.domain import clock, seed, store
from app.domain.core import Domain
from app.domain.features import digest
from app.domain.schema import COLLECTIONS


@pytest.fixture
def digest_domain(monkeypatch):
    now = clock.parse("2026-10-19T03:00:00.000Z")
    monkeypatch.setattr(clock, "_frozen", now)
    source = seed.build_seed(now)
    database = store.Database(None, strict=True)
    for path in COLLECTIONS:
        rows = source
        for part in path.split("."):
            rows = rows.get(part, []) if isinstance(rows, dict) else []
        database._data[path] = rows
    database._state = {"settings": source["settings"]}
    monkeypatch.setattr(store, "data", lambda: database)
    return Domain(), database


def scoped_calendar(database):
    """Exercise actual records decoding and reject every unbounded event SELECT."""
    events = database._data.pop("events")
    collection = COLLECTIONS["events"]
    calls = []

    class Connection:
        def execute(self, query):
            params = query.compile().params
            calls.append(params)
            if {"starts_at_1", "starts_at_2"} <= params.keys():
                rows = [
                    event for event in events
                    if params["starts_at_1"] < clock.parse(event["startsAt"]) <= params["starts_at_2"]
                ]
            elif "id_1" in params:
                rows = [event for event in events if event["id"] == params["id_1"]]
            elif {"organizer_kind_1", "organizer_id_1"} <= params.keys():
                rows = [event for event in events if event["organizer"] == {
                    "kind": params["organizer_kind_1"], "id": params["organizer_id_1"],
                }]
            else:
                pytest.fail("Digest must not load the entire event collection")
            return [SimpleNamespace(_mapping={
                **database._values(collection, copy.deepcopy(event)), "ord": index * 1024,
            }) for index, event in enumerate(rows)]

    database._conn = Connection()
    return events, calls


@pytest.mark.parametrize("user_id", ["u-anna", "u-maria", "u-dmitry"])
def test_digest_scoped_read_preserves_picks_and_only_hydrates_eligible_city_week(
    digest_domain, monkeypatch, user_id,
):
    domain, database = digest_domain
    user = domain.user(user_id)
    template = copy.deepcopy(database.events[0])
    for index in range(2048):
        database.events.append({**copy.deepcopy(template), "id": f"far-future-{index}",
                                "startsAt": "2040-01-01T12:00:00.000Z"})
    # SQL roundtrip includes nullable fields, just like production PostgreSQL rows.
    collection = COLLECTIONS["events"]
    database.events = [database._row(collection, database._values(collection, row)) for row in database.events]
    expected = digest.pick_events(domain, user)
    _events, calls = scoped_calendar(database)
    hydrated = []
    event_view = domain.event_view

    def counted(actor, event, opts=None):
        hydrated.append(event)
        return event_view(actor, event, opts)

    monkeypatch.setattr(domain, "event_view", counted)
    assert digest.pick_events(domain, user) == expected
    assert "events" not in database._data
    assert calls[0] == {"starts_at_1": clock.now(), "starts_at_2": clock.now() + digest.WINDOW}
    assert all(clock.now() < clock.parse(row["startsAt"]) <= clock.now() + digest.WINDOW for row in hydrated)
    assert all(digest.city_of_place(row["place"])["id"] == digest.user_city(user)["id"] for row in hydrated)
    assert len(hydrated) < 100


def test_empty_digest_does_not_hydrate_events(digest_domain, monkeypatch):
    domain, database = digest_domain
    user = domain.user("u-anna")
    for event in database.events:
        event["startsAt"] = "2040-01-01T12:00:00.000Z"
    scoped_calendar(database)

    def unexpected(*_args, **_kwargs):
        pytest.fail("No candidates means no list/ranking/card calculation")

    monkeypatch.setattr(domain, "list_events", unexpected)
    assert digest.pick_events(domain, user) == []
    assert "events" not in database._data


def test_digest_title_lookup_reads_one_record(digest_domain):
    _domain, database = digest_domain
    expected = copy.deepcopy(database.events[0])
    scoped_calendar(database)
    actual = digest._event(expected["id"])
    assert actual["id"] == expected["id"]
    assert digest._titles([{"eventId": expected["id"]}]) == f"«{expected['title']}»"
    assert "events" not in database._data
