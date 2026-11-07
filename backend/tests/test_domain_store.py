"""Слой хранения доменных правил: коллекции из таблиц, запись только изменений, порядок записей."""

from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa

from app.domain import store
from app.domain.schema import COLLECTIONS
from app.domain.store import DomainStore, LiveChange, SchemaMismatchError

NOW = "2026-10-19T03:00:00.000Z"


@pytest.fixture
def domain_store(database_url: str) -> Iterator[DomainStore]:
    published: list[list[LiveChange]] = []
    engine = sa.create_engine(database_url.replace("+asyncpg", "+psycopg"))
    instance = DomainStore(engine, publish=published.append, strict=True)
    instance.published = published  # type: ignore[attr-defined]
    try:
        yield instance
    finally:
        tables = ", ".join(t.name for t in reversed(sa.MetaData().sorted_tables))  # noqa: F841
        with engine.begin() as conn:
            names = ", ".join(c.table.name for c in COLLECTIONS.values())
            conn.execute(sa.text(f"TRUNCATE {names}, demo_state RESTART IDENTITY CASCADE"))
        engine.dispose()


def user(id_: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": id_,
        "name": "Анна Соколова",
        "avatarUrl": None,
        "age": 30,
        "role": "user",
        "city": "Красноярск",
        "districtId": None,
        "about": "",
        "interests": ["s-chess"],
        "levels": {"s-chess": "amateur"},
        "readiness": "join",
        "home": {"lat": 56.01, "lng": 92.85},
        "radiusKm": 5,
        "email": f"{id_}@vmeste.demo",
        "phone": "",
        "demo": None,
        "createdAt": NOW,
        "gender": None,
        **extra,
    }


def notification(id_: str, user_id: str = "u-anna") -> dict[str, Any]:
    return {
        "id": id_,
        "userId": user_id,
        "type": "joined",
        "title": "Новый участник",
        "text": "Анна записалась",
        "link": "/events/e-1",
        "read": False,
        "createdAt": NOW,
    }


def ords(domain_store: DomainStore, table: str) -> dict[str, int]:
    with domain_store.engine.connect() as conn:
        return dict(conn.execute(sa.text(f"SELECT id, ord FROM {table}")).all())  # noqa: S608


def test_scoped_edits_commit_and_promote_without_losing_other_rows(domain_store: DomainStore) -> None:
    domain_store.write(lambda: store.data().users.extend([user("u-anna"), user("u-maria")]))
    before = ords(domain_store, "users")

    def edit_on_read() -> None:
        db = store.data()
        anna = db.record("users", "u-anna")
        anna["home"]["lat"] = 56.55
        assert "users" not in db._data

    domain_store.read(edit_on_read)
    rows = domain_store.read(lambda: {row["id"]: row for row in store.data().users})
    assert rows["u-anna"]["home"]["lat"] == 56.55
    assert rows["u-maria"]["home"]["lat"] == 56.01
    assert ords(domain_store, "users") == before

    def promote() -> None:
        db = store.data()
        anna = db.record("users", "u-anna")
        anna["about"] = "Изменено до загрузки коллекции"
        assert next(row for row in db.users if row["id"] == "u-anna") is anna

    domain_store.write(promote)
    assert domain_store.read(lambda: store.data().record("users", "u-anna")["about"]) == (
        "Изменено до загрузки коллекции"
    )
    assert ords(domain_store, "users") == before


def test_records_round_trip_with_dates_json_and_composites(domain_store: DomainStore) -> None:
    def write() -> None:
        db = store.data()
        db.users.append(user("u-anna", demo={"title": "Участница", "hint": "Запись", "order": 1}))
        db.sports.append(
            {
                "id": "s-chess",
                "name": "Шахматы",
                "synonyms": ["шахматы"],
                "categoryIds": [],
                "icon": None,
                "kind": "catalog",
                "popular": True,
                "fields": [],
                "mergedInto": None,
                "createdBy": None,
                "createdAt": NOW,
            }
        )
        db.events.append(
            {
                "id": "e-1",
                "title": "Шахматы в парке",
                "sportId": "s-chess",
                "organizer": {"kind": "user", "id": "u-anna"},
                "startsAt": "2026-10-22T12:30:00.000Z",
                "place": {"address": "Парк", "landmark": "", "districtId": None, "lat": 56.0, "lng": 92.9},
                "changes": [{"id": "c-1", "at": NOW, "items": [], "acknowledgedBy": []}],
                "status": "published",
                "capacity": 10,
            }
        )

    domain_store.write(write)
    event, anna = domain_store.read(lambda: (store.data().events[0], store.data().users[0]))

    assert event["startsAt"] == "2026-10-22T12:30:00.000Z"
    assert event["organizer"] == {"kind": "user", "id": "u-anna"}
    assert event["place"]["lat"] == 56.0
    assert event["changes"][0]["id"] == "c-1"
    assert event["capacity"] == 10
    assert event["venueId"] is None
    assert anna["demo"] == {"title": "Участница", "hint": "Запись", "order": 1}
    assert anna["home"] == {"lat": 56.01, "lng": 92.85}


def test_new_record_at_head_keeps_order_of_existing_rows(domain_store: DomainStore) -> None:
    def seed() -> None:
        db = store.data()
        db.users.append(user("u-anna"))
        db.notifications.extend([notification("n-1"), notification("n-2")])

    domain_store.write(seed)
    before = ords(domain_store, "notifications")

    domain_store.write(lambda: store.data().notifications.insert(0, notification("n-3")))

    after = ords(domain_store, "notifications")
    assert {k: after[k] for k in before} == before
    assert after["n-3"] < before["n-1"]
    assert [n["id"] for n in domain_store.read(lambda: store.data().notifications)] == ["n-3", "n-1", "n-2"]


def test_reordered_and_removed_records_are_saved(domain_store: DomainStore) -> None:
    def seed() -> None:
        db = store.data()
        db.users.append(user("u-anna"))
        db.notifications.extend([notification("n-1"), notification("n-2"), notification("n-3")])

    domain_store.write(seed)

    def change() -> None:
        db = store.data()
        db.notifications = [n for n in reversed(db.notifications) if n["id"] != "n-2"]
        db.notifications[0]["read"] = True

    domain_store.write(change)

    rows = domain_store.read(lambda: store.data().notifications)
    assert [(n["id"], n["read"]) for n in rows] == [("n-3", True), ("n-1", False)]


def test_collections_without_ids_and_string_lists(domain_store: DomainStore) -> None:
    def write() -> None:
        db = store.data()
        db.reminders.extend(["u-anna|e-1|day|x", "u-anna|e-1|2h|x"])
        db.engagement.held_asked.append("u-anna|e-1")

    domain_store.write(write)
    domain_store.write(lambda: store.data().reminders.pop(0))

    reminders, asked = domain_store.read(lambda: (store.data().reminders, store.data().engagement.held_asked))
    assert reminders == ["u-anna|e-1|2h|x"]
    assert asked == ["u-anna|e-1"]


def test_assistant_log_is_append_only(domain_store: DomainStore) -> None:
    entry = {
        "id": "ai-1",
        "kind": "search",
        "userId": None,
        "durationMs": 12,
        "ok": True,
        "fallback": False,
        "at": NOW,
    }
    domain_store.write(lambda: store.data().ai_requests.insert(0, entry))

    assert domain_store.read(lambda: store.data().ai_requests) == []
    with domain_store.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT kind, provider, success FROM ai_requests")).all() == [
            ("search", "rules", True)
        ]


def test_unknown_field_fails_in_strict_mode_and_rolls_back(domain_store: DomainStore) -> None:
    def write() -> None:
        db = store.data()
        db.users.append(user("u-anna"))
        db.notifications.append({**notification("n-1"), "surprise": 1})

    with pytest.raises(SchemaMismatchError):
        domain_store.write(write)
    assert domain_store.read(lambda: store.data().users) == []


def test_counter_and_live_changes_are_committed_together(domain_store: DomainStore) -> None:
    def seed() -> None:
        db = store.data()
        db.version, db.seeded_at, db.seq, db.settings = 7, NOW, 1000, {"assistantFailure": False}

    domain_store.write(seed)

    def create() -> str:
        db = store.data()
        db.publish(["events"], ["e-1"], "created")
        return db.next_id("e")

    assert domain_store.write(create) == "e-rt"  # 1001 в 36-ричной записи
    assert domain_store.read(lambda: store.data().seq) == 1001
    assert domain_store.published == [[LiveChange(["events"], ["e-1"], "created")]]  # type: ignore[attr-defined]


def test_failed_change_publishes_nothing(domain_store: DomainStore) -> None:
    def fail() -> None:
        store.data().publish(["events"], [])
        raise RuntimeError

    with pytest.raises(RuntimeError):
        domain_store.write(fail)
    assert domain_store.published == []  # type: ignore[attr-defined]


def test_read_that_changes_data_is_saved_without_running_rule_twice(domain_store: DomainStore) -> None:
    calls: list[int] = []

    def mark() -> int:
        calls.append(1)
        store.data().reminders.append("once")
        return len(calls)

    assert domain_store.read(mark) == 1
    assert domain_store.read(lambda: store.data().reminders) == ["once"]


def test_read_is_repeated_when_data_changed_meanwhile(domain_store: DomainStore) -> None:
    calls: list[int] = []

    def mark() -> int:
        calls.append(1)
        if len(calls) == 1:
            # Пока шло чтение, другой запрос успел записать изменения.
            domain_store.write(lambda: store.data().engagement.held_asked.append("other"))
        store.data().reminders.append("once")
        return len(calls)

    assert domain_store.read(mark) == 2
    assert domain_store.read(lambda: (store.data().reminders, store.data().engagement.held_asked)) == (
        ["once"],
        ["other"],
    )
