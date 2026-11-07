"""С16 «Жалобы».

Вошедший человек жалуется на событие или сообщение обсуждения. Повторная жалоба
того же человека на тот же объект не создаёт новую запись. Администратор видит жалобы,
собранные по объекту, но не видит, кто именно пожаловался. Решение («Снять» или «Скрыть»,
либо «Отклонить жалобу») приходит уведомлением каждому, кто жаловался.
"""

import re
from collections import Counter
from collections.abc import Callable
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.kit import commit, db, get_event, notify, organizer_ids, require_user
from app.domain.lib.dates import moment
from app.domain.lib.text import normalize, truncate
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

REPORT_REASONS = ["spam", "fraud", "abuse", "danger", "other"]
REASON_TEXT: dict[str, str] = {
    "spam": "спам или реклама",
    "fraud": "мошенничество",
    "abuse": "оскорбления",
    "danger": "опасно для участников",
    "other": "другое",
}
MAX_COMMENT = 500
DAILY_LIMIT = 10

_SPACES = re.compile(r"\s+")


def _reports() -> list[Entity]:
    return db().reports


def _text(value: Any) -> str:
    """Строка из запроса; не строка — пустая."""
    return value if isinstance(value, str) else ""


def _name(record: Entity | None, default: str) -> str:
    name = record.get("name") if record is not None else None
    return default if name is None else name


def require_admin(actor: Actor) -> Entity:
    user = require_user(actor)
    if user["role"] != "admin":
        fail("forbidden", "Это может сделать только администратор")
    return user


def audit_log(
    d: "Domain",  # noqa: ARG001  время берётся из часов; параметр оставлен для вызывающих
    actor: Entity,
    action: str,
    target_type: str,
    target_id: ID,
    target_title: str,
    reason: str = "",
    rule_id: ID | None = None,
) -> None:
    """Запись в журнал действий администратора — тот же формат, что у остальных решений."""
    db().audit.insert(
        0,
        {
            "id": store.next_id("a"),
            "actorId": actor["id"],
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "targetTitle": target_title,
            "ruleId": rule_id,
            "reason": reason[:600],
            "at": clock.iso(clock.now()),
        },
    )


def _get_message(id_: ID) -> Entity:
    found = next((m for m in db().messages if m["id"] == id_), None)
    return found if found is not None else fail("not_found", "Сообщение не найдено")


def _resolve_target(type_: Any, id_: ID) -> tuple[Entity, Entity | None]:
    """Событие, на которое жалуются, и сообщение, если жалоба на сообщение."""
    if type_ == "event":
        return get_event(id_), None
    if type_ == "message":
        message = _get_message(id_)
        return get_event(message["eventId"]), message
    return fail("bad_request", "Пожаловаться можно на событие или сообщение")


def create_report(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:  # noqa: ARG001
    user = require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "Администратор решает сам, без жалоб")
    type_ = input_.get("targetType")
    target_id = _text(input_.get("targetId"))
    event, message = _resolve_target(type_, target_id)
    if input_.get("reason") not in REPORT_REASONS:
        fail("validation", "Выберите причину жалобы", {"reason": "Выберите причину"})
    comment = _SPACES.sub(" ", _text(input_.get("comment"))).strip()[:MAX_COMMENT]
    if input_["reason"] == "other" and len(comment) < 5:
        fail("validation", "Напишите, что не так: хотя бы несколько слов", {"comment": "Опишите, что не так"})

    if type_ == "event":
        if user["id"] in organizer_ids(event):
            fail("own_event", "На своё событие пожаловаться нельзя")
        if event["status"] == "deleted":
            fail("event_deleted", "Событие уже удалено")
    elif message is not None:
        if message["authorId"] == user["id"]:
            fail("bad_request", "На своё сообщение пожаловаться нельзя")
        if message.get("system") or message["status"] != "visible":
            fail("message_unavailable", "Это сообщение уже скрыто или удалено")

    existing = next(
        (
            r
            for r in _reports()
            if r["reporterId"] == user["id"] and r["targetType"] == type_ and r["targetId"] == target_id
        ),
        None,
    )
    if existing is not None:
        return {"report": existing, "duplicate": True}

    now = clock.now()
    day_ago = now - timedelta(days=1)
    if (
        sum(1 for r in _reports() if r["reporterId"] == user["id"] and moment(r["createdAt"]) >= day_ago)
        >= DAILY_LIMIT
    ):
        fail("rate_limit", "Вы отправили много жалоб за сутки. Администратор уже разбирает их")

    report = {
        "id": store.next_id("rp"),
        "targetType": type_,
        "targetId": target_id,
        "eventId": event["id"],
        "reporterId": user["id"],
        "reason": input_["reason"],
        "comment": comment,
        "status": "open",
        "createdAt": clock.iso(now),
        "decidedAt": None,
        "decidedBy": None,
    }
    _reports().append(report)
    commit(["reports", "admin"])
    return {"report": report, "duplicate": False}


def my_report(actor: Actor, type_: str, target_id: ID) -> Entity:
    if not actor:
        return {"reported": False, "status": None}
    r = next(
        (
            x
            for x in _reports()
            if x["reporterId"] == actor["id"] and x["targetType"] == type_ and x["targetId"] == target_id
        ),
        None,
    )
    return {"reported": r is not None, "status": r["status"] if r is not None else None}


def my_message_reports(actor: Actor, event_id: ID) -> list[ID]:
    """Мои жалобы на сообщения одного события — чтобы отметить их в обсуждении одним запросом."""
    if not actor:
        return []
    return [
        r["targetId"]
        for r in _reports()
        if r["reporterId"] == actor["id"] and r["targetType"] == "message" and r["eventId"] == event_id
    ]


def _target_state(type_: Any, event: Entity, message: Entity | None) -> tuple[str, bool]:
    """Состояние объекта и снят ли он уже."""
    if type_ == "event":
        return event["status"], event["status"] in {"removed", "deleted"}
    state = message.get("status") if message is not None else None
    if state is None:
        return "deleted", True
    return state, state != "visible"


def list_report_groups(d: "Domain", actor: Actor, q: dict[str, Any]) -> list[Entity]:
    require_admin(actor)
    status = q.get("status")
    wanted = ["upheld", "dismissed"] if status == "closed" else None if status == "all" else ["open"]
    groups: dict[str, list[Entity]] = {}
    for r in _reports():
        if wanted is not None and r["status"] not in wanted:
            continue
        if q.get("targetType") and r["targetType"] != q["targetType"]:
            continue
        if q.get("eventId") and r["eventId"] != q["eventId"]:
            continue
        key = f"{r['targetType']}:{r['targetId']}:{r['status'] if wanted is not None else 'any'}"
        groups.setdefault(key, []).append(r)
    out: list[Entity] = []
    for key, list_ in groups.items():
        first = list_[0]
        event = db().record("events", first["eventId"])
        if event is None:
            continue
        message = (
            next((m for m in db().messages if m["id"] == first["targetId"]), None)
            if first["targetType"] == "message"
            else None
        )
        organizers = organizer_ids(event)
        author_id = message["authorId"] if message is not None else (organizers[0] if organizers else None)
        author = d.user(author_id)
        counts = Counter(r["reason"] for r in list_)
        state, handled = _target_state(first["targetType"], event, message)
        sorted_ = sorted(list_, key=lambda r: moment(r["createdAt"]))
        if message is not None and message.get("asOrgId"):
            org = next((o for o in db().organizations if o["id"] == message["asOrgId"]), None)
            author_name = _name(org, _name(author, "Организатор"))
        elif event["organizer"]["kind"] == "org" and message is None:
            org = next((o for o in db().organizations if o["id"] == event["organizer"]["id"]), None)
            author_name = _name(org, "")
        else:
            author_name = _name(author, "Автор удалён")
        out.append(
            {
                "id": key,
                "targetType": first["targetType"],
                "targetId": first["targetId"],
                "eventId": event["id"],
                "eventTitle": event["title"],
                "preview": truncate(message["text"], 280) if message is not None else event["title"],
                "authorName": author_name,
                "targetState": state,
                "alreadyHandled": handled,
                "count": len(list_),
                # По убыванию числа жалоб; при равенстве — в порядке первой жалобы.
                "reasons": [{"reason": reason, "count": n} for reason, n in counts.most_common()],
                "comments": [
                    {"reason": r["reason"], "text": r["comment"], "at": r["createdAt"]}
                    for r in sorted_
                    if r["comment"]
                ],
                "firstAt": sorted_[0]["createdAt"],
                "lastAt": sorted_[-1]["createdAt"],
                "status": "open" if all(r["status"] == "open" for r in list_) else list_[-1]["status"],
            }
        )
    return sorted(out, key=lambda g: (-g["count"], -moment(g["lastAt"]).timestamp()))


def decide_reports(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = require_admin(actor)
    type_ = input_.get("targetType")
    target_id = _text(input_.get("targetId"))
    event, message = _resolve_target(type_, target_id)
    if input_.get("decision") not in ["uphold", "dismiss"]:
        fail("bad_request", "Неизвестное решение")
    open_ = [
        r
        for r in _reports()
        if r["targetType"] == type_ and r["targetId"] == target_id and r["status"] == "open"
    ]
    if not open_:
        fail("already_decided", "По этим жалобам уже есть решение")
    reason = _text(input_.get("reason")).strip()

    _, handled = _target_state(type_, event, message)
    if input_["decision"] == "uphold" and not handled:
        # Снятие и скрытие идут через обычную модерацию: те же правила, уведомления и журнал
        if type_ == "event":
            d.moderate_event(
                admin,
                event["id"],
                {"action": "remove", "ruleId": input_.get("ruleId"), "comment": reason},
            )
        elif message is not None:
            hide_reason = reason or (
                "" if input_.get("ruleId") else f"Жалобы участников: {REASON_TEXT[open_[0]['reason']]}"
            )
            d.moderate_message(
                admin,
                message["id"],
                {"action": "hide", "reason": hide_reason, "ruleId": input_.get("ruleId")},
            )
    elif 0 < len(reason) < 5:
        fail(
            "reason_required",
            "Напишите причину подробнее или оставьте поле пустым",
            {"reason": "Слишком коротко"},
        )

    at = clock.iso(clock.now())
    for r in open_:
        r["status"] = "upheld" if input_["decision"] == "uphold" else "dismissed"
        r["decidedAt"] = at
        r["decidedBy"] = admin["id"]
    what = f"событие «{event['title']}»" if type_ == "event" else f"сообщение в «{event['title']}»"
    link = f"/events/{event['id']}" if type_ == "event" else f"/events/{event['id']}#discussion"
    if input_["decision"] == "uphold":
        done = "событие снято с публикации" if type_ == "event" else "сообщение скрыто"
        notify(
            d,
            [r["reporterId"] for r in open_],
            "report_upheld",
            "Жалоба подтвердилась",
            f"Вы пожаловались на {what}. Администратор проверил: {done}. Спасибо, что помогаете.",
            link,
        )
    else:
        notify(
            d,
            [r["reporterId"] for r in open_],
            "report_dismissed",
            "Жалоба рассмотрена",
            f"Вы пожаловались на {what}. Администратор проверил и нарушений не нашёл{f': {reason}' if reason else ''}.",
            link,
        )
    audit_log(
        d,
        admin,
        "report.uphold" if input_["decision"] == "uphold" else "report.dismiss",
        type_,
        event["id"] if type_ == "event" else target_id,
        event["title"] if type_ == "event" else f"Сообщение в «{event['title']}»",
        ". ".join(x for x in [f"Жалоб: {len(open_)}", reason] if x),
        input_.get("ruleId"),
    )
    commit(["reports", "notifications", "audit", "admin", "events", "messages"], [event["id"]])
    return {"ok": True, "decided": len(open_)}


def community_stats(actor: Actor) -> Entity:
    require_admin(actor)
    open_ = [r for r in _reports() if r["status"] == "open"]

    def uniq(type_: str) -> int:
        return len({r["targetId"] for r in open_ if r["targetType"] == type_})

    return {
        "reports": {"events": uniq("event"), "messages": uniq("message")},
        "imports": {"drafts": sum(1 for p in db().imported_posts if p["status"] == "draft")},
        "suspendedOrgs": sum(1 for o in db().organizations if o.get("suspension") is not None),
    }


def seed_reports(input_: dict[str, Any]) -> list[Entity]:
    """Демо-жалобы: на грубое сообщение и на подозрительное событие."""
    out: list[Entity] = []
    ago: Callable[[int], str] = input_["ago"]

    def add(
        type_: str, target_id: ID, event_id: ID, reporter_id: ID, reason: str, comment: str, minutes: int
    ) -> None:
        out.append(
            {
                "id": f"rp-{len(out) + 1}",
                "targetType": type_,
                "targetId": target_id,
                "eventId": event_id,
                "reporterId": reporter_id,
                "reason": reason,
                "comment": comment,
                "status": "open",
                "createdAt": ago(minutes),
                "decidedAt": None,
                "decidedBy": None,
            }
        )

    rude = next(
        (m for m in input_["messages"] if m["status"] == "visible" and "безрукие" in normalize(m["text"])),
        None,
    )
    if rude:
        add(
            "message",
            rude["id"],
            rude["eventId"],
            "u-oleg",
            "abuse",
            "Оскорбляет всех, кто пришёл на игру.",
            2 * 60,
        )
        add("message", rude["id"], rude["eventId"], "u-anna", "abuse", "", 60)
    shady = next((e for e in input_["events"] if e["id"] == "e-flagged"), None)
    if shady:
        add(
            "event",
            shady["id"],
            shady["id"],
            "u-galina",
            "fraud",
            "Зовут в телеграм и просят предоплату за «бесплатные» тренировки.",
            6 * 60,
        )
        add("event", shady["id"], shady["id"], "u-lyudmila", "spam", "", 3 * 60)
    return out
