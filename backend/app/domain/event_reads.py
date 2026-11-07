"""Чтение встреч с учётом изменений, ещё не записанных в БД."""

import json
from collections import Counter
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONPATH

from app.domain.schema import COLLECTIONS


def reference_condition(key: str, value):
    if key not in {"districtId", "ruleId"}:
        raise ValueError("Unsupported event reference")
    table = COLLECTIONS["events"].table
    path = f'strict $.** ? (@.type() == "object").keyvalue() ? (@.key == "{key}" && @.value == {json.dumps(value)})'
    return sa.func.jsonb_path_exists(sa.func.to_jsonb(table.table_valued()), sa.cast(path, JSONPATH))


def reference_counts(database, key: str, walk):
    def values(event):
        return [obj[k] for obj, k in walk(event, key) if isinstance(obj.get(k), str)]
    if "events" in database._data:
        return Counter(value for event in database._data["events"] for value in values(event))
    if key not in {"districtId", "ruleId"}:
        raise ValueError("Unsupported event reference")
    table = COLLECTIONS["events"].table
    path = f'strict $.** ? (@.type() == "object").keyvalue() ? (@.key == "{key}").value'
    # Most district references are the single place field. Count it directly;
    # inspect arbitrary nested JSON only on rows that actually contain the key.
    counts = Counter()
    if key == "districtId":
        direct = table.c.place[key].astext
        query = sa.select(direct, sa.func.count()).where(sa.func.jsonb_typeof(table.c.place[key]) == "string").group_by(direct)
        counts.update(dict(database.connection.execute(query).all()))
    columns = []
    for field in COLLECTIONS["events"].fields:
        for name, kind in zip(field.columns, field.kinds, strict=True):
            if kind == "json":
                value = table.c[name]
                if key == "districtId" and field.key == "place":
                    value = value.op("-")(key)
                columns.append(value)
    source = sa.func.jsonb_build_array(*columns)
    array = sa.func.jsonb_path_query_array(source, sa.cast(path, JSONPATH))
    refs = sa.select(sa.func.jsonb_array_elements_text(array).label("value")).where(
        sa.cast(source, sa.Text).contains(f'"{key}":')
    ).subquery()
    query = sa.select(refs.c.value, sa.func.count()).group_by(refs.c.value)
    counts.update(dict(database.connection.execute(query).all()))
    for id_, event in database._partial.get("events", {}).items():
        original = database._partial_snap["events"][id_][1]
        if original is not None:
            counts.subtract(values(json.loads(original)))
        counts.update(values(event))
    return counts


def project(database, fields: set[str], *where: Any, predicate=None):
    collection = COLLECTIONS["events"]
    conditions = where or (sa.true(),)
    keep = predicate or (lambda _event: True)
    if "events" in database._data:
        return [{key: event[key] for key in fields if key in event}
                for event in database.records("events", *conditions, predicate=keep)]
    selected = replace(collection, fields=[f for f in collection.fields if f.key in fields or f.key == "id"])
    columns = [collection.table.c[name] for f in selected.fields for name in f.columns]
    query = sa.select(*columns, collection.table.c.ord).where(*conditions).order_by(collection.table.c.ord, collection.table.c.id)
    rows, orders = {}, {}
    for result in database.connection.execute(query):
        row = database._row(selected, result._mapping)
        rows[row["id"]] = row
        orders[row["id"]] = result._mapping.get("ord", 0)
    for id_, event in database._partial.get("events", {}).items():
        if keep(event):
            rows[id_] = {key: event[key] for key in fields | {"id"} if key in event}
            orders[id_] = database._partial_snap["events"][id_][0]
        else:
            rows.pop(id_, None)
    return sorted(rows.values(), key=lambda event: (orders[event["id"]], event["id"]))


def count(database, *where: Any, predicate):
    if "events" in database._data or database._partial.get("events"):
        return len(database.records("events", *(where or (sa.true(),)), predicate=predicate))
    table = COLLECTIONS["events"].table
    return database.connection.execute(sa.select(sa.func.count()).select_from(table).where(*where)).scalar_one()


def counts_by_sport(database):
    if "events" in database._data or database._partial.get("events"):
        return dict(Counter(event["sportId"] for event in project(database, {"sportId"})))
    table = COLLECTIONS["events"].table
    return dict(database.connection.execute(sa.select(table.c.sport_id, sa.func.count()).group_by(table.c.sport_id)).all())


def organized(database, user_id: str, *where: Any, predicate=None):
    org_ids = {o["id"] for o in database.organizations if o["ownerId"] == user_id}
    # A missing organization cannot grant management of an event.
    known = {o["id"] for o in database.organizations}
    org_ids.update(m["orgId"] for m in database.engagement.managers if m["userId"] == user_id and m["orgId"] in known)
    table = COLLECTIONS["events"].table
    condition = sa.or_(
        sa.and_(table.c.organizer_kind == "user", table.c.organizer_id == user_id),
        sa.and_(table.c.organizer_kind == "org", table.c.organizer_id.in_(org_ids)),
    )
    def keep(event):
        ref = event["organizer"]
        own = ref == {"kind": "user", "id": user_id} or (ref["kind"] == "org" and ref["id"] in org_ids)
        return own and (predicate is None or predicate(event))
    return database.records("events", condition, *where, predicate=keep)
