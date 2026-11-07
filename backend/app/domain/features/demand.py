"""С2 «Сбор компании от спроса».

Клуб видит обезличенные группы: кто ищет компанию («Ищу компанию», «Я тоже») и чей поиск
в подборе ничего не нашёл. Группа — направление, удобное время и район. Имён и контактов клуб
не видит, маленькие группы (меньше трёх человек) не показываются. Клуб предлагает встречу —
каждому вошедшему участнику группы приходит приглашение.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.kit import (
    commit,
    date_token,
    db,
    get_event,
    notify,
    participation,
    require_user,
)
from app.domain.features.stop_list import is_stop_listed
from app.domain.lib import dates
from app.domain.lib.text import normalize
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

MIN_GROUP = 3
SIGNAL_DAYS = 30
DEDUP_DAYS = 7

SLOT_LABEL: dict[str, str] = {
    "weekday_morning": "утро буднего дня",
    "weekday_day": "будни днём",
    "weekday_evening": "вечер буднего дня",
    "weekend_morning": "выходные утром",
    "weekend_day": "выходные днём",
    "weekend_evening": "выходные вечером",
    "any": "в любое время",
}

PART_TIME = {"morning": "10:00", "day": "13:00", "evening": "19:00"}

_WEEKEND = re.compile(r"выходн|суббот|воскресен")
_EXCEPT_WEEKEND = re.compile(r"кроме (суббот|воскресен|выходн)")
_WEEKDAY = re.compile(
    r"будн|понедельн|вторник|сред|четверг|пятниц|после работы|кроме (суббот|воскресен|выходн)"
)

_MORNING = re.compile(r"утр")
_EVENING = re.compile(r"вечер|после работы|после (1[7-9]|2[0-9])")
_DAY = re.compile(r"дн[её]м|днем|обед|после школы")


def _slot_of(kind: str | None, part: str | None) -> str:
    if not kind and not part:
        return "any"
    return f"{kind or 'weekday'}_{part or ('day' if kind == 'weekend' else 'evening')}"


def slot_from_text(text: str) -> str:
    """Удобное время из свободного текста объявления: «Будни после 19:00», «Выходные днём»."""
    t = normalize(text)
    weekend = bool(_WEEKEND.search(t)) and not _EXCEPT_WEEKEND.search(t)
    weekday = bool(_WEEKDAY.search(t))
    part = (
        "morning"
        if _MORNING.search(t)
        else "evening"
        if _EVENING.search(t)
        else "day"
        if _DAY.search(t)
        else None
    )
    return _slot_of("weekend" if weekend and not weekday else "weekday" if weekday else None, part)


def slot_from_filters(f: dict[str, Any], now: Any = None) -> str:
    """Удобное время из фильтров поиска. `now` — момент (`datetime`, строка ISO), по умолчанию текущий."""
    current = dates.moment(now)
    when = f.get("when")
    day: datetime | None = None
    if when == "today":
        day = current
    elif when == "tomorrow":
        day = current + timedelta(days=1)
    elif when == "date":
        parsed = clock.parse(f.get("date"))
        day = clock.local(parsed) if parsed is not None else None
    if when == "weekend":
        kind: str | None = "weekend"
    elif day is not None:
        kind = "weekend" if day.isoweekday() in {6, 7} else "weekday"
    else:
        kind = None
    part = f.get("dayPart")
    return _slot_of(kind, part if isinstance(part, str) and part in PART_TIME else None)


def _group_key(sport_id: ID, slot: str, district_id: ID | None) -> str:
    return f"{sport_id}|{slot}|{district_id or 'city'}"


def _first(*values: Any) -> Any:
    """Первое значение, которое не None."""
    return next((v for v in values if v is not None), None)


def record_search_demand(d: "Domain", actor: Actor, f: dict[str, Any], level: str | None) -> None:  # noqa: ARG001
    """Неудачный поиск в подборе: запоминаем направление, время и район. Повтор за неделю не считается."""
    sport_ids = f.get("sportIds")
    sport_id = sport_ids[0] if isinstance(sport_ids, list) and sport_ids else None
    if not sport_id or (actor or {}).get("role") == "admin":
        return
    now = clock.now()
    slot = slot_from_filters(f, now)
    district_id = _first(f.get("aroundDistrictId"), f.get("districtId"), (actor or {}).get("districtId"))
    since = now - timedelta(days=DEDUP_DAYS)
    list_ = db().demand_signals
    dup = actor is not None and any(
        s["userId"] == actor["id"]
        and s["sportId"] == sport_id
        and s["slot"] == slot
        and s["districtId"] == district_id
        and _at(s) >= since
        for s in list_
    )
    if dup:
        return
    list_.append(
        {
            "id": store.next_id("ds"),
            "userId": actor["id"] if actor is not None else None,
            "sportId": sport_id,
            "districtId": district_id,
            "slot": slot,
            "level": level,
            "at": clock.iso(now),
        }
    )
    db().demand_signals = list_[-500:]
    commit(["demand"])


# Группа: key, sportId, slot, districtId, users (id → уровень), guests, fromSearch, fromCompanions.
Group = dict[str, Any]


def _at(signal: Entity) -> datetime:
    """Момент сигнала спроса; запись с неверной датой считается давней."""
    return clock.parse(signal["at"]) or datetime.min.replace(tzinfo=UTC)


def _build_groups(d: "Domain", exclude: ID | None) -> dict[str, Group]:
    """Все группы спроса. Владелец смотрящей организации в счёт не идёт."""
    groups: dict[str, Group] = {}

    def touch(sport_id: ID, slot: str, district_id: ID | None) -> Group:
        key = _group_key(sport_id, slot, district_id)
        g = groups.get(key)
        if g is None:
            g = {
                "key": key,
                "sportId": sport_id,
                "slot": slot,
                "districtId": district_id,
                "users": {},
                "guests": 0,
                "fromSearch": set(),
                "fromCompanions": set(),
            }
            groups[key] = g
        return g

    def add(g: Group, user_id: ID, level: str | None, source: str) -> None:
        if user_id == exclude:
            return
        if user_id not in g["users"] or level:
            g["users"][user_id] = level if level is not None else g["users"].get(user_id)
        (g["fromSearch"] if source == "search" else g["fromCompanions"]).add(user_id)

    for c in db().companions:
        if c["status"] != "open":
            continue
        g = touch(c["sportId"], slot_from_text(c["when"]), c["districtId"])
        add(g, c["authorId"], c["level"], "companion")
        for m in c["metoo"]:
            user = d.user(m["userId"])
            add(g, m["userId"], user["levels"].get(c["sportId"]) if user else None, "companion")
    since = clock.now() - timedelta(days=SIGNAL_DAYS)
    for s in db().demand_signals:
        if _at(s) < since:
            continue
        g = touch(s["sportId"], s["slot"], s["districtId"])
        if s["userId"]:
            add(g, s["userId"], s["level"], "search")
        else:
            g["guests"] += 1
            g["fromSearch"].add(s["id"])
    return groups


def demand_groups_for_analytics(d: "Domain") -> list[Entity]:
    """В6: те же группы спроса для аналитики — цифры по группе совпадают со «Спросом рядом»."""
    return [
        {
            "key": g["key"],
            "sportId": g["sportId"],
            "districtId": g["districtId"],
            "slot": g["slot"],
            "people": len(g["users"]) + g["guests"],
            "fromSearch": len(g["fromSearch"]),
            "fromCompanions": len(g["fromCompanions"]),
            "beginners": sum(1 for level in g["users"].values() if level == "beginner"),
        }
        for g in _build_groups(d, None).values()
    ]


def _require_club(actor: Actor, org_id: ID) -> Entity:
    user = require_user(actor)
    org = next((o for o in db().organizations if o["id"] == org_id), None)
    if org is None:
        fail("not_found", "Организация не найдена")
    if org["ownerId"] != user["id"]:
        fail("forbidden", "Спрос видит только представитель организации")
    if org["status"] != "approved":
        fail("org_not_approved", "Спрос рядом откроется после допуска организации администратором")
    return org


def _next_date(slot: str, today: datetime) -> str:
    """Дата предлагаемой встречи: не раньше послезавтра, в субботу для выходных, в будни для будней."""
    weekend = slot.startswith("weekend")
    day = today.date() + timedelta(days=2)
    for _ in range(8):
        wd = day.isoweekday()
        if (wd == 6) if weekend else (slot == "any" or wd <= 5):
            break
        day += timedelta(days=1)
    return day.isoformat()


def _size(g: Group) -> int:
    return len(g["users"]) + g["guests"]


def demand_view(d: "Domain", actor: Actor, org_id: ID) -> Entity:
    org = _require_club(actor, org_id)
    today = clock.local(clock.now())
    all_ = list(_build_groups(d, org["ownerId"]).values())
    visible = [g for g in all_ if _size(g) >= MIN_GROUP]
    hidden = sum(_size(g) for g in all_ if _size(g) < MIN_GROUP)
    groups: list[Entity] = []
    for g in visible:
        sport = d.sport_view(g["sportId"])
        district_name = next((x["name"] for x in db().districts if x["id"] == g["districtId"]), None)
        offer = next(
            (o for o in reversed(db().demand_offers) if o["key"] == g["key"] and o["orgId"] == org["id"]),
            None,
        )
        offer_event = (
            db().record("events", offer["eventId"]) if offer is not None else None
        )
        beginners = sum(1 for level in g["users"].values() if level == "beginner")
        slot_parts = g["slot"].split("_")
        part = slot_parts[1] if len(slot_parts) > 1 else None
        groups.append(
            {
                "key": g["key"],
                "sport": sport,
                "slot": g["slot"],
                "slotLabel": SLOT_LABEL[g["slot"]],
                "districtId": g["districtId"],
                "districtName": district_name,
                "people": _size(g),
                "fromSearch": len(g["fromSearch"]),
                "fromCompanions": len(g["fromCompanions"]),
                "beginners": beginners,
                "reachable": len(g["users"]),
                "ours": sport["id"] in org["sportIds"],
                "offer": (
                    {
                        "eventId": offer_event["id"],
                        "title": offer_event["title"],
                        "startsAt": offer_event["startsAt"],
                        "invited": len(offer["invited"]),
                    }
                    if offer is not None and offer_event is not None
                    else None
                ),
                "suggestion": {
                    "title": (
                        f"{sport['name']} для начинающих"
                        if beginners * 2 >= len(g["users"]) and beginners > 0
                        else f"{sport['name']}: открытая встреча"
                    ),
                    "date": _next_date(g["slot"], today),
                    "time": PART_TIME.get(part or "", PART_TIME["evening"]),
                    "districtId": g["districtId"],
                    "address": org["address"]
                    if org.get("districtId") and org["districtId"] == g["districtId"]
                    else "",
                },
            }
        )
    groups.sort(key=lambda g: (not g["ours"], -g["people"]))
    return {"groups": groups, "hidden": hidden, "minGroup": MIN_GROUP}


def _text(value: Any) -> str:
    """Строка из тела запроса; не строка — пустая."""
    return value if isinstance(value, str) else ""


def offer_demand(d: "Domain", actor: Actor, org_id: ID, input_: dict[str, Any]) -> Entity:
    """Тело: key; eventId — пригласить на уже созданную встречу клуба, или event — поля новой встречи
    (остальное подставит сервер); idempotencyKey."""
    org = _require_club(actor, org_id)
    user = cast("Entity", actor)
    key = input_.get("key")
    group = _build_groups(d, org["ownerId"]).get(key) if isinstance(key, str) else None
    if group is None or _size(group) < MIN_GROUP:
        fail("not_found", "Эта группа уже неактуальна: люди нашли встречу или закрыли объявления")

    event_id = input_.get("eventId") or None
    if event_id is None:
        ev = input_.get("event")
        if not isinstance(ev, dict):
            fail("validation", "Выберите встречу клуба или создайте новую")
        place = ev.get("place") if isinstance(ev.get("place"), dict) else {}
        beginner_share = sum(1 for level in group["users"].values() if level == "beginner")
        for_beginners = beginner_share * 2 >= len(group["users"]) and beginner_share > 0
        # Числа (длительность, лимит мест) проверяет и приводит само создание встречи
        created = d.create_event(
            user,
            {
                "title": _text(ev.get("title")),
                "description": _text(ev.get("description")).strip()
                or "Встреча для тех, кто искал компанию на платформе. Приходите со своим уровнем, всё объясним на месте.",
                "sportId": group["sportId"],
                "orgId": org["id"],
                "startsAt": _text(ev.get("startsAt")),
                "durationMin": _first(ev.get("durationMin"), 90),
                "place": {
                    "address": _text(place.get("address")),
                    "landmark": _text(place.get("landmark")),
                    "districtId": _first(place.get("districtId"), group["districtId"]),
                },
                "level": "beginner" if for_beginners else "any",
                "beginnersWelcome": True,
                "firstStep": {},
                "price": _first(ev.get("price"), {"kind": "free"}),
                "cancelPolicy": {"kind": "anytime"},
                "joinMode": "approval" if ev.get("joinMode") == "approval" else "open",
                "capacity": ev.get("capacity") or None,
                "minParticipants": None,
                "idempotencyKey": input_.get("idempotencyKey"),
            },
        )
        event_id = created["id"]

    e = get_event(event_id)
    if e["organizer"]["kind"] != "org" or e["organizer"]["id"] != org["id"]:
        fail("forbidden", "Пригласить можно только на встречу своей организации")
    if d.event_state(e) != "upcoming":
        fail("event_inactive", "Эта встреча уже прошла или отменена")
    if e["sportId"] != group["sportId"]:
        fail("bad_request", "Направление встречи не совпадает с группой спроса")

    already = {i["toUserId"] for i in db().invites if i["eventId"] == e["id"]}
    now = clock.now()
    targets: list[ID] = []
    for user_id in group["users"]:
        p = participation(e["id"], user_id)
        if (
            user_id not in already
            and not (p is not None and (p["status"] in ACTIVE_PARTICIPATION or p["status"] == "rejected"))
            and not is_stop_listed(db(), user_id, e, now)  # D-16
        ):
            targets.append(user_id)
    at = clock.iso(now)
    for to_user_id in targets:
        db().invites.append(
            {
                "id": store.next_id("inv"),
                "eventId": e["id"],
                "fromUserId": user["id"],
                "toUserId": to_user_id,
                "companionId": None,
                "createdAt": at,
            }
        )
    sport_name = d.sport_view(e["sportId"])["name"].lower()
    approval = ": по приглашению заявку подтверждать не нужно" if e["joinMode"] == "approval" else ""
    notify(
        d,
        targets,
        "demand_offer",
        f"{org['name']} предлагает встречу",
        f"Вы искали компанию: {sport_name}, {SLOT_LABEL[group['slot']]}. Клуб собрал встречу «{e['title']}», {date_token(e['startsAt'])}. Посмотрите условия и запишитесь{approval}.",
        f"/events/{e['id']}",
    )
    db().demand_offers.append(
        {
            "id": store.next_id("do"),
            "key": group["key"],
            "orgId": org["id"],
            "eventId": e["id"],
            "invited": targets,
            "at": at,
        }
    )
    commit(["demand", "events", "invites", "notifications"], [e["id"]])
    return {"eventId": e["id"], "invited": len(targets), "guests": group["guests"]}
