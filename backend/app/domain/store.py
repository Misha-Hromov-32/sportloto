"""Данные доменных правил на время одного запроса и запись изменений одной транзакцией.

Правила работают с базой как с одним объектом: коллекции — списки словарей (`db.events`).
Объект собирается из таблиц (app/domain/schema.py): коллекция загружается при первом обращении,
а после правила слой хранения сравнивает её со снимком и пишет только изменённые, новые
и удалённые записи.

Изменяющие запросы выполняются по одному (блокировка процесса и advisory-lock PostgreSQL),
поэтому номера записей, лист ожидания и счётчики мест не расходятся. Читающие запросы идут
параллельно на снимке REPEATABLE READ; если чтение что-то изменило (например, отметило
ссылку-приглашение), оно повторяется как изменяющее.
"""

import copy
import itertools
import json
import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from app.domain import clock
from app.domain.schema import (
    BOOL,
    COLLECTIONS,
    IDS,
    INT,
    ISO,
    NAMESPACES,
    NUM,
    STRS,
    Collection,
    demo_state,
)

logger = logging.getLogger(__name__)

_LOCK_KEY = 7_405_311  # advisory-lock изменяющих транзакций домена
_STEP = 1024

_TOP = {c.attr: c for c in COLLECTIONS.values() if "." not in c.path}
_NESTED = {ns: {c.attr: c for c in COLLECTIONS.values() if c.path.startswith(f"{ns}.")} for ns in NAMESPACES}


class SchemaMismatchError(RuntimeError):
    """В записи есть поле, для которого нет колонки: оно бы потерялось при сохранении."""


def _to_db(kind: str, value: Any) -> Any:
    if value is None:
        return None
    if kind == ISO:
        moment = clock.parse(value)
        if moment is None:
            raise ValueError(f"Неверная дата: {value!r}")
        return moment
    if kind == INT:
        return int(value)
    if kind == NUM:
        return float(value)
    if kind == BOOL:
        return bool(value)
    if kind in {IDS, STRS}:
        return list(value)
    return value


def _from_db(kind: str, value: Any) -> Any:
    if value is None:
        return None
    if kind == ISO:
        return clock.iso(value)
    if kind == NUM:
        # Целое число из колонки double precision — int, как его записали правила («4», а не «4.0» в тексте).
        return int(value) if value.is_integer() else value
    if kind in {IDS, STRS}:
        return list(value)
    return value


def _dump(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


def _assign_ords(keys: list[Any], snap: dict[Any, tuple[int, str]]) -> list[int]:
    """Значения `ord` в текущем порядке записей: у старых они не меняются, новые встают между соседями.

    Если записи переставили или новой некуда встать, коллекция нумеруется заново с шагом 1024,
    чтобы следующим вставкам в середину хватило места.
    """
    old = [snap[k][0] if k in snap else None for k in keys]
    known = [o for o in old if o is not None]
    if any(b <= a for a, b in itertools.pairwise(known)):
        return [i * _STEP for i in range(len(keys))]
    out: list[int | None] = list(old)
    n = len(out)
    i = 0
    while i < n:
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < n and out[j] is None:
            j += 1
        left = out[i - 1] if i > 0 else None
        right = out[j] if j < n else None
        count = j - i
        if left is None and right is None:
            start, step = 0, _STEP
        elif left is None:
            start, step = right - count * _STEP, _STEP  # type: ignore[operator]
        elif right is None:
            start, step = left + _STEP, _STEP
        elif right - left > count:
            step = (right - left) // (count + 1)
            start = left + step
        else:
            return [k * _STEP for k in range(n)]
        for k in range(count):
            out[i + k] = start + k * step
        i = j
    return [o for o in out if o is not None]


@dataclass(slots=True)
class LiveChange:
    resources: list[str]
    ids: list[str]
    type: str


@dataclass(slots=True)
class _Plan:
    deletes: list[Any] = field(default_factory=list)
    updates: list[tuple[Any, dict[str, Any]]] = field(default_factory=list)
    inserts: list[dict[str, Any]] = field(default_factory=list)
    replace_all: bool = False

    @property
    def changed(self) -> bool:
        return bool(self.deletes or self.updates or self.inserts or self.replace_all)


class Namespace:
    """`db.inventory`, `db.engagement`: вложенные коллекции, обращение — как к атрибутам базы."""

    def __init__(self, db: "Database", collections: dict[str, Collection]) -> None:
        object.__setattr__(self, "_db", db)
        object.__setattr__(self, "_collections", collections)

    def __getattr__(self, name: str) -> list[Any]:
        collection = self._collections.get(name)
        if collection is None:
            raise AttributeError(name)
        return self._db.collection(collection)

    def __setattr__(self, name: str, value: list[Any]) -> None:
        collection = self._collections.get(name)
        if collection is None:
            raise AttributeError(name)
        self._db.replace(collection, value)


class Database:
    """База одного запроса. Коллекции — списки словарей: `db.events`, `db.inventory.lines`, `db.first_visits`."""

    def __init__(self, conn: Connection, *, strict: bool = False) -> None:
        object.__setattr__(self, "_conn", conn)
        object.__setattr__(self, "_strict", strict)
        object.__setattr__(self, "_data", {})
        object.__setattr__(self, "_snap", {})
        object.__setattr__(self, "_partial", {})
        object.__setattr__(self, "_partial_snap", {})
        object.__setattr__(self, "_state", None)
        object.__setattr__(self, "_state_snap", None)
        object.__setattr__(self, "changes", [])
        object.__setattr__(self, "after_commit_sql", [])
        for ns, collections in _NESTED.items():
            object.__setattr__(self, ns, Namespace(self, collections))

    @property
    def connection(self) -> Connection:
        """Соединение транзакции — для служебных запросов рядом с правилами (сессия входа, хеш пароля)."""
        return self._conn

    # ---------- Коллекции ----------

    def __getattr__(self, name: str) -> list[Any]:
        collection = _TOP.get(name)
        if collection is None:
            raise AttributeError(name)
        return self.collection(collection)

    def __setattr__(self, name: str, value: Any) -> None:
        collection = _TOP.get(name)
        if collection is None:
            object.__setattr__(self, name, value)
            return
        self.replace(collection, value)

    def collection(self, c: Collection) -> list[Any]:
        if c.path not in self._data:
            self._load(c)
        return self._data[c.path]

    def replace(self, c: Collection, value: list[Any]) -> None:
        """`db.reminders = sent.slice(-N)`: коллекцию заменили целиком."""
        self.collection(c)
        self._data[c.path] = value

    def records(
        self, path: str, *where: Any,
        predicate: Callable[[dict[str, Any]], bool] | None = None,
    ) -> list[dict[str, Any]]:
        """Tracked existing rows without materializing an entire collection.

        SQL conditions bound the database read; ``predicate`` expresses the same
        rule for authoritative objects already changed in this transaction.
        Returned dictionaries support normal nested edits. Changing their key or
        adding/removing elements in the returned list is not a collection edit.
        Use the full collection API for inserts, deletes and reordering.
        """
        c = COLLECTIONS[path]
        if c.key is None or c.write_only:
            raise ValueError(f"{path}: scoped reads require a keyed readable collection")
        if not where or predicate is None:
            raise ValueError("Scoped reads require SQL conditions and an in-memory predicate")
        if path in self._data:
            return [row for row in self._data[path] if predicate(row)]
        table = c.table
        columns = [table.c[name] for field_ in c.fields for name in field_.columns]
        query = sa.select(*columns, table.c.ord).where(*where).order_by(
            table.c.ord, *table.primary_key.columns,
        )
        known = self._partial.setdefault(path, {})
        snap = self._partial_snap.setdefault(path, {})
        selected = []
        seen = set()
        for sql_row in self._conn.execute(query):
            mapping = sql_row._mapping  # noqa: SLF001
            item = self._row(c, mapping)
            key = item[c.key]
            if key not in known:
                known[key] = item
                snap[key] = (mapping["ord"], _dump(item))
            selected.append(known[key])
            seen.add(key)
        # A previously tracked row may have changed into this selection since
        # SQL still sees its original values. Always reuse its authoritative dict.
        selected.extend(row for key, row in known.items() if key not in seen)
        return sorted(
            (row for row in selected if predicate(row)),
            key=lambda row: (snap[row[c.key]][0], str(row[c.key])),
        )

    def record(self, path: str, key: Any) -> dict[str, Any] | None:
        """One authoritative tracked record, or None; never loads its collection."""
        c = COLLECTIONS[path]
        if c.key is None or c.write_only:
            raise ValueError(f"{path}: scoped reads require a keyed readable collection")
        if path in self._data:
            return next((row for row in self._data[path] if row.get(c.key) == key), None)
        known = self._partial.get(path, {})
        if key in known:
            return known[key]
        column = c.table.c[next(f.columns[0] for f in c.fields if f.key == c.key)]
        rows = self.records(path, column == key, predicate=lambda row: row.get(c.key) == key)
        return rows[0] if rows else None

    def append_records(self, path: str, rows: list[dict[str, Any]]) -> None:
        """Stage new keyed rows at the end without loading existing collection rows."""
        c = COLLECTIONS[path]
        if c.key is None or c.write_only:
            raise ValueError("Scoped inserts require a keyed readable collection")
        if not rows:
            return
        keys = [row.get(c.key) for row in rows]
        if None in keys or len(set(keys)) != len(keys):
            raise SchemaMismatchError(f"{path}: repeated or empty record key")
        for row in rows:
            self._check_keys(c, row)
        if path in self._data:
            if set(keys) & {row[c.key] for row in self._data[path]}:
                raise SchemaMismatchError(f"{path}: repeated record key")
            self._data[path].extend(rows)
            return
        if any(self.record(path, key) is not None for key in keys):
            raise SchemaMismatchError(f"{path}: repeated record key")
        last = self._conn.execute(sa.select(sa.func.max(c.table.c.ord))).scalar_one()
        snap = self._partial_snap.setdefault(path, {})
        order = max([last if last is not None else -_STEP, *(s[0] for s in snap.values())])
        known = self._partial.setdefault(path, {})
        for key, row in zip(keys, rows, strict=True):
            order += _STEP
            known[key] = row
            snap[key] = (order, None)

    def _load(self, c: Collection) -> None:
        for key, row in self._partial.get(c.path, {}).items():
            if row.get(c.key) != key:
                raise SchemaMismatchError(f"{c.path}: a scoped record key cannot be changed")
        rows: list[Any] = []
        snap: dict[Any, tuple[int, str]] = {}
        if not c.write_only:
            table = c.table
            columns = [table.c.value] if c.scalar else [table.c[n] for f in c.fields for n in f.columns]
            query = sa.select(*columns, table.c.ord).order_by(table.c.ord, *table.primary_key.columns)
            for row in self._conn.execute(query):
                item = row[0] if c.scalar else self._row(c, row._mapping)  # noqa: SLF001
                if c.key is not None:
                    key = item[c.key]
                    if key in self._partial.get(c.path, {}):
                        item = self._partial[c.path][key]
                        snap[key] = self._partial_snap[c.path][key]
                    else:
                        snap[key] = (row.ord, _dump(item))
                rows.append(item)
        if c.key is not None:
            # Scoped inserts have no SQL row yet, but belong to a later full load too.
            for key, item in self._partial.get(c.path, {}).items():
                original = self._partial_snap[c.path][key]
                if original[1] is None:
                    rows.append(item)
                    snap[key] = original
        self._data[c.path] = rows
        # Снимок: у коллекций с ключом — `ord` и JSON каждой записи, у остальных — весь список.
        self._snap[c.path] = _dump(rows) if c.key is None else snap
        self._partial.pop(c.path, None)
        self._partial_snap.pop(c.path, None)

    @staticmethod
    def _row(c: Collection, mapping: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in c.fields:
            values = [_from_db(kind, mapping[name]) for name, kind in zip(f.columns, f.kinds, strict=True)]
            out[f.key] = f.load(*values) if f.load else values[0]
        return out

    def checkpoint(self) -> Callable[[], None]:
        """Точка отката внутри транзакции: вернуть загруженные коллекции и состояние демо к этому моменту.

        Для неудачного шага многошагового действия: изменения до точки остаются, после — забываются.
        Коллекции, загруженные после точки, просто перечитаются из базы (до коммита в неё ничего не пишется).
        """
        loaded = copy.deepcopy(self._data)
        snapshots = copy.deepcopy(self._snap)
        partial = copy.deepcopy(self._partial)
        partial_snapshots = copy.deepcopy(self._partial_snap)
        state = copy.deepcopy(self._state)
        state_snap = self._state_snap

        def restore() -> None:
            for path in list(self._data):
                if path not in loaded:
                    del self._data[path]
                    self._snap.pop(path, None)
            self._data.update(copy.deepcopy(loaded))
            object.__setattr__(self, "_snap", copy.deepcopy(snapshots))
            object.__setattr__(self, "_partial", copy.deepcopy(partial))
            object.__setattr__(self, "_partial_snap", copy.deepcopy(partial_snapshots))
            object.__setattr__(self, "_state", copy.deepcopy(state))
            object.__setattr__(self, "_state_snap", state_snap)

        return restore

    # ---------- Состояние демо и номера ----------

    def _demo(self) -> dict[str, Any]:
        if self._state is None:
            row = self._conn.execute(sa.select(demo_state).where(demo_state.c.id == 1)).first()
            state = (
                {
                    "version": row.version,
                    "seededAt": clock.iso(row.seeded_at),
                    "seq": row.seq,
                    "settings": row.settings,
                }
                if row
                else {}
            )
            object.__setattr__(self, "_state", state)
            object.__setattr__(self, "_state_snap", _dump(state) if row else None)
        return self._state

    @property
    def seeded(self) -> bool:
        return bool(self._demo())

    @property
    def version(self) -> int:
        return self._demo().get("version", 0)

    @version.setter
    def version(self, value: int) -> None:
        self._demo()["version"] = value

    @property
    def seeded_at(self) -> str:
        return self._demo().get("seededAt", "")

    @seeded_at.setter
    def seeded_at(self, value: str) -> None:
        self._demo()["seededAt"] = value

    @property
    def seq(self) -> int:
        return self._demo().get("seq", 0)

    @seq.setter
    def seq(self, value: int) -> None:
        self._demo()["seq"] = value

    @property
    def settings(self) -> dict[str, Any]:
        return self._demo().setdefault("settings", {})

    @settings.setter
    def settings(self, value: dict[str, Any]) -> None:
        self._demo()["settings"] = value

    def next_id(self, prefix: str) -> str:
        """Номер новой записи от общего счётчика: префикс и base36 — `e-7pt`."""
        self.seq += 1
        return f"{prefix}-{base36(self.seq)}"

    # ---------- Живые обновления ----------

    def publish(self, resources: list[str], ids: list[str] | None = None, type_: str = "updated") -> None:
        """Событие уйдёт подписчикам SSE после успешного коммита."""
        self.changes.append(LiveChange(list(dict.fromkeys(resources)), list(ids or []), type_))

    # ---------- Сохранение ----------

    def dirty(self) -> bool:
        if self._state_changed():
            return True
        return any(self._plan(COLLECTIONS[path], rows).changed for path, rows in self._data.items()) or any(
            self._partial_plan(COLLECTIONS[path]).changed for path in self._partial
        )

    def flush(self) -> None:
        for path, rows in self._data.items():
            self._apply(COLLECTIONS[path], self._plan(COLLECTIONS[path], rows))
        for path in self._partial:
            self._apply(COLLECTIONS[path], self._partial_plan(COLLECTIONS[path]))
        self._flush_state()
        for statement in self.after_commit_sql:
            self._conn.execute(statement)

    def _check_keys(self, c: Collection, row: dict[str, Any]) -> None:
        unknown = set(row) - c.keys
        if unknown:
            message = f"{c.path}: нет колонок для полей {sorted(unknown)}"
            if self._strict:
                raise SchemaMismatchError(message)
            logger.warning(message)

    def _partial_plan(self, c: Collection) -> _Plan:
        plan = _Plan()
        for key, row in self._partial[c.path].items():
            if row.get(c.key) != key:
                raise SchemaMismatchError(f"{c.path}: a scoped record key cannot be changed")
            order, original = self._partial_snap[c.path][key]
            if original is None:
                plan.inserts.append({**c.insert_defaults, **self._values(c, row), "ord": order})
            elif original != _dump(row):
                plan.updates.append((key, {**self._values(c, row), "ord": order}))
        return plan

    def _values(self, c: Collection, row: dict[str, Any]) -> dict[str, Any]:
        self._check_keys(c, row)
        values: dict[str, Any] = {}
        for f in c.fields:
            raw = row.get(f.key)
            parts = f.dump(raw) if f.dump else (raw,)
            for name, kind, value in zip(f.columns, f.kinds, parts, strict=True):
                values[name] = _to_db(kind, value)
        return values

    def _plan(self, c: Collection, rows: list[Any]) -> _Plan:
        plan = _Plan()
        if c.write_only:
            plan.inserts = [{**c.insert_defaults, **self._values(c, r)} for r in reversed(rows)]
            return plan
        if c.key is None:
            if _dump(rows) != self._snap[c.path]:
                plan.replace_all = True
                plan.inserts = [
                    {"value": r, "ord": i} if c.scalar else {**self._values(c, r), "ord": i}
                    for i, r in enumerate(rows)
                ]
            return plan
        snap: dict[Any, tuple[int, str]] = self._snap[c.path]
        keys = [r.get(c.key) for r in rows]
        if len(set(keys)) != len(keys) or None in keys:
            raise SchemaMismatchError(f"{c.path}: повторяющийся или пустой ключ записи")
        present = set(keys)
        plan.deletes = [k for k in snap if k not in present]
        for row, key, order in zip(rows, keys, _assign_ords(keys, snap), strict=True):
            old = snap.get(key)
            if old is None or old[1] is None:
                plan.inserts.append({**c.insert_defaults, **self._values(c, row), "ord": order})
            elif old[0] != order or old[1] != _dump(row):
                plan.updates.append((key, {**self._values(c, row), "ord": order}))
        return plan

    def _apply(self, c: Collection, plan: _Plan) -> None:
        if not plan.changed:
            return
        table = c.table
        if plan.replace_all:
            self._conn.execute(sa.delete(table))
        elif plan.deletes or plan.updates:
            key_column = table.c[next(f.columns[0] for f in c.fields if f.key == c.key)]
            if plan.deletes:
                self._conn.execute(sa.delete(table).where(key_column.in_(plan.deletes)))
            for key, values in plan.updates:
                self._conn.execute(sa.update(table).where(key_column == key).values(**values))
        if plan.inserts:
            self._conn.execute(sa.insert(table), plan.inserts)

    def _state_changed(self) -> bool:
        return bool(self._state) and self._state_snap != _dump(self._state)

    def _flush_state(self) -> None:
        if not self._state_changed():
            return
        values = {
            "version": self._state.get("version", 0),
            "seeded_at": _to_db(ISO, self._state.get("seededAt") or clock.iso(clock.now())),
            "seq": self._state.get("seq", 0),
            "settings": self._state.get("settings", {}),
        }
        if self._state_snap is None:
            self._conn.execute(sa.insert(demo_state).values(id=1, **values))
        else:
            self._conn.execute(sa.update(demo_state).where(demo_state.c.id == 1).values(**values))


_current: ContextVar[Database | None] = ContextVar("domain_database", default=None)
# Подписки на сохранённое содержимое коллекции: справочник городов держит копию для запросов вне транзакции.
_watchers: dict[str, list[Callable[[list[Any]], None]]] = {}


def watch(path: str, fn: Callable[[list[Any]], None]) -> None:
    """`fn` получит коллекцию `path` после каждой транзакции, которая её прочитала или изменила."""
    _watchers.setdefault(path, []).append(fn)


def _notify_watchers(db: Database) -> None:
    for path, fns in _watchers.items():
        rows = db._data.get(path)  # noqa: SLF001
        if rows is not None:
            for fn in fns:
                fn(rows)


def current() -> Database | None:
    """База текущего запроса или None вне транзакции."""
    return _current.get()


def data() -> Database:
    """База текущего запроса."""
    db = _current.get()
    if db is None:
        raise RuntimeError("Доменные правила вызваны вне транзакции DomainStore")
    return db


def next_id(prefix: str) -> str:
    return data().next_id(prefix)


@contextmanager
def bound(db: Database) -> Iterator[Database]:
    token = _current.set(db)
    try:
        yield db
    finally:
        _current.reset(token)


class DomainStore:
    """Транзакции доменных правил поверх синхронного движка SQLAlchemy (psycopg)."""

    def __init__(
        self,
        engine: Engine,
        *,
        publish: Callable[[list[LiveChange]], None] | None = None,
        strict: bool = False,
    ) -> None:
        self.engine = engine
        self.publish = publish
        self.strict = strict
        self._lock = threading.Lock()
        # Номер последней изменяющей транзакции процесса: по нему чтение понимает, что данные не менялись.
        self._version = 0

    def read[T](self, fn: Callable[[], T]) -> T:
        """Чтение на согласованном снимке.

        Если правило при чтении что-то изменило (отметило ссылку-приглашение, записало поиск в журнал
        спроса), а с начала чтения никто ничего не записал, — снимок ещё верен, и изменения сохраняются
        как есть, без повторного запуска правила: у правил бывает состояние в памяти (защита от повторного
        учёта поиска), и второй запуск его бы задвоил. Если запись успела пройти — правило выполняется
        заново как изменяющее.
        """
        version = self._version
        with self.engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn, conn.begin():
            db = Database(conn, strict=self.strict)
            with bound(db):
                result = fn()
            changed = db.dirty()
        if not changed:
            if self._version == version:
                _notify_watchers(db)
            return result
        with self._lock:
            if self._version == version:
                with self.engine.begin() as conn:
                    conn.execute(sa.text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LOCK_KEY})
                    object.__setattr__(db, "_conn", conn)
                    with bound(db):
                        db.flush()
                self._committed(db)
                return result
        return self.write(fn)

    def write[T](self, fn: Callable[[], T]) -> T:
        with self._lock:
            with self.engine.begin() as conn:
                conn.execute(sa.text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LOCK_KEY})
                db = Database(conn, strict=self.strict)
                with bound(db):
                    result = fn()
                    db.flush()
            self._committed(db)
        return result

    def _committed(self, db: Database) -> None:
        self._version += 1
        _notify_watchers(db)
        if self.publish and db.changes:
            self.publish(db.changes)

    def dispose(self) -> None:
        self.engine.dispose()
