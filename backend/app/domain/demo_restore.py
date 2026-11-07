"""Восстановление демо-данных на публичном сервере без потери записей настоящих людей.

Демо-аккаунты общие: посетители допускают организации, меняют роли, создают события и направления.
Восстановление возвращает записи сидов к исходному виду (как `merge_seed` при выкладке) и убирает то,
что посетители создали через демо-аккаунты. Записи зарегистрированных людей, импорт из сообществ
и записи о деньгах остаются.

Запуск — `python -m app.demo_restore` (см. app/demo_restore.py), `--dry-run` только показывает сводку.
"""

import copy
import json
import re
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.domain import bus, clock, provider, seed, store
from app.domain.features.imports import SERVICE_USER_ID
from app.domain.schema import COLLECTIONS, Collection

# Метка последнего восстановления в настройках демо: сервер замечает её в фоновой проверке
# и рассылает вкладкам «перечитать всё» (команда идёт отдельным процессом, брокер SSE — в памяти сервера).
RESTORE_MARK = "demoRestoreMark"

# Кто автор записи: поля с id пользователя. Коллекций без автора здесь нет — их записи
# уходят только вместе с тем, к чему привязаны.
_AUTHOR_FIELDS: dict[str, tuple[str, ...]] = {
    "organizations": ("ownerId",),
    "participations": ("userId",),
    "messages": ("authorId",),
    "companions": ("authorId",),
    "invites": ("fromUserId",),
    "notifications": ("userId",),
    "audit": ("actorId",),
    "idempotency": ("userId",),
    "greeters": ("userId",),
    "firstVisits": ("userId",),
    "urgentCalls": ("createdBy",),
    "demandSignals": ("userId",),
    "eventPrograms": ("by",),
    "inventory.pledges": ("userId",),
    "inventory.shelf": ("createdBy",),
    "inventory.loans": ("requesterId",),
    "inventory.support": ("createdBy",),
    "reports": ("reporterId",),
    "inviteGrants": ("userId",),
    "eventTeams": ("captainId",),
    "engagement.favorites": ("userId",),
    "engagement.follows": ("userId",),
    "engagement.savedSearches": ("userId",),
    "engagement.managers": ("addedBy",),
    "engagement.heldVotes": ("userId",),
    "engagement.shareLinks": ("userId",),
    "digestPrefs": ("userId",),
    "digests": ("userId",),
    "stopList": ("addedBy",),
    "mcpTokens": ("userId",),
    "mcpCalls": ("userId",),
}
# Записи, которые принадлежат событию или организации: мусор, если событие или организацию ведёт демо-аккаунт.
_EVENT_OWNED = frozenset({"inventory.lines", "greeters", "urgentCalls", "eventPrograms"})
_ORG_OWNED = frozenset({"venues", "demandOffers", "inventory.support"})

# Коллекции, записи которых восстановление не удаляет никогда: люди, импорт, справочники, журнал спроса.
# Направления (`sports`) чистятся отдельно: только ненужные, на которые никто не ссылается.
_NEVER_REMOVED = frozenset(
    {
        "users",
        "communitySources",
        "importedPosts",
        "demandLog",
        "sports",
        "categories",
        "districts",
        "rules",
        *provider.MONEY_COLLECTIONS,
    }
)
# Ссылки на удалённые записи: поле → коллекция (`targetId` — на любую удалённую запись).
_LINK_FIELDS: dict[str, str] = {
    "eventId": "events",
    "orgId": "organizations",
    "asOrgId": "organizations",
    "itemId": "inventory.shelf",
    "lineId": "inventory.lines",
    "teamId": "eventTeams",
    "companionId": "companions",
    "replyTo": "messages",
    "participationId": "participations",
    "tokenId": "mcpTokens",
    "venueId": "venues",
}
# Необязательные ссылки: у оставшейся записи ссылка обнуляется, сама запись не удаляется.
_NULLABLE_LINKS = frozenset(
    {
        ("companions", "eventId"),
        ("events", "venueId"),
        ("messages", "replyTo"),
        ("invites", "companionId"),
        ("participations", "teamId"),
    }
)
# Журнал спроса и сигналы ссылаются на направление без внешнего ключа: уходят вместе с ним.
_SPORT_ANALYTICS = ("demandSignals", "demandLog")
_SPORT_SCAN_SKIP = frozenset({"sports", "audit", "notifications", "categories", *_SPORT_ANALYTICS})
_NAMED = {"events": "title", "organizations": "name", "sports": "name"}
_DATE_IN_TEXT = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?")


@dataclass(slots=True)
class RestoreReport:
    dry_run: bool
    from_version: int
    to_version: int
    junk: dict[str, list[str]] = field(default_factory=dict)
    cascade: dict[str, list[str]] = field(default_factory=dict)
    stale_seed: dict[str, int] = field(default_factory=dict)
    restored: dict[str, int] = field(default_factory=dict)
    returned: dict[str, int] = field(default_factory=dict)
    sports: list[dict[str, str]] = field(default_factory=list)
    names: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    changes: list[str] = field(default_factory=list)
    people_records: dict[str, int] = field(default_factory=dict)
    people_details: list[str] = field(default_factory=list)
    kept_money_refs: int = 0
    backup: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "dryRun": self.dry_run,
            "fromVersion": self.from_version,
            "toVersion": self.to_version,
            "junk": {p: len(k) for p, k in self.junk.items()},
            "cascade": {p: len(k) for p, k in self.cascade.items()},
            "staleSeed": self.stale_seed,
            "restored": self.restored,
            "returned": self.returned,
            "sports": self.sports,
            "names": self.names,
            "changes": self.changes,
            "peopleRecords": self.people_records,
            "peopleDetails": self.people_details,
            "keptForMoney": self.kept_money_refs,
            "backup": self.backup,
        }


def _seed_collections() -> list[Collection]:
    return [c for c in COLLECTIONS.values() if not c.write_only]


def _rows(path: str) -> list[Any]:
    return store.data().collection(COLLECTIONS[path])


def _key(path: str, row: Any) -> str:
    return provider.row_key(COLLECTIONS[path], row)


def _ref_id(value: Any, kind: str) -> str | None:
    if isinstance(value, dict) and value.get("kind") == kind and isinstance(value.get("id"), str):
        return value["id"]
    return None


def _without_dates(value: Any) -> Any:
    if isinstance(value, str):
        return _DATE_IN_TEXT.sub("·", value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_without_dates(v) for v in value]
    if isinstance(value, dict):
        return {k: _without_dates(v) for k, v in value.items() if v is not None}
    return value


def _same_seed_row(path: str, old: Any, new: Any) -> bool:
    """Запись сида не менялась: свежий сид отличается от вчерашнего только датами и видом пустых полей."""
    c = COLLECTIONS[path]
    if c.scalar:
        return old == new
    keys = [f.key for f in c.fields]
    return _without_dates({k: old.get(k) for k in keys}) == _without_dates({k: new.get(k) for k in keys})


def _strings(value: Any) -> Iterator[str]:
    """Все строки записи, включая ключи словарей (уровни по направлениям — `{sportId: level}`)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from _strings(v)


class _Scan:
    """Что считать мусором демо-аккаунтов: состояние базы до восстановления."""

    def __init__(self, seed_keys: dict[str, set[str]], demo_users: set[str]) -> None:
        self.seed_keys = seed_keys
        self.demo_users = demo_users
        self.orgs = {o["id"]: o for o in _rows("organizations")}
        self.events = {e["id"]: e for e in _rows("events")}
        sources = _rows("communitySources")
        posts = _rows("importedPosts")
        # Страницы сообществ из импорта и их встречи не трогаем, даже если страницу забрал демо-аккаунт.
        self.import_orgs = {s.get("orgId") for s in sources} | {s.get("transferredTo") for s in sources}
        self.import_orgs |= {o["id"] for o in self.orgs.values() if o.get("ownerId") == SERVICE_USER_ID}
        self.import_orgs.discard(None)
        self.import_events = {p.get("eventId") for p in posts}
        for p in posts:
            self.import_events.update((p.get("draft") or {}).get("eventIds") or [])
        self.import_events.discard(None)

    def is_seed(self, path: str, key: str) -> bool:
        return key in self.seed_keys.get(path, set())

    def org_by_demo(self, org_id: Any) -> bool:
        o = self.orgs.get(org_id)
        return o is not None and org_id not in self.import_orgs and o.get("ownerId") in self.demo_users

    def event_author(self, e: dict[str, Any]) -> str | None:
        if e.get("createdBy"):
            return e["createdBy"]
        user = _ref_id(e.get("organizer"), "user")
        if user is not None:
            return user
        org = self.orgs.get(_ref_id(e.get("organizer"), "org"))
        return org.get("ownerId") if org is not None else None

    def event_by_demo(self, event_id: Any) -> bool:
        e = self.events.get(event_id)
        if e is None or event_id in self.import_events:
            return False
        if _ref_id(e.get("organizer"), "org") in self.import_orgs:
            return False
        return self.event_author(e) in self.demo_users

    def is_junk(self, path: str, row: Any) -> bool:
        if path == "events":
            return self.event_by_demo(row["id"])
        if path == "organizations":
            return row["id"] not in self.import_orgs and row.get("ownerId") in self.demo_users
        if path == "audit" and str(row.get("action") or "").startswith("import."):
            return False
        if any(row.get(f) in self.demo_users for f in _AUTHOR_FIELDS.get(path, ())):
            return True
        if path == "inventory.shelf":
            owner = row.get("owner")
            if _ref_id(owner, "user") in self.demo_users or self.org_by_demo(_ref_id(owner, "org")):
                return True
        if path == "stopList" and row.get("ownerKind") == "user" and row.get("ownerId") in self.demo_users:
            return True
        if path in _EVENT_OWNED and self.event_by_demo(row.get("eventId")):
            return True
        return path in _ORG_OWNED and self.org_by_demo(row.get("orgId"))


def _find_junk(scan: _Scan, money_refs: set[str]) -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    junk: dict[str, set[str]] = {}
    rows_by_key: dict[str, dict[str, Any]] = {}
    for c in _seed_collections():
        if c.scalar or c.path in _NEVER_REMOVED:
            continue
        rows_by_key[c.path] = {_key(c.path, r): r for r in _rows(c.path)}
        found = {
            k
            for k, r in rows_by_key[c.path].items()
            if not scan.is_seed(c.path, k) and scan.is_junk(c.path, r)
        }
        if found:
            junk[c.path] = found
    # Мусор, на который ссылаются записи о деньгах, остаётся вместе со всем, на что ссылается сам.
    kept: set[tuple[str, str]] = set()
    queue = [(p, k) for p, keys in junk.items() for k in keys if k in money_refs]
    while queue:
        path, k = queue.pop()
        if k not in junk.get(path, set()):
            continue
        junk[path].discard(k)
        kept.add((path, k))
        for _f, target, value in provider._references(path, rows_by_key[path][k]):  # noqa: SLF001
            queue.append((target, value))
        for f, target in _LINK_FIELDS.items():
            value = rows_by_key[path][k].get(f)
            if isinstance(value, str):
                queue.append((target, value))
    return {p: keys for p, keys in junk.items() if keys}, kept


def _cascade(removed: dict[str, set[str]], seed_keys: dict[str, set[str]]) -> dict[str, set[str]]:
    """Записи людей, привязанные к удалённому (запись на удалённое событие, ответ на удалённое сообщение)."""
    cascade: dict[str, set[str]] = {}
    while True:
        gone_ids = {k for keys in removed.values() for k in keys} | {
            k for keys in cascade.values() for k in keys
        }

        def gone(target: str, value: Any) -> bool:
            return isinstance(value, str) and (
                value in removed.get(target, set()) or value in cascade.get(target, set())
            )

        changed = False
        for c in _seed_collections():
            if c.scalar or c.path in _NEVER_REMOVED or c.path == "audit":
                continue
            rows = _rows(c.path)
            keep: list[Any] = []
            for r in rows:
                k = _key(c.path, r)
                dangling = False
                for f, target in _LINK_FIELDS.items():
                    if f in r and gone(target, r.get(f)):
                        if (c.path, f) in _NULLABLE_LINKS:
                            r[f] = None
                        else:
                            dangling = True
                if gone("organizations", _ref_id(r.get("organizer") or r.get("owner"), "org")):
                    dangling = True
                if c.path in {"reports", "engagement.follows"} and r.get("targetId") in gone_ids:
                    dangling = True
                if dangling and k not in seed_keys.get(c.path, set()):
                    cascade.setdefault(c.path, set()).add(k)
                    changed = True
                else:
                    keep.append(r)
            if len(keep) != len(rows):
                rows[:] = keep
        if not changed:
            return cascade


def _remove(junk: dict[str, set[str]]) -> None:
    for path, keys in junk.items():
        rows = _rows(path)
        rows[:] = [r for r in rows if _key(path, r) not in keys]


def _unused_sports(seed_keys: dict[str, set[str]], demo_users: set[str]) -> list[dict[str, Any]]:
    """Направления не из сидов, добавленные через демо-аккаунты, на которые после чистки ничто не ссылается.

    Направления настоящих людей и администратора остаются: справочник ведёт администратор.
    """
    removed: list[dict[str, Any]] = []
    while True:
        sports = _rows("sports")
        candidates = {
            s["id"]
            for s in sports
            if s["id"] not in seed_keys.get("sports", set()) and s.get("createdBy") in demo_users
        }
        if not candidates:
            return removed
        used: set[str] = set()
        for c in _seed_collections():
            if c.path in _SPORT_SCAN_SKIP:
                continue
            for r in _rows(c.path):
                used.update(s for s in _strings(r) if s in candidates)
        used.update(s.get("mergedInto") for s in sports if s.get("mergedInto") in candidates)
        drop = candidates - used
        if not drop:
            return removed
        removed.extend(s for s in sports if s["id"] in drop)
        sports[:] = [s for s in sports if s["id"] not in drop]
        for path in _SPORT_ANALYTICS:
            rows = _rows(path)
            rows[:] = [r for r in rows if r.get("sportId") not in drop]


def _status_changes(path: str, old: dict[str, Any], new: dict[str, Any], users: dict[str, Any]) -> str | None:
    if path == "organizations" and old.get("status") != new.get("status"):
        return f"Организация «{new['name']}»: {old.get('status')} → {new.get('status')}"
    if path == "users" and old.get("role") != new.get("role"):
        return f"Аккаунт {new['name']} ({new['id']}): роль {old.get('role')} → {new.get('role')}"
    if path == "events" and old.get("status") != new.get("status"):
        return f"Событие «{new['title']}»: {old.get('status')} → {new.get('status')}"
    if path == "participations" and old.get("status") != new.get("status"):
        name = (users.get(new.get("userId")) or {}).get("name") or new.get("userId")
        return f"Запись {name} на {new.get('eventId')}: {old.get('status')} → {new.get('status')}"
    return None


def restore_demo(*, dry_run: bool = False) -> RestoreReport:
    """Вернуть демо-данные к сидам и убрать мусор демо-аккаунтов. В `dry_run` база не меняется."""
    db = store.data()
    if not db.seeded:
        msg = "В базе нет демо-данных: восстанавливать нечего"
        raise RuntimeError(msg)
    undo = db.checkpoint()
    data = seed.build_seed(clock.now())
    known = provider._known_seed_ids()  # noqa: SLF001
    new_keys = {path: set(ids) for path, ids in provider.seed_ids(data).items()}
    seed_keys = {path: known.get(path, set()) | new_keys.get(path, set()) for path in new_keys}
    demo_users = (seed_keys.get("users", set())) - {SERVICE_USER_ID}

    paths = [c.path for c in _seed_collections() if not c.scalar]
    before = {path: {_key(path, r): copy.deepcopy(r) for r in _rows(path)} for path in paths}
    report = RestoreReport(dry_run=dry_run, from_version=db.version, to_version=data["version"])

    scan = _Scan(seed_keys, demo_users)
    junk, kept = _find_junk(scan, provider._money_refs())  # noqa: SLF001
    report.kept_money_refs = len(kept)
    _remove(junk)
    cascade = _cascade(junk, seed_keys)

    # Записи сидов — к исходному виду, как при выкладке новой версии. Снимок пишем сами: в нём удалённое.
    backup_dir = provider.demo_options.backup_dir
    provider.demo_options.backup_dir = ""
    try:
        provider.merge_seed(data)
    finally:
        provider.demo_options.backup_dir = backup_dir
    sports = _unused_sports(seed_keys, demo_users)

    after = {path: {_key(path, r) for r in _rows(path)} for path in paths}
    users_now = {u["id"]: u for u in _rows("users")}
    removed_rows: dict[str, list[Any]] = {}
    replaced_seed: dict[str, list[Any]] = {}
    for path in paths:
        gone = set(before[path]) - after[path]
        junk_here = junk.get(path, set())
        cascade_here = cascade.get(path, set()) & gone
        stale = {k for k in gone - junk_here - cascade_here if k in known.get(path, set())}
        other = gone - junk_here - cascade_here - stale
        if path == "sports":
            junk_here = {s["id"] for s in sports}
            other -= junk_here
        if junk_here:
            report.junk[path] = sorted(junk_here)
        if cascade_here | other:
            report.cascade[path] = sorted(cascade_here | other)
        if stale:
            report.stale_seed[path] = len(stale)
        removed_rows[path] = [before[path][k] for k in sorted(gone)]
        people = sorted(
            k
            for k in cascade_here | other
            if any(before[path][k].get(f) not in demo_users for f in _AUTHOR_FIELDS.get(path, ()))
        )
        if people:
            report.people_records[path] = len(people)
            for k in people:
                row = before[path][k]
                who = ", ".join(str(row.get(f)) for f in _AUTHOR_FIELDS[path])
                target = f", событие {row['eventId']}" if row.get("eventId") else ""
                report.people_details.append(f"{path} {k}: автор {who}{target}")
        if path in _NAMED:
            names = [
                {"id": k, "name": str(before[path][k].get(_NAMED[path]) or "")}
                for k in sorted(junk_here | cascade_here | other)
            ]
            if names:
                report.names[path] = names
        current = {_key(path, r): r for r in _rows(path)}
        returned = [k for k in new_keys.get(path, set()) if k in current and k not in before[path]]
        if returned:
            report.returned[path] = len(returned)
        changed = [
            k
            for k in new_keys.get(path, set())
            if k in current and k in before[path] and not _same_seed_row(path, before[path][k], current[k])
        ]
        if changed:
            report.restored[path] = len(changed)
            replaced_seed[path] = [before[path][k] for k in sorted(changed)]
            for k in sorted(changed):
                line = _status_changes(path, before[path][k], current[k], users_now)
                if line:
                    report.changes.append(line)
    report.sports = [{"id": s["id"], "name": s["name"]} for s in sports]

    if dry_run:
        undo()
        return report
    if backup_dir and (any(removed_rows.values()) or any(replaced_seed.values())):
        snapshot = {
            "savedAt": clock.iso(clock.now()),
            "kind": "demo-restore",
            "fromVersion": report.from_version,
            "toVersion": report.to_version,
            "records": {p: rows for p, rows in removed_rows.items() if rows},
            "replacedSeed": {p: rows for p, rows in replaced_seed.items() if rows},
        }
        saved = provider._write_backup(backup_dir, snapshot)  # noqa: SLF001
        report.backup = str(saved) if saved else None
    db.settings[RESTORE_MARK] = uuid.uuid4().hex
    bus.publish(list(bus.RESOURCES))
    return report


def format_report(report: RestoreReport) -> str:
    """Сводка для оператора: что удалено и что восстановлено, по коллекциям."""
    lines = [
        "Проверка без изменений (--dry-run): база не менялась." if report.dry_run else "Демо восстановлено.",
        f"Версия демо-данных: {report.from_version} → {report.to_version}",
    ]

    def block(title: str, counts: dict[str, int]) -> None:
        lines.append(f"{title}: {sum(counts.values())}")
        lines.extend(f"  {path}: {n}" for path, n in sorted(counts.items()))

    block("Мусор демо-аккаунтов", {p: len(k) for p, k in report.junk.items()})
    block("Вместе с мусором (привязанные записи)", {p: len(k) for p, k in report.cascade.items()})
    if report.people_records:
        block("  из них записи настоящих людей", report.people_records)
        lines.extend(f"    {line}" for line in report.people_details)
    block("Устаревшие записи прошлых сидов", report.stale_seed)
    block("Записи сидов возвращены к исходному виду", report.restored)
    block("Удалённые записи сидов созданы заново", report.returned)
    if report.kept_money_refs:
        lines.append(f"Оставлено ради записей об оплате: {report.kept_money_refs}")
    titles = {"events": "События", "organizations": "Организации", "sports": "Направления"}
    for path, title in titles.items():
        names = report.names.get(path) or []
        if names:
            lines.append(f"{title} к удалению:" if report.dry_run else f"{title} удалены:")
            lines.extend(f"  {n['id']}  «{n['name']}»" for n in names)
    if report.changes:
        lines.append("Состояния сидов:")
        lines.extend(f"  {line}" for line in report.changes)
    if not report.dry_run:
        lines.append(
            f"Снимок удалённого: {report.backup or 'не сохранялся (DOMAIN_BACKUP_DIR пуст или нечего)'}"
        )
    return "\n".join(lines)


def report_json(report: RestoreReport) -> str:
    return json.dumps(report.as_dict(), ensure_ascii=False, indent=2)
