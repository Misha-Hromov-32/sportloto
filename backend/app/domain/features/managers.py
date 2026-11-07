"""С14 «Расширенный кабинет клуба».

Владелец страницы организации добавляет соуправляющих по почте зарегистрированного человека.
Соуправляющий публикует встречи от имени клуба и рассматривает заявки (права проверяет
domain.is_organizer), но не меняет сведения организации и не управляет списком управляющих.
Здесь же выгрузка участников события в CSV и закреплённое объявление организатора в обсуждении.
"""

import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.kit import commit, db, get_event, notify, require_user
from app.domain.features.participation_host import input_text
from app.domain.lib.dates import moment
from app.domain.lib.labels import PARTICIPATION_STATUS
from app.domain.routing import Route, route
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

MAX_MANAGERS = 5
EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_QUOTES = re.compile(r"[«»]")


def engagement() -> store.Namespace:
    """Общее хранилище С8, С14, С15 и ссылок близким (`db.engagement`): все его списки есть всегда."""
    return db().engagement


def manager_ids_of(org_id: ID) -> list[ID]:
    return [m["userId"] for m in db().engagement.managers if m["orgId"] == org_id]


def managed_org_ids(user_id: ID) -> list[ID]:
    return [m["orgId"] for m in db().engagement.managers if m["userId"] == user_id]


def is_manager(org_id: ID, user_id: ID | None) -> bool:
    return bool(user_id) and user_id in manager_ids_of(org_id)


def _get_org(id_: ID) -> Entity:
    found = next((o for o in db().organizations if o["id"] == id_), None)
    return found if found is not None else fail("not_found", "Организация не найдена")


def managers_view(d: "Domain", actor: Actor, org_id: ID) -> Entity:
    user = require_user(actor)
    org = _get_org(org_id)
    owner = d.user(org["ownerId"])
    is_owner = org["ownerId"] == user["id"]
    if not is_owner and not is_manager(org["id"], user["id"]) and user["role"] != "admin":
        fail("forbidden", "Список управляющих видят владелец страницы и управляющие клуба")

    def manager(m: Entity) -> Entity:
        u = d.user(m["userId"])
        return {**d.person(u), "email": (u or {}).get("email") or "", "at": m["at"]}

    return {
        "orgId": org["id"],
        "canEdit": is_owner and org["status"] == "approved",
        "owner": {**d.person(owner), "email": (owner or {}).get("email") or ""},
        "managers": [
            manager(m)
            for m in sorted(
                (m for m in engagement().managers if m["orgId"] == org["id"]), key=lambda m: m["at"]
            )
        ],
    }


def _require_owner(actor: Actor, org: Entity) -> Entity:
    user = require_user(actor)
    if org["ownerId"] != user["id"]:
        fail("forbidden", "Добавлять и убирать управляющих может только владелец страницы организации")
    return user


def add_manager(d: "Domain", actor: Actor, org_id: ID, input_: dict[str, Any]) -> Entity:
    org = _get_org(org_id)
    owner = _require_owner(actor, org)
    if org["status"] != "approved":
        fail(
            "org_not_approved",
            "Управляющих можно добавить после того, как администратор допустит организацию",
        )
    email = input_text(input_.get("email")).strip().lower()
    if not EMAIL_RE.fullmatch(email):
        fail("validation", "Проверьте почту", {"email": "Напишите почту целиком, например ivan@mail.ru"})
    person = next((u for u in db().users if u["email"].lower() == email), None)
    if person is None:
        fail(
            "not_found",
            "Человека с такой почтой на платформе нет",
            {"email": "Такой почты нет. Попросите человека сначала зарегистрироваться"},
        )
    if person["id"] == owner["id"]:
        fail("validation", "Вы уже владелец этой страницы", {"email": "Это ваша почта"})
    if person["role"] == "admin":
        fail("validation", "Администратора нельзя сделать управляющим", {"email": "Это почта администратора"})
    lst = engagement().managers
    if any(m["orgId"] == org["id"] and m["userId"] == person["id"] for m in lst):
        fail("duplicate", f"{person['name']} уже управляющий", {"email": "Этот человек уже в списке"})
    if sum(1 for m in lst if m["orgId"] == org["id"]) >= MAX_MANAGERS:
        fail("validation", f"Управляющих может быть не больше {MAX_MANAGERS}")

    lst.append(
        {"orgId": org["id"], "userId": person["id"], "addedBy": owner["id"], "at": clock.iso(clock.now())}
    )
    notify(
        d,
        [person["id"]],
        "manager_added",
        f"Вы управляющий «{_QUOTES.sub('', org['name'])}»",
        f"{owner['name']} добавил(а) вас в управляющие. Теперь вы можете публиковать встречи от имени клуба и рассматривать заявки.",
        f"/org/{org['id']}",
    )
    commit(["organizations", "users", "events", "notifications"], [org["id"]])
    return managers_view(d, owner, org["id"])


def remove_manager(d: "Domain", actor: Actor, org_id: ID, user_id: ID) -> Entity:
    """Владелец убирает управляющего; управляющий может выйти сам. Владельца убрать нельзя."""
    user = require_user(actor)
    org = _get_org(org_id)
    if user_id == org["ownerId"]:
        fail("forbidden", "Владельца страницы убрать нельзя")
    self_ = user_id == user["id"]
    if not self_:
        _require_owner(user, org)
    s = engagement()
    entry = next((m for m in s.managers if m["orgId"] == org["id"] and m["userId"] == user_id), None)
    if entry is None:
        fail("not_found", "Этого человека уже нет среди управляющих")
    s.managers = [m for m in s.managers if m is not entry]
    if not self_:
        notify(
            d,
            [user_id],
            "manager_removed",
            f"Вы больше не управляющий «{_QUOTES.sub('', org['name'])}»",
            "Публиковать встречи от имени клуба и рассматривать его заявки теперь нельзя. Ваши записи на встречи остались.",
            f"/orgs/{org['id']}",
        )
    commit(["organizations", "users", "events", "notifications"], [org["id"]])
    return {"ok": True} if self_ else managers_view(d, user, org["id"])


# ---------- Выгрузка участников ----------

EXPORT_ORDER = ["confirmed", "pending", "waitlist"]

_FORMULA = re.compile(r"^[=+\-@]")
_NEEDS_QUOTES = re.compile(r'[";\n]')
_NOT_SLUG = re.compile(r"[^a-zа-яё0-9]+")


def _csv_cell(value: str) -> str:
    # Ячейка, начатая с «=», «+», «-» или «@», в таблице превратилась бы в формулу
    safe = f"'{value}" if _FORMULA.search(value) else value
    return '"' + safe.replace('"', '""') + '"' if _NEEDS_QUOTES.search(safe) else safe


def _file_slug(title: str) -> str:
    return _NOT_SLUG.sub("-", title.lower()).strip("-")[:40] or "sobytie"


def export_participants(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    """Список для организатора: имя, статус, дата записи, отметки.

    Только то, что организатор и так видит в управлении, без телефонов и почты участников.
    """
    user = require_user(actor)
    e = get_event(event_id)
    if not d.is_organizer(user, e):
        fail("forbidden", "Скачать список участников может только организатор события")
    first_visits = {f["userId"] for f in db().first_visits if f["eventId"] == e["id"]}
    changes = [(clock.parse(c["at"]), c["acknowledgedBy"]) for c in e["changes"]]

    def row(p: Entity) -> list[str]:
        marks: list[str] = []
        if p["userId"] in first_visits:
            marks.append("впервые")
        if p.get("needsEscort"):
            marks.append("нужно сопровождение")
        if p.get("source") == "invite":
            marks.append("по приглашению")
        if p.get("source") == "gathered":
            marks.append("из «Ищу компанию»")
        if p.get("note"):
            marks.append(f"сообщение: {p['note']}")
        joined_at = clock.parse(p["createdAt"])
        unacked = any(
            at is not None and joined_at is not None and at > joined_at and p["userId"] not in acknowledged
            for at, acknowledged in changes
        )
        if p["status"] == "confirmed" and unacked:
            marks.append("не подтвердил(а) изменения")
        return [
            (d.user(p["userId"]) or {}).get("name") or "Удалённый пользователь",
            PARTICIPATION_STATUS[p["status"]]["label"],
            f"{moment(p['createdAt']):%d.%m.%Y %H:%M}",
            ", ".join(marks),
        ]

    rows = [
        row(p)
        for p in sorted(
            (p for p in db().participations if p["eventId"] == e["id"] and p["status"] in EXPORT_ORDER),
            key=lambda p: (EXPORT_ORDER.index(p["status"]), p["createdAt"]),
        )
    ]
    lines = [";".join(_csv_cell(c) for c in r) for r in [["Имя", "Статус", "Дата записи", "Отметки"], *rows]]
    return {
        "filename": f"uchastniki-{_file_slug(e['title'])}-{moment(e['startsAt']):%Y-%m-%d}.csv",
        # Метка BOM нужна, чтобы таблица открыла русские буквы без настройки кодировки
        "csv": "\ufeff" + "\r\n".join(lines) + "\r\n",
        "rows": len(rows),
    }


# ---------- Закреплённое объявление ----------


def _get_message(id_: ID) -> Entity:
    found = next((m for m in db().messages if m["id"] == id_), None)
    return found if found is not None else fail("not_found", "Сообщение не найдено")


def pin_message(d: "Domain", actor: Actor, message_id: ID, on: bool) -> Entity:
    """Организатор закрепляет своё сообщение сверху обсуждения. Закреплённым может быть одно."""
    user = require_user(actor)
    m = _get_message(message_id)
    e = get_event(m["eventId"])
    if not d.is_organizer(user, e):
        fail("forbidden", "Закрепить сообщение может только организатор события")
    if m["authorId"] != user["id"]:
        fail("forbidden", "Закрепить можно только своё сообщение")
    if on:
        if m["status"] != "visible" or m.get("system"):
            fail("message_unavailable", "Это сообщение нельзя закрепить")
        state = d.event_state(e)
        if state not in {"upcoming", "live"}:
            fail("discussion_closed", "Обсуждение закрыто: событие больше не активно")
        for other in db().messages:
            if other["eventId"] == e["id"] and other.get("pinnedAt"):
                other["pinnedAt"] = None
        m["pinnedAt"] = clock.iso(clock.now())
    else:
        m["pinnedAt"] = None
    commit(["messages"], [m["id"]])
    return d.message_view(user, m)


# ---------- Маршруты ----------


def managers_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/organizations/([^/]+)/managers$", lambda p, _b, _q: managers_view(d, actor(), p[0])),
        route(
            "post", r"^/organizations/([^/]+)/managers$", lambda p, b, _q: add_manager(d, actor(), p[0], b)
        ),
        route(
            "delete",
            r"^/organizations/([^/]+)/managers/([^/]+)$",
            lambda p, _b, _q: remove_manager(d, actor(), p[0], p[1]),
        ),
        route(
            "get",
            r"^/events/([^/]+)/participants-export$",
            lambda p, _b, _q: export_participants(d, actor(), p[0]),
        ),
        route("put", r"^/messages/([^/]+)/pin$", lambda p, _b, _q: pin_message(d, actor(), p[0], True)),
        route("delete", r"^/messages/([^/]+)/pin$", lambda p, _b, _q: pin_message(d, actor(), p[0], False)),
    ]
