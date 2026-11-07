"""D-16 «Стоп-лист организатора».

Личный организатор и клуб (владелец и соуправляющие) ведут список людей, которых не пускают на свои
встречи. Запрет действует на все пути записи через одну проверку `stop_block` в `can_join`; срок
истекает при обращении к данным, без таймера. Здесь же «Убрать из участников» одной встречи
(статус `removed`) и контроль администратора.
"""

# Вид участника отдаёт закрытый метод доменного слоя.
# ruff: noqa: SLF001

import re
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features import managers, payments, reports
from app.domain.features.kit import commit, date_token, db, get_event, notify, require_user
from app.domain.features.participation_host import input_text
from app.domain.lib.dates import format_day_month
from app.domain.lib.plural import plural
from app.domain.routing import Route, route
from app.domain.statuses import ACTIVE_PARTICIPATION, ParticipationStatus
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

STOP_REASON = {
    "no_show": "Не приходит без предупреждения",
    "rude": "Грубое поведение",
    "rules": "Нарушает правила встречи",
    "other": "Другое",
}

TERM_DAYS: dict[str, int | None] = {"forever": None, "month": 30, "three_months": 90}
# Сколько истёкшие и снятые записи ещё видны в списке и за какой срок считается сигнал.
KEEP = timedelta(days=30)
SIGNAL_OWNERS = 3
OPEN_STATES = ("upcoming", "live")
MIN_REASON = 5
MAX_REASON = 200
MAX_NOTE = 300

_SPACES = re.compile(r"\s+")
_SENTENCE_END = re.compile(r"[.!?…]$")


def owner_key_of(e: Entity) -> str:
    return f"{e['organizer']['kind']}:{e['organizer']['id']}"


def _entries() -> list[Entity]:
    return db().stop_list


def _clean(value: Any, max_: int) -> str:
    return _SPACES.sub(" ", input_text(value)).strip()[:max_]


def _sentence(text: str) -> str:
    return text if _SENTENCE_END.search(text) else f"{text}."


def _not_before(iso: str | None, since: datetime) -> bool:
    """Дата записи не раньше `since`; неразборчивая дата считается давней."""
    at = clock.parse(iso)
    return at is not None and at >= since


def stop_state(s: Entity, now: datetime) -> str:
    if s.get("liftedAt"):
        return "lifted"
    until = clock.parse(s.get("until"))
    if until is not None and until <= now:
        return "expired"
    return "active"


def reason_label(s: Entity) -> str:
    return s["reasonText"] if s["reasonCode"] == "other" else STOP_REASON[s["reasonCode"]]


def active_stop(data: store.Database, user_id: ID, e: Entity, now: datetime) -> Entity | None:
    """Действующая запись стоп-листа организатора встречи о человеке."""
    organizer = e["organizer"]
    return next(
        (
            s
            for s in data.stop_list
            if s["ownerKind"] == organizer["kind"]
            and s["ownerId"] == organizer["id"]
            and s["userId"] == user_id
            and stop_state(s, now) == "active"
        ),
        None,
    )


def is_stop_listed(data: store.Database, user_id: ID, e: Entity, now: datetime) -> bool:
    return active_stop(data, user_id, e, now) is not None


def stop_block(
    data: store.Database, actor: Entity, e: Entity, mine: Entity | None, now: datetime
) -> dict[str, str] | None:
    """Проверка в `can_join`: убран из участников этой встречи или в стоп-листе её организатора."""
    if mine is not None and mine["status"] == ParticipationStatus.REMOVED:
        reason = mine.get("removedReason") or ""
        return {
            "code": "removed_before",
            "reason": f"Организатор убрал вас из участников этой встречи{f'. Причина: {_sentence(reason)}' if reason else ''}",
        }
    s = active_stop(data, actor["id"], e, now)
    if s is None:
        return None
    until = f" До {format_day_month(s['until'])}." if s.get("until") else ""
    return {
        "code": "organizer_blocked",
        "reason": f"Организатор ограничил вашу запись на свои встречи. Причина: {_sentence(reason_label(s))}{until}",
    }


def stop_ask_block(data: store.Database, actor: Entity, e: Entity, now: datetime) -> str | None:
    """Обсуждение: человек из стоп-листа организатора читает, но не пишет."""
    if is_stop_listed(data, actor["id"], e, now):
        return "Организатор ограничил ваше участие в своих встречах, писать сюда нельзя"
    return None


# ---------- Владелец списка и права ----------


def _owner_of(kind: str, id_: ID) -> Entity:
    if kind == "user":
        u = next((x for x in db().users if x["id"] == id_), None)
        if u is None:
            fail("not_found", "Пользователь не найден")
        return {"kind": kind, "id": id_, "name": u["name"]}
    o = next((x for x in db().organizations if x["id"] == id_), None)
    if o is None:
        fail("not_found", "Организация не найдена")
    return {"kind": kind, "id": id_, "name": o["name"]}


def _parse_owner(value: Any) -> Entity:
    kind, _, id_ = input_text(value).partition(":")
    if kind not in ("user", "org") or not id_:
        fail("bad_request", "Не указано, чей это стоп-лист")
    return _owner_of(kind, id_)


def _team_of(owner: Entity) -> list[ID]:
    """Кто в команде владельца списка: сам организатор или владелец и соуправляющие клуба."""
    if owner["kind"] == "user":
        return [owner["id"]]
    o = next((x for x in db().organizations if x["id"] == owner["id"]), None)
    return [o["ownerId"], *managers.manager_ids_of(o["id"])] if o is not None else []


def _can_edit(actor: Actor, owner: Entity) -> bool:
    return actor is not None and actor["id"] in _team_of(owner)


def _require_editor(actor: Actor, owner: Entity) -> Entity:
    user = require_user(actor)
    if not _can_edit(user, owner):
        fail("forbidden", "Стоп-лист ведёт организатор")
    return user


def _owner_link(owner: Entity) -> str:
    return f"/orgs/{owner['id']}" if owner["kind"] == "org" else f"/profile/{owner['id']}"


def _list_link(owner: Entity) -> str:
    return f"/org/{owner['id']}" if owner["kind"] == "org" else "/me/stop-list"


def _is_owners_event(e: Entity | None, owner: Entity) -> bool:
    return e is not None and e["organizer"]["kind"] == owner["kind"] and e["organizer"]["id"] == owner["id"]


def _blocked_reason(actor: Entity, owner: Entity, target: Entity) -> str | None:
    """Почему человека нельзя добавить: себя, команду клуба, администратора и незнакомых."""
    if target["id"] == actor["id"] or (owner["kind"] == "user" and target["id"] == owner["id"]):
        return "Себя добавить нельзя"
    if owner["kind"] == "org" and target["id"] in _team_of(owner):
        return "Это человек из команды клуба"
    if target["role"] == "admin":
        return "Администратора добавить нельзя"
    data = db()
    relevant = {p["eventId"] for p in data.participations if p["userId"] == target["id"]}
    relevant.update(m["eventId"] for m in data.messages if m.get("authorId") == target["id"] and not m["system"])
    events = {id_: data.record("events", id_) for id_ in relevant}
    linked = any(
        p["userId"] == target["id"] and _is_owners_event(events.get(p["eventId"]), owner)
        for p in data.participations
    ) or any(
        m.get("authorId") == target["id"]
        and not m["system"]
        and _is_owners_event(events.get(m["eventId"]), owner)
        for m in data.messages
    )
    if linked:
        return None
    return "Добавить можно только того, кто записывался на ваши встречи или писал в их обсуждении"


def _get_target(id_: Any) -> Entity:
    found = next((u for u in db().users if u["id"] == input_text(id_)), None)
    return found if found is not None else fail("not_found", "Пользователь не найден")


# ---------- Вид ----------


def _entry_view(d: "Domain", s: Entity, see_note: bool) -> Entity:
    data = db()

    def u(id_: ID | None) -> Entity | None:
        return next((x for x in data.users if x["id"] == id_), None) if id_ else None

    if s["ownerKind"] == "org":
        org = next((o for o in data.organizations if o["id"] == s["ownerId"]), None)
        owner_name = org["name"] if org is not None else None
    else:
        owner_user = u(s["ownerId"])
        owner_name = owner_user["name"] if owner_user is not None else None
    return {
        "id": s["id"],
        "owner": {"kind": s["ownerKind"], "id": s["ownerId"], "name": owner_name or ""},
        "user": d.person(u(s["userId"])),
        "reasonCode": s["reasonCode"],
        "reasonLabel": reason_label(s),
        "reasonText": s["reasonText"],
        "note": s["note"] if see_note else "",
        "until": s.get("until"),
        "state": stop_state(s, clock.now()),
        "addedBy": d.person(u(s["addedBy"])),
        "createdAt": s["createdAt"],
        "liftedAt": s.get("liftedAt"),
        "liftedBy": d.person(u(s["liftedBy"])) if s.get("liftedBy") else None,
        "liftedReason": s.get("liftedReason") or "",
    }


def _ended_at(s: Entity) -> str:
    """Когда запись перестала действовать: снята администратором или закончился срок."""
    return s.get("liftedAt") or s.get("until") or s["updatedAt"]


def _ordered(items: list[Entity], now: datetime) -> list[Entity]:
    """Сначала действующие (новые сверху), потом истёкшие и снятые (недавние сверху)."""
    active = sorted(
        (s for s in items if stop_state(s, now) == "active"), key=lambda s: s["createdAt"], reverse=True
    )
    ended = sorted((s for s in items if stop_state(s, now) != "active"), key=_ended_at, reverse=True)
    return [*active, *ended]


def _list_view(d: "Domain", actor: Entity, owner: Entity) -> Entity:
    now = clock.now()
    edit = _can_edit(actor, owner)
    own = [
        s
        for s in _entries()
        if s["ownerKind"] == owner["kind"]
        and s["ownerId"] == owner["id"]
        and (stop_state(s, now) == "active" or _not_before(_ended_at(s), now - KEEP))
    ]
    return {
        "owner": {"kind": owner["kind"], "id": owner["id"], "name": owner["name"]},
        "entries": [_entry_view(d, s, edit) for s in _ordered(own, now)],
        "canEdit": edit,
    }


def stop_list_view(d: "Domain", actor: Actor, owner_key: Any) -> Entity:
    user = require_user(actor)
    owner = _parse_owner(owner_key)
    if not _can_edit(user, owner) and user["role"] != "admin":
        fail("forbidden", "Стоп-лист ведёт организатор")
    return _list_view(d, user, owner)


def _upcoming_of(d: "Domain", owner: Entity, user_id: ID) -> list[tuple[Entity, Entity]]:
    """Записи человека на предстоящие встречи организатора, которые отменятся вместе с добавлением."""
    data = db()
    found = [
        (p, data.record("events", p["eventId"]))
        for p in data.participations
        if p["userId"] == user_id and p["status"] in ACTIVE_PARTICIPATION
    ]
    rows = [
        (p, e)
        for p, e in found
        if e is not None and _is_owners_event(e, owner) and d.event_state(e) in OPEN_STATES
    ]
    return sorted(rows, key=lambda x: x[1]["startsAt"])


def stop_preview(d: "Domain", actor: Actor, owner_key: Any, user_id: Any) -> Entity:
    owner = _parse_owner(owner_key)
    user = _require_editor(actor, owner)
    target = _get_target(user_id)
    existing = next(
        (
            s
            for s in _entries()
            if s["ownerKind"] == owner["kind"] and s["ownerId"] == owner["id"] and s["userId"] == target["id"]
        ),
        None,
    )
    return {
        "user": d.person(target),
        "upcoming": [
            {"eventId": e["id"], "title": e["title"], "startsAt": e["startsAt"], "status": p["status"]}
            for p, e in _upcoming_of(d, owner, target["id"])
        ],
        "existing": _entry_view(d, existing, True) if existing is not None else None,
        "blockedReason": _blocked_reason(user, owner, target),
    }


# ---------- Убрать из участников ----------


def _remove_participation(d: "Domain", e: Entity, p: Entity, reason: str) -> None:
    """Запись становится `removed`: место освобождается, как при уходе, и лист ожидания продвигается."""
    host = d.participation_host
    now = clock.now()
    before = host.confirmed_count(e)
    was_confirmed = p["status"] == ParticipationStatus.CONFIRMED
    # С4: придержанное место (как has_active_offer; модуль резерва сам проверяет стоп-лист)
    offer = p.get("offer")
    until = clock.parse(offer.get("until")) if offer else None
    had_offer = p["status"] == ParticipationStatus.WAITLIST and until is not None and until > now
    p["status"] = ParticipationStatus.REMOVED
    p["removedReason"] = reason
    p["decidedAt"] = clock.iso(now)
    p["offer"] = None
    payments.on_removed(d, e, p)  # оплата на сайте: полный возврат
    if was_confirmed or had_offer:
        host.promote_waitlist(e)
    host.after_count_change(e, before)


# ---------- Добавление ----------


def _clean_stop(input_: dict[str, Any]) -> Entity:
    reason_code = input_text(input_.get("reasonCode"))
    if reason_code not in STOP_REASON:
        fail("validation", "Выберите, почему не пускаете", {"reasonCode": "Выберите причину"})
    reason_text = ""
    if reason_code == "other":
        raw = _SPACES.sub(" ", input_text(input_.get("reasonText"))).strip()
        if len(raw) < MIN_REASON or len(raw) > MAX_REASON:
            fail(
                "validation",
                "Напишите причину, хотя бы несколько слов",
                {"reasonText": "Напишите причину, хотя бы несколько слов"},
            )
        reason_text = raw
    term = input_text(input_.get("term"))
    if term not in TERM_DAYS:
        fail("validation", "Выберите срок", {"term": "Выберите срок"})
    return {
        "reasonCode": reason_code,
        "reasonText": reason_text,
        "note": _clean(input_.get("note"), MAX_NOTE),
        "term": term,
        "cancelUpcoming": bool(input_.get("cancelUpcoming")),
    }


def _meetings(n: int) -> str:
    """«Записи на 3 встречи отменены»: винительный падеж."""
    return f"{n} {plural(n, ('встречу', 'встречи', 'встреч'))}"


def _apply_stop(d: "Domain", actor: Entity, owner: Entity, target: Entity, plan: Entity) -> Entity:
    """Добавить или обновить запись; проверки прав и «кого можно» уже пройдены."""
    now = clock.now()
    at = clock.iso(now)
    days = TERM_DAYS[plan["term"]]
    until = None if days is None else clock.iso(now + timedelta(days=days))
    items = _entries()
    s = next(
        (
            x
            for x in items
            if x["ownerKind"] == owner["kind"] and x["ownerId"] == owner["id"] and x["userId"] == target["id"]
        ),
        None,
    )
    repeat = s is not None
    fields = {
        "reasonCode": plan["reasonCode"],
        "reasonText": plan["reasonText"],
        "note": plan["note"],
        "until": until,
        "addedBy": actor["id"],
        "updatedAt": at,
        "liftedAt": None,
        "liftedBy": None,
        "liftedReason": "",
    }
    if s is not None:
        s.update(fields)
    else:
        s = {
            "id": d.participation_host.next_id("stop"),
            "ownerKind": owner["kind"],
            "ownerId": owner["id"],
            "userId": target["id"],
            "createdAt": at,
            **fields,
        }
        items.append(s)

    cancelled = 0
    touched: list[ID] = []
    if plan["cancelUpcoming"]:
        label = reason_label(s)
        for p, e in _upcoming_of(d, owner, target["id"]):
            _remove_participation(d, e, p, label)
            cancelled += 1
            touched.append(e["id"])
    until_text = f" до {date_token(until)}" if until else ""
    cancelled_text = f" Записи на {_meetings(cancelled)} отменены." if cancelled else ""
    notify(
        d,
        [target["id"]],
        "stop_listed",
        "Организатор ограничил вашу запись",
        f"{owner['name']} больше не принимает вашу запись на свои встречи{until_text}. "
        f"Причина: {_sentence(reason_label(s))}{cancelled_text} "
        "Если это ошибка, напишите администратору через «Пожаловаться».",
        _owner_link(owner),
    )
    reports.audit_log(
        d,
        actor,
        "stop.update" if repeat else "stop.add",
        "user",
        target["id"],
        f"{target['name']} — {owner['name']}",
        STOP_REASON[s["reasonCode"]],
    )
    commit(["stopList", "events", "participations", "notifications", "audit", "messages"], touched)
    return {"entry": _entry_view(d, s, True), "cancelled": cancelled}


def add_stop(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    owner = _parse_owner(input_.get("owner"))
    user = _require_editor(actor, owner)
    target = _get_target(input_.get("userId"))
    blocked = _blocked_reason(user, owner, target)
    if blocked:
        fail("cannot_block", blocked)
    return _apply_stop(d, user, owner, target, _clean_stop(input_))


def remove_stop(d: "Domain", actor: Actor, entry_id: ID) -> Entity:
    items = _entries()
    s = next((x for x in items if x["id"] == entry_id), None)
    if s is None:
        fail("not_found", "Запись стоп-листа не найдена")
    owner = _owner_of(s["ownerKind"], s["ownerId"])
    user = _require_editor(actor, owner)
    target = next((u for u in db().users if u["id"] == s["userId"]), None)
    was_active = stop_state(s, clock.now()) == "active"
    items.remove(s)
    if was_active:
        notify(
            d,
            [s["userId"]],
            "stop_lifted",
            "Организатор снова принимает вашу запись",
            f"{owner['name']} снова принимает вашу запись на свои встречи.",
            _owner_link(owner),
        )
    name = target["name"] if target is not None else "Удалённый пользователь"
    reports.audit_log(
        d, user, "stop.remove", "user", s["userId"], f"{name} — {owner['name']}", STOP_REASON[s["reasonCode"]]
    )
    commit(["stopList", "events", "notifications", "audit"])
    return _list_view(d, user, owner)


# ---------- Убрать из участников одной встречи ----------


def remove_participant(d: "Domain", actor: Actor, participation_id: ID, input_: dict[str, Any]) -> Entity:
    user = require_user(actor)
    p = next((x for x in db().participations if x["id"] == participation_id), None)
    if p is None:
        fail("not_found", "Запись не найдена")
    e = get_event(p["eventId"])
    if not d.is_organizer(user, e):
        fail("forbidden", "Убрать из участников может только организатор встречи")
    if p["status"] == ParticipationStatus.REMOVED:
        return d._participant_view(p, e)
    if d.event_state(e) not in OPEN_STATES:
        fail("event_inactive", "Событие больше не активно")
    if p["status"] not in ACTIVE_PARTICIPATION:
        fail("bad_state", "Этот человек уже не в списке")
    target = _get_target(p["userId"])
    raw_stop = input_.get("stop")
    # Сначала все проверки стоп-листа: при ошибке запись не должна измениться
    owner = _owner_of(e["organizer"]["kind"], e["organizer"]["id"])
    plan: Entity | None = None
    if isinstance(raw_stop, dict):
        _require_editor(user, owner)
        blocked = _blocked_reason(user, owner, target)
        if blocked:
            fail("cannot_block", blocked)
        plan = _clean_stop(raw_stop)
    reason = _clean(input_.get("reason"), MAX_NOTE)
    _remove_participation(d, e, p, reason)
    notify(
        d,
        [p["userId"]],
        "removed_from_event",
        "Организатор убрал вас из участников",
        f"Организатор убрал вас из участников «{e['title']}»{f': {reason}' if reason else '.'}",
        f"/events/{e['id']}",
    )
    reports.audit_log(d, user, "participation.remove", "participation", p["id"], e["title"], reason)
    if plan is not None:
        _apply_stop(d, user, owner, target, plan)
    commit(["events", "participations", "notifications", "audit", "messages"], [e["id"]])
    return d._participant_view(p, e)


# ---------- Администратор ----------


def _recent_owner_keys(items: list[Entity], now: datetime) -> set[str]:
    """Разные организаторы, добавившие человека за последние 30 дней (снятые администратором не считаются)."""
    return {
        f"{s['ownerKind']}:{s['ownerId']}"
        for s in items
        if not s.get("liftedAt") and _not_before(s["updatedAt"], now - KEEP)
    }


def admin_stop_summary(d: "Domain", actor: Actor, q: dict[str, Any]) -> Entity:
    reports.require_admin(actor)
    now = clock.now()
    org_id = input_text(q.get("orgId"))
    user_id = input_text(q.get("userId"))
    if not org_id and not user_id:
        fail("bad_request", "Укажите организацию или пользователя")
    items = [
        s
        for s in _entries()
        if (s["ownerKind"] == "org" and s["ownerId"] == org_id if org_id else s["userId"] == user_id)
    ]
    return {
        "entries": [_entry_view(d, s, False) for s in _ordered(items, now)],
        "recentOwners": 0 if org_id else len(_recent_owner_keys(items, now)),
    }


def lift_stop(d: "Domain", actor: Actor, entry_id: ID, input_: dict[str, Any]) -> Entity:
    admin = reports.require_admin(actor)
    s = next((x for x in _entries() if x["id"] == entry_id), None)
    if s is None:
        fail("not_found", "Запись стоп-листа не найдена")
    if s.get("liftedAt"):
        return _entry_view(d, s, False)
    reason = _clean(input_.get("reason"), 600)
    if len(reason) < MIN_REASON:
        fail(
            "reason_required",
            "Укажите причину. Её увидит организатор",
            {"reason": "Напишите, почему снимаете запрет"},
        )
    at = clock.iso(clock.now())
    s["liftedAt"] = at
    s["liftedBy"] = admin["id"]
    s["liftedReason"] = reason
    s["updatedAt"] = at
    owner = _owner_of(s["ownerKind"], s["ownerId"])
    target = next((u for u in db().users if u["id"] == s["userId"]), None)
    name = target["name"] if target is not None else "Удалённый пользователь"
    notify(
        d,
        _team_of(owner),
        "stop_lifted",
        "Администратор снял запрет",
        f"Администратор снял запрет для {name}: {_sentence(reason)}",
        _list_link(owner),
    )
    notify(
        d,
        [s["userId"]],
        "stop_lifted",
        "Запрет снят",
        f"Вы снова можете записываться на встречи {owner['name']}.",
        _owner_link(owner),
    )
    reports.audit_log(d, admin, "stop.lift", "user", s["userId"], f"{name} — {owner['name']}", reason)
    commit(["stopList", "events", "notifications", "audit", "admin"])
    return _entry_view(d, s, False)


def stop_signals(d: "Domain", actor: Actor) -> list[Entity]:
    reports.require_admin(actor)
    now = clock.now()
    by_user: dict[ID, list[Entity]] = {}
    for s in _entries():
        if s.get("liftedAt") or not _not_before(s["updatedAt"], now - KEEP):
            continue
        by_user.setdefault(s["userId"], []).append(s)
    signals: list[Entity] = []
    for user_id, items in by_user.items():
        owners = len(_recent_owner_keys(items, now))
        if owners < SIGNAL_OWNERS:
            continue
        signals.append(
            {
                "user": d.person(next((u for u in db().users if u["id"] == user_id), None)),
                "owners": owners,
                "lastAt": max(s["updatedAt"] for s in items),
            }
        )
    # Порядок: больше организаторов, затем недавние; при равенстве — как в списке (сортировка устойчива).
    signals.sort(key=lambda x: x["lastAt"], reverse=True)
    signals.sort(key=lambda x: x["owners"], reverse=True)
    return signals


# ---------- Демо-данные ----------


def seed_stop_list(data: dict[str, Any]) -> list[Entity]:
    """Демо: два человека в стоп-листе «Ладьи», Ирина Жукова — у трёх организаторов (сигнал), снятая запись.

    У «Ладьи» — Игорь Ким (бессрочно, от Ольги) и Ирина Жукова (на месяц, от соуправляющей Ксении), у Дмитрия —
    Людмила Фёдоровна, убранная с волейбола на Взлётке. Ирина ещё в списках Елены Воронцовой и Алины Ершовой.
    У «Дворовых легенд» — запись, снятая администратором.
    """
    ago: Callable[[float], str] = data["ago"]
    now: datetime = data["now"]
    participations: list[Entity] = data["participations"]
    notifications: list[Entity] = data["notifications"]
    day = 24 * 60

    def entry(
        id_: str,
        owner_kind: str,
        owner_id: ID,
        user_id: ID,
        added_by: ID,
        days_ago: int,
        reason_code: str,
        **patch: Any,
    ) -> Entity:
        return {
            "id": id_,
            "ownerKind": owner_kind,
            "ownerId": owner_id,
            "userId": user_id,
            "reasonCode": reason_code,
            "reasonText": "",
            "note": "",
            "until": None,
            "addedBy": added_by,
            "createdAt": ago(days_ago * day),
            "updatedAt": ago(days_ago * day),
            "liftedAt": None,
            "liftedBy": None,
            "liftedReason": "",
            **patch,
        }

    def until_after(days_ago: int, days: int) -> str:
        return clock.iso(now - timedelta(days=days_ago) + timedelta(days=days))

    # Игорь записывался на турнир «Ладьи» и не пришёл
    participations.append(
        {
            "id": "p-stop-igor",
            "eventId": "e-past-chess",
            "userId": "u-igor",
            "status": "confirmed",
            "prevStatus": None,
            "note": "",
            "rejectReason": "",
            "source": "self",
            "createdAt": ago(9 * day),
            "decidedAt": ago(9 * day),
        }
    )
    # Людмила Фёдоровна была записана на волейбол Дмитрия — запись отменена вместе с добавлением
    other_text = "Каждый раз просит перенести встречу под себя и спорит с участниками"
    participations.append(
        {
            "id": "p-stop-lyudmila",
            "eventId": "e-volley-vzlet",
            "userId": "u-lyudmila",
            "status": "removed",
            "prevStatus": None,
            "note": "",
            "rejectReason": "",
            "source": "self",
            "createdAt": ago(4 * day),
            "decidedAt": ago(2 * day),
            "removedReason": other_text,
        }
    )

    notifications.extend(
        [
            {
                "id": "n-stop-igor",
                "userId": "u-igor",
                "type": "stop_listed",
                "title": "Организатор ограничил вашу запись",
                "text": "Шахматный клуб «Ладья» больше не принимает вашу запись на свои встречи. Причина: Не приходит без предупреждения. Если это ошибка, напишите администратору через «Пожаловаться».",
                "link": "/orgs/o-ladya",
                "read": False,
                "createdAt": ago(20 * day),
            },
            {
                "id": "n-stop-lyudmila",
                "userId": "u-lyudmila",
                "type": "stop_listed",
                "title": "Организатор ограничил вашу запись",
                "text": f"Дмитрий Орлов больше не принимает вашу запись на свои встречи. Причина: {other_text}. Записи на 1 встречу отменены. Если это ошибка, напишите администратору через «Пожаловаться».",
                "link": "/profile/u-dmitry",
                "read": False,
                "createdAt": ago(2 * day),
            },
        ]
    )

    return [
        entry(
            "stop-ladya-igor",
            "org",
            "o-ladya",
            "u-igor",
            "u-olga",
            20,
            "no_show",
            note="Записывался на три турнира подряд и ни разу не пришёл. Места пропадали, а в очереди ждали люди.",
        ),
        entry(
            "stop-ladya-irina",
            "org",
            "o-ladya",
            "u-irina",
            "u-ksenia",
            6,
            "rude",
            note="Резко отвечала родителям в обсуждении детского занятия.",
            until=until_after(6, 30),
        ),
        entry(
            "stop-dmitry-lyudmila",
            "user",
            "u-dmitry",
            "u-lyudmila",
            "u-dmitry",
            2,
            "other",
            reasonText=other_text,
        ),
        entry("stop-alina-irina", "user", "u-alina", "u-irina", "u-alina", 10, "rules"),
        entry(
            "stop-vorontsova-irina",
            "org",
            "o-vorontsova",
            "u-irina",
            "u-elena",
            15,
            "no_show",
            until=until_after(15, 90),
        ),
        entry(
            "stop-legends-konstantin",
            "org",
            "o-legends",
            "u-konstantin",
            "u-roman",
            12,
            "rules",
            note="Пришёл в шипованных бутсах на искусственное поле.",
            liftedAt=ago(2 * day),
            liftedBy="u-maria",
            liftedReason="Правила встречи не были написаны в карточке, участник не мог о них знать.",
            updatedAt=ago(2 * day),
        ),
    ]


# ---------- Маршруты ----------


def stop_list_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/stop-list$", lambda _p, _b, q: stop_list_view(d, actor(), q.get("owner"))),
        route(
            "get",
            r"^/stop-list/preview$",
            lambda _p, _b, q: stop_preview(d, actor(), q.get("owner"), q.get("userId")),
        ),
        route("post", r"^/stop-list$", lambda _p, b, _q: add_stop(d, actor(), b)),
        route("delete", r"^/stop-list/([^/]+)$", lambda p, _b, _q: remove_stop(d, actor(), p[0])),
        route(
            "post",
            r"^/participations/([^/]+)/remove$",
            lambda p, b, _q: remove_participant(d, actor(), p[0], b),
        ),
        route("get", r"^/admin/stop-list$", lambda _p, _b, q: admin_stop_summary(d, actor(), q)),
        route(
            "post",
            r"^/admin/stop-list/([^/]+)/lift$",
            lambda p, b, _q: lift_stop(d, actor(), p[0], b),
        ),
        route("get", r"^/admin/stop-signals$", lambda _p, _b, _q: stop_signals(d, actor())),
    ]
