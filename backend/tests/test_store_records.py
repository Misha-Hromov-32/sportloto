"""Scoped records retain transactional tracking without a full collection snapshot."""

import copy
from types import SimpleNamespace

import pytest

from app.domain import clock, seed, store
from app.domain.schema import COLLECTIONS


@pytest.fixture
def scoped_db():
    collection = COLLECTIONS["events"]
    db = store.Database(None, strict=True)
    events = copy.deepcopy(seed.build_seed(clock.parse("2026-10-19T03:00:00Z"))["events"][:3])
    for index, row in enumerate(events):
        row.update(id=f"tracked-{index}", status="published", title=f"Original {index}")
    mappings = [dict(db._values(collection, row), ord=(index + 1) * 1024)
                for index, row in enumerate(events)]

    class Connection:
        def __init__(self):
            self.selects = []
            self.writes = []

        def execute(self, query, *args):
            params = query.compile().params
            if not query.is_select:
                self.writes.append(query)
                return []
            self.selects.append(query)
            rows = mappings
            if "id_1" in params:
                wanted = params["id_1"]
                rows = [row for row in rows if row["id"] in wanted] if isinstance(wanted, list) else [
                    row for row in rows if row["id"] == wanted
                ]
            if "status_1" in params:
                rows = [row for row in rows if row["status"] == params["status_1"]]
            return [SimpleNamespace(ord=row["ord"], _mapping=copy.deepcopy(row)) for row in rows]

    conn = Connection()
    db._conn = conn
    return db, conn, collection


def test_record_tracks_one_row_and_reuses_its_identity(scoped_db):
    db, conn, _ = scoped_db
    row = db.record("events", "tracked-1")
    assert row["id"] == "tracked-1"
    assert db.record("events", "tracked-1") is row
    assert len(conn.selects) == 1
    assert "events" not in db._data and "events" not in db._snap
    assert list(db._partial["events"]) == ["tracked-1"]
    assert not db.dirty()


def test_missing_record_does_not_create_or_delete_anything(scoped_db):
    db, conn, _ = scoped_db
    assert db.record("events", "missing") is None
    assert not db.dirty()
    db.flush()
    assert conn.writes == []


def test_scoped_nested_edit_flushes_only_that_row_and_preserves_order(scoped_db):
    db, conn, _ = scoped_db
    row = db.record("events", "tracked-1")
    row["place"]["address"] = "Changed address"
    assert db.dirty()
    db.flush()
    assert len(conn.writes) == 1
    update = conn.writes[0]
    assert update.is_update
    params = update.compile().params
    assert params["id_1"] == "tracked-1"
    assert params["ord"] == 2048
    assert params["place"]["address"] == "Changed address"
    assert "events" not in db._data


def test_scoped_selection_includes_previously_edited_rows_entering_filter(scoped_db):
    db, _conn, collection = scoped_db
    row = db.record("events", "tracked-0")
    row["status"] = "cancelled"
    # SQL still sees published, but the tracked authoritative row already matches.
    found = db.records("events", collection.table.c.status == "cancelled",
                       predicate=lambda event: event["status"] == "cancelled")
    assert found == [row]
    assert found[0] is row


def test_scoped_selection_excludes_previously_edited_rows_leaving_filter(scoped_db):
    db, _conn, collection = scoped_db
    row = db.record("events", "tracked-0")
    row["status"] = "cancelled"
    found = db.records("events", collection.table.c.status == "published",
                       predicate=lambda event: event["status"] == "published")
    assert [event["id"] for event in found] == ["tracked-1", "tracked-2"]
    assert db.record("events", "tracked-0") is row


def test_full_load_promotes_same_objects_with_original_snapshot(scoped_db):
    db, conn, _ = scoped_db
    row = db.record("events", "tracked-1")
    row["title"] = "Edited before full load"
    assert db.events[1] is row
    assert db.events[1]["title"] == "Edited before full load"
    assert "events" not in db._partial and "events" not in db._partial_snap
    assert db.dirty()
    db.flush()
    assert len(conn.writes) == 1
    assert conn.writes[0].is_update
    assert conn.writes[0].compile().params["title"] == "Edited before full load"


def test_full_collection_remains_authoritative_after_removal_and_edits(scoped_db):
    db, conn, collection = scoped_db
    row = db.events[1]
    db.events.pop(0)
    row["status"] = "cancelled"
    before = len(conn.selects)
    assert db.record("events", "tracked-0") is None
    assert db.record("events", "tracked-1") is row
    assert db.records("events", collection.table.c.status == "cancelled",
                      predicate=lambda event: event["status"] == "cancelled") == [row]
    assert len(conn.selects) == before


def test_checkpoint_restores_partial_edits_and_discards_later_tracking(scoped_db):
    db, conn, _ = scoped_db
    row = db.record("events", "tracked-0")
    row["title"] = "Before checkpoint"
    restore = db.checkpoint()
    row["title"] = "After checkpoint"
    db.record("events", "tracked-1")["title"] = "Later record"
    restore()
    assert db.record("events", "tracked-0")["title"] == "Before checkpoint"
    assert list(db._partial["events"]) == ["tracked-0"]
    assert db.dirty()
    db.flush()
    assert len(conn.writes) == 1
    assert conn.writes[0].compile().params["title"] == "Before checkpoint"


def test_checkpoint_undoes_partial_promotion_without_losing_original_snapshot(scoped_db):
    db, conn, _ = scoped_db
    db.record("events", "tracked-0")["title"] = "Before checkpoint"
    restore = db.checkpoint()
    db.events[0]["title"] = "After full load"
    restore()
    assert "events" not in db._data
    assert db.record("events", "tracked-0")["title"] == "Before checkpoint"
    db.flush()
    assert len(conn.writes) == 1
    assert conn.writes[0].compile().params["title"] == "Before checkpoint"


def test_scoped_key_change_is_rejected(scoped_db):
    db, _conn, _ = scoped_db
    db.record("events", "tracked-0")["id"] = "replacement"
    with pytest.raises(store.SchemaMismatchError, match="key cannot be changed"):
        db.dirty()
    with pytest.raises(store.SchemaMismatchError, match="key cannot be changed"):
        _ = db.events


def test_scoped_unknown_fields_still_fail_strict_validation(scoped_db):
    db, _conn, _ = scoped_db
    db.record("events", "tracked-0")["unsupported"] = True
    with pytest.raises(store.SchemaMismatchError):
        db.flush()


def test_records_reject_unbounded_and_ambiguous_selection(scoped_db):
    db, _conn, collection = scoped_db
    with pytest.raises(ValueError, match="SQL conditions"):
        db.records("events", predicate=lambda _row: True)
    with pytest.raises(ValueError, match="in-memory predicate"):
        db.records("events", collection.table.c.status == "published")


def test_scoped_reads_reject_keyless_collections(scoped_db):
    db, _conn, _ = scoped_db
    with pytest.raises(ValueError, match="keyed"):
        db.record("urgentCalls", "some-id")


def stage_new_event(scoped_db):
    db, conn, _collection = scoped_db
    row = copy.deepcopy(db.record("events", "tracked-0"))
    row.update(id="staged-new", title="New event")
    execute = conn.execute
    def with_max(query, *args):
        if query.is_select and str(query).startswith("SELECT max("):
            return SimpleNamespace(scalar_one=lambda: 3072)
        return execute(query, *args)
    conn.execute = with_max
    db.append_records("events", [row])
    return row


def test_scoped_append_is_staged_until_flush_and_keeps_identity(scoped_db):
    db, conn, collection = scoped_db
    row = stage_new_event(scoped_db)
    assert "events" not in db._data
    assert not conn.writes
    assert db.record("events", row["id"]) is row
    row["place"]["address"] = "Updated before insert"
    assert db.dirty()
    plan = db._partial_plan(collection)
    assert len(plan.inserts) == 1 and not plan.updates and not plan.deletes
    assert plan.inserts[0]["ord"] == 4096
    assert plan.inserts[0]["place"]["address"] == "Updated before insert"
    db.flush()
    assert len(conn.writes) == 1 and conn.writes[0].is_insert


def test_scoped_append_promotes_to_full_load_as_insert(scoped_db):
    db, _conn, collection = scoped_db
    row = stage_new_event(scoped_db)
    assert db.events[-1] is row and len(db.events) == 4
    plan = db._plan(collection, db.events)
    assert [r["id"] for r in plan.inserts] == [row["id"]]
    assert not plan.updates and not plan.deletes


def test_checkpoint_can_undo_scoped_insert_without_sql_write(scoped_db):
    db, conn, _collection = scoped_db
    db.record("events", "tracked-0")
    restore = db.checkpoint()
    stage_new_event(scoped_db)
    restore()
    assert db.record("events", "staged-new") is None
    assert not db.dirty() and not conn.writes


def test_scoped_insert_rejects_duplicate_existing_id(scoped_db):
    db, _conn, _collection = scoped_db
    row = db.record("events", "tracked-0")
    with pytest.raises(store.SchemaMismatchError, match="repeated"):
        db.append_records("events", [copy.deepcopy(row)])


def test_read_projection_overlays_edits_without_tracking_other_rows(scoped_db):
    from app.domain.event_reads import project
    db, _conn, collection = scoped_db
    row = db.record("events", "tracked-1")
    row["status"] = "cancelled"
    rows = project(db, {"id", "title", "status"}, collection.table.c.status == "published",
                   predicate=lambda event: event["status"] == "published")
    assert [event["id"] for event in rows] == ["tracked-0", "tracked-2"]
    assert list(db._partial["events"]) == ["tracked-1"]
    rows[0]["title"] = "Detached"
    assert db.record("events", "tracked-0")["title"] == "Original 0"


def test_read_projection_includes_edited_row_entering_filter_in_original_order(scoped_db):
    from app.domain.event_reads import project
    db, _conn, collection = scoped_db
    db.record("events", "tracked-1")["status"] = "cancelled"
    rows = project(db, {"id", "status"}, collection.table.c.status == "cancelled",
                   predicate=lambda event: event["status"] == "cancelled")
    assert rows == [{"id": "tracked-1", "status": "cancelled"}]
