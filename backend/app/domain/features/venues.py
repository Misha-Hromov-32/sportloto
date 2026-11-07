"""В4, В5, Н1. Площадки и их свободные окна, подбор удобного места для компании,
условия доступной среды и отметка «Мне нужно сопровождение».
Бронирования нет: площадка сама отмечает окна, связь с ней — по контактам.
"""

import re
from datetime import datetime, time, timedelta
from typing import Any

import sqlalchemy as sa

from app.domain import bus, clock, store
from app.domain.errors import fail
from app.domain.features.kit import organizer_ids
from app.domain.lib.geo import distance_km
from app.domain.lib.numbers import NBSP, format_number, parse_number
from app.domain.lib.text import ru_sort_key
from app.domain.lib.venues import (
    ACCESS_FEATURES,
    SCHEDULE_DAYS,
    SLOT,
    SLOT_MIN,
    VENUE_FEATURE,
    VENUE_FEATURES,
    VENUE_KIND,
    base_price,
    hour_price,
    is_slot_start,
    local_date,
    slot_override,
    slot_starts,
    venue_moment,
    window_label,
)
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.schema import COLLECTIONS
from app.domain.types import ID, Actor, Entity

KINDS = list(VENUE_KIND)
EXTRAS = ["escort", "adaptiveGear"]
DEFAULT_TZ = "Asia/Krasnoyarsk"
CITY_CENTER = {"lat": 56.0106, "lng": 92.8526}
DAY_PARTS = {"morning": (0, 12), "day": (12, 17), "evening": (17, 24)}
PRICE_MAX = 100_000
PRICE_ERROR = "Цена за час от 0 до 100 000 ₽"


def _now_iso() -> str:
    return clock.iso(clock.now())


def _trim(value: Any, max_: int) -> str:
    """Строка из тела запроса без пробелов по краям, не длиннее `max_`; не строка — пустая."""
    return value.strip()[:max_] if isinstance(value, str) else ""


def _km(value: float) -> str:
    return f"{format_number(value, 1)}{NBSP}км"


def _distance(a: Any, b: Any) -> float | None:
    """Расстояние в километрах с одним знаком; None, если у точки нет координат."""
    km = distance_km(a, b)
    return None if km is None else round(km, 1)


def _prop(value: Any, key: str) -> Any:
    """Поле объекта из тела запроса; у не-объекта полей нет."""
    return value.get(key) if isinstance(value, dict) else None


def _price(value: Any) -> int | None:
    """Цена за час из тела запроса: целое от 0 до 100 000 или None, если это не такая цена."""
    number = parse_number(value)
    return round(number) if number is not None and 0 <= number <= PRICE_MAX else None


def _venues(db: store.Database) -> list[Entity]:
    return db.venues


def _commit(resources: list[str], ids: list[ID]) -> None:
    bus.publish(resources, ids)


def _notify(db: store.Database, user_ids: list[ID], type_: str, title: str, text: str, link: str) -> None:
    at = _now_iso()
    for user_id in dict.fromkeys(u for u in user_ids if u):
        db.notifications.insert(
            0,
            {
                "id": store.next_id("n"),
                "userId": user_id,
                "type": type_,
                "title": title,
                "text": text,
                "link": link,
                "read": False,
                "createdAt": at,
            },
        )


def _require_user(actor: Actor) -> Entity:
    return actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")


def _org_of(db: store.Database, v: Entity) -> Entity | None:
    return next((o for o in db.organizations if o["id"] == v["orgId"]), None)


def _is_owner(db: store.Database, actor: Actor, v: Entity) -> bool:
    return actor is not None and (_org_of(db, v) or {}).get("ownerId") == actor["id"]


def _is_public(db: store.Database, v: Entity) -> bool:
    """Площадку видят все, когда её организация допущена и площадка не скрыта."""
    return v["status"] == "active" and (_org_of(db, v) or {}).get("status") == "approved"


def _get_venue(db: store.Database, id_: ID) -> Entity:
    found = next((v for v in _venues(db) if v["id"] == id_), None)
    return found if found is not None else fail("not_found", "Площадка не найдена")


def _sport_view(db: store.Database, id_: ID) -> Entity | None:
    s = next((x for x in db.sports if x["id"] == id_), None)
    if s is None:
        return None
    target = s
    if s.get("mergedInto"):
        target = next((x for x in db.sports if x["id"] == s["mergedInto"]), s)
    return {
        "id": target["id"],
        "name": target["name"],
        "icon": target["icon"],
        "kind": target["kind"],
        "popular": target["popular"],
        "categoryIds": target["categoryIds"],
        "synonyms": target["synonyms"],
        "fields": target["fields"],
    }


def _merged_sport(db: store.Database, id_: ID) -> ID:
    """Направление, в которое слили `id_`, или само `id_`."""
    merged = next((s.get("mergedInto") for s in db.sports if s["id"] == id_), None)
    return merged if merged is not None else id_


def _event_span(e: Entity) -> tuple[datetime, datetime] | None:
    """Начало и конец встречи; None, если время начала не разобрать."""
    start = clock.parse(e["startsAt"])
    return None if start is None else (start, start + timedelta(minutes=e["durationMin"]))


def _is_upcoming(e: Entity) -> bool:
    span = _event_span(e)
    return e["status"] == "published" and span is not None and span[1] > clock.now()


def _actor_point(db: store.Database, actor: Actor) -> dict[str, float] | None:
    if actor is None:
        return None
    if actor.get("home") is not None:
        return actor["home"]
    d = next((x for x in db.districts if x["id"] == actor.get("districtId")), None)
    return {"lat": d["lat"], "lng": d["lng"]} if d is not None else None


def _id_list(value: Any) -> list[Any]:
    """Список идентификаторов из запроса: одно значение-строка — список из него."""
    if isinstance(value, list):
        return value
    return [value] if isinstance(value, str) and value else []


# ---------- Окна расписания ----------


def _venue_events(db: store.Database, v: Entity) -> list[Entity]:
    """Встречи платформы на площадке, которые ещё не прошли."""
    table = COLLECTIONS["events"].table
    return db.records("events", table.c.venue_id == v["id"], table.c.status == "published",
                      table.c.starts_at + table.c.duration_min * sa.literal_column("INTERVAL '1 minute'") > clock.now(),
                      predicate=lambda e: e.get("venueId") == v["id"] and _is_upcoming(e))


def _slot_view(v: Entity, starts_at: str, events: list[Entity]) -> Entity:
    start = clock.parse(starts_at)
    end = start + SLOT
    busy_by = next(
        (e for e in events if (span := _event_span(e)) is not None and span[0] < end and span[1] > start),
        None,
    )
    override = slot_override(v, starts_at)
    price = (override or {}).get("price")
    if price is None:
        price = base_price(v, starts_at)
    if busy_by is not None:
        status = "event"
    elif override is not None and not override.get("free"):
        status = "busy"
    else:
        status = "free"
    return {
        "startsAt": starts_at,
        "endsAt": clock.iso(end),
        "status": status,
        "price": price,
        "custom": override is not None,
        "event": {"id": busy_by["id"], "title": busy_by["title"]} if busy_by is not None else None,
    }


def venue_days(db: store.Database, v: Entity, days: int = SCHEDULE_DAYS, *, events: list[Entity] | None = None) -> list[Entity]:
    """Расписание на две недели: прошедшие окна сегодняшнего дня не показываем."""
    events = _venue_events(db, v) if events is None else events
    now = clock.now()
    out: list[Entity] = []
    for i in range(days):
        date = local_date(now, v["timeZone"], i)
        slots = [_slot_view(v, iso, events) for iso in slot_starts(v, date) if clock.parse(iso) + SLOT > now]
        out.append({"date": date, "slots": slots, "freeCount": sum(s["status"] == "free" for s in slots)})
    return out


def merge_windows(slots: list[Entity]) -> list[Entity]:
    """Соседние свободные окна склеиваются в один отрезок."""
    out: list[Entity] = []
    for s in slots:
        if s["status"] != "free":
            continue
        last = out[-1] if out else None
        if last is not None and last["endsAt"] == s["startsAt"]:
            last["endsAt"] = s["endsAt"]
            last["price"] = max(last["price"], s["price"])
        else:
            out.append({"startsAt": s["startsAt"], "endsAt": s["endsAt"], "price": s["price"]})
    return out


def _in_day_part(v: Entity, iso: str, part: str) -> bool:
    from_, to = DAY_PARTS[part]
    return from_ <= venue_moment(iso, v["timeZone"]).hour < to


def _slots_covering(days: list[Entity], starts_at: str, duration_min: float) -> list[Entity] | None:
    """Окна, которые покрывают время встречи."""
    start = clock.parse(starts_at)
    end = start + timedelta(minutes=duration_min)
    covering = [
        s
        for d in days
        for s in d["slots"]
        if clock.parse(s["startsAt"]) < end and clock.parse(s["endsAt"]) > start
    ]
    if not covering:
        return None
    # Встреча выходит за часы работы — свободной её считать нельзя
    if clock.parse(covering[0]["startsAt"]) > start or clock.parse(covering[-1]["endsAt"]) < end:
        return None
    return covering


# ---------- Представления ----------


def venue_short(v: Entity) -> Entity:
    return {
        "id": v["id"],
        "name": v["name"],
        "kind": v["kind"],
        "address": v["address"],
        "pricePerHour": v["pricePerHour"],
    }


def venue_view(db: store.Database, actor: Actor, v: Entity, opts: dict[str, Any] | None = None) -> Entity:
    """`opts`: `point` (GeoPoint или None; без ключа — точка смотрящего), `date`, `dayPart`, `days`."""
    opts = opts or {}
    events = opts.get("events")
    if events is None:
        events = _venue_events(db, v)
    days = opts.get("days")
    if days is None:
        days = venue_days(db, v, events=events)
    date, day_part = opts.get("date"), opts.get("dayPart")
    scoped = [
        s
        for d in days
        for s in d["slots"]
        if (not date or venue_moment(s["startsAt"], v["timeZone"]).date().isoformat() == date)
        and (not day_part or _in_day_part(v, s["startsAt"], day_part))
    ]
    org = _org_of(db, v)
    org_name = (org or {}).get("name")
    point = opts["point"] if "point" in opts else _actor_point(db, actor)
    owner_updated = clock.parse(v["ownerUpdatedAt"])
    return {
        **{k: value for k, value in v.items() if k != "slots"},
        "sports": [s for s in (_sport_view(db, id_) for id_ in v["sportIds"]) if s is not None],
        "kindLabel": VENUE_KIND.get(v["kind"]),
        "districtName": next((d["name"] for d in db.districts if d["id"] == v.get("districtId")), None),
        "org": {
            "id": v["orgId"],
            "name": org_name if org_name is not None else "Организация",
            "verified": (org or {}).get("status") == "approved",
        },
        "isOwner": _is_owner(db, actor, v),
        "ownerUpdatedDays": None if owner_updated is None else max(0, (clock.now() - owner_updated).days),
        "distanceKm": _distance(point, v) if point is not None else None,
        "nextWindows": merge_windows(scoped)[:3],
        "freeCount": sum(s["status"] == "free" for s in scoped),
        "upcomingEvents": len(events),
    }


def list_venues(db: store.Database, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
    q = q or {}
    list_ = _venues(db)
    if q.get("scope") == "mine":
        user = _require_user(actor)
        own = [o["id"] for o in db.organizations if o["ownerId"] == user["id"]]
        list_ = [v for v in list_ if v["orgId"] in own]
    else:
        list_ = [v for v in list_ if _is_public(db, v)]
    if q.get("orgId"):
        list_ = [v for v in list_ if v["orgId"] == q["orgId"]]
    sport_ids = _id_list(q["sportIds"]) if q.get("sportIds") is not None else _id_list(q.get("sportId"))
    if sport_ids:
        ids = [_merged_sport(db, id_) for id_ in sport_ids]
        list_ = [v for v in list_ if any(id_ in ids for id_ in v["sportIds"])]
    if q.get("districtId"):
        list_ = [v for v in list_ if v.get("districtId") == q["districtId"]]
    if q.get("indoor") is not None:
        list_ = [v for v in list_ if v["indoor"] == bool(q["indoor"])]
    features = _id_list(q.get("features"))
    if features:
        list_ = [v for v in list_ if all(f in v["features"] for f in features)]
    text = q.get("q")
    if isinstance(text, str) and text.strip():
        needle = text.strip().lower()
        list_ = [
            v
            for v in list_
            if needle
            in " ".join(
                x or "" for x in [v["name"], v["address"], v["description"], VENUE_KIND.get(v["kind"])]
            ).lower()
        ]
    day_part = q.get("dayPart")
    if day_part and (not isinstance(day_part, str) or day_part not in DAY_PARTS):
        fail("validation", "Выберите время дня: утро, день или вечер", {"dayPart": "Выберите время дня"})
    point = _actor_point(db, actor)
    scoped = bool(q.get("date") or day_part)
    views = [
        venue_view(db, actor, v, {"point": point, "date": q.get("date"), "dayPart": day_part}) for v in list_
    ]
    price_max = parse_number(q.get("priceMax"))
    if price_max is not None:
        if scoped:
            views = [v for v in views if any(w["price"] <= price_max for w in v["nextWindows"])]
        else:
            views = [v for v in views if min(_venue_prices(v)) <= price_max]
    if scoped:
        views = [v for v in views if v["freeCount"] > 0]
    return sorted(views, key=lambda v: (v["distanceKm"] or 0, -v["freeCount"], ru_sort_key(v["name"])))


def _venue_prices(v: Entity) -> list[float]:
    peak = v.get("peakPricePerHour")
    return [v["pricePerHour"]] if peak is None else [v["pricePerHour"], peak]


def venue_details(db: store.Database, actor: Actor, id_: ID) -> Entity:
    v = _get_venue(db, id_)
    privileged = _is_owner(db, actor, v) or (actor or {}).get("role") == "admin"
    if not _is_public(db, v) and not privileged:
        if v["status"] == "hidden":
            fail("not_found", "Владелец скрыл площадку. Посмотрите другие площадки рядом")
        fail("not_found", "Страница площадки пока недоступна: её владельца ещё не проверил администратор")
    days = venue_days(db, v)
    return {**venue_view(db, actor, v, {"days": days}), "days": days}


# ---------- Изменения владельцем ----------


def _require_venue_org(db: store.Database, actor: Actor, org_id: ID) -> Entity:
    user = _require_user(actor)
    o = next((x for x in db.organizations if x["id"] == org_id), None)
    if o is None:
        fail("not_found", "Организация не найдена")
    if o["ownerId"] != user["id"]:
        fail("forbidden", "Площадками управляет только представитель организации")
    if o["type"] != "venue":
        fail("bad_request", "Площадки ведут организации с типом «Площадка»")
    if o["status"] != "approved":
        fail(
            "org_not_approved",
            "Организация ещё не допущена. Вести площадки можно после проверки администратором",
        )
    return o


HHMM = re.compile(r"([01][0-9]|2[0-3]):[0-5][0-9]")


def _is_hhmm(value: Any) -> bool:
    return isinstance(value, str) and HHMM.fullmatch(value) is not None


def _minutes_of(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def _validate_venue(input_: dict[str, Any], partial: bool) -> dict[str, str]:
    errors: dict[str, str] = {}

    def has(k: str) -> bool:
        return not partial or k in input_

    if has("name") and len(_trim(input_.get("name"), 80)) < 3:
        errors["name"] = "Напишите название, хотя бы 3 буквы"
    if has("kind") and input_.get("kind") not in KINDS:
        errors["kind"] = "Выберите тип площадки"
    if has("address") and len(_trim(input_.get("address"), 160)) < 3:
        errors["address"] = "Укажите адрес"
    sport_ids = input_.get("sportIds")
    if has("sportIds") and (not isinstance(sport_ids, list) or not sport_ids):
        errors["sportIds"] = "Выберите хотя бы одно направление"
    if has("pricePerHour") and _price(input_.get("pricePerHour")) is None:
        errors["pricePerHour"] = PRICE_ERROR
    peak = input_.get("peakPricePerHour")
    if has("peakPricePerHour") and peak is not None and _price(peak) is None:
        errors["peakPricePerHour"] = PRICE_ERROR
    if has("hours"):
        h = input_.get("hours")
        if not _is_hhmm(_prop(h, "open")) or not _is_hhmm(_prop(h, "close")):
            errors["hours"] = "Укажите часы работы"
        elif _minutes_of(h["close"]) - _minutes_of(h["open"]) < SLOT_MIN:
            errors["hours"] = "Площадка должна работать хотя бы 2 часа в день"
    features = input_.get("features")
    if has("features") and (
        not isinstance(features, list | None) or any(f not in VENUE_FEATURES for f in features or [])
    ):
        errors["features"] = "Выберите условия из списка"
    contacts = input_.get("contacts")
    if (
        has("contacts")
        and not _trim(_prop(contacts, "phone"), 40)
        and not _trim(_prop(contacts, "email"), 80)
    ):
        errors["contacts"] = "Укажите телефон или почту, чтобы с вами могли связаться"
    return errors


def _venue_point(db: store.Database, input_: dict[str, Any], current: Entity | None = None) -> dict[str, Any]:
    lat, lng = parse_number(input_.get("lat")), parse_number(input_.get("lng"))
    if lat is not None and lng is not None:
        return {"lat": lat, "lng": lng}
    if current is not None and "districtId" not in input_:
        return {"lat": current["lat"], "lng": current["lng"]}
    district_id = input_.get("districtId")
    if district_id is None:
        district_id = (current or {}).get("districtId")
    district = next((d for d in db.districts if d["id"] == district_id), None)
    return {"lat": district["lat"], "lng": district["lng"]} if district is not None else CITY_CENTER


def _contacts(contacts: dict[str, Any]) -> dict[str, str]:
    return {
        "phone": _trim(contacts.get("phone"), 40),
        "email": _trim(contacts.get("email"), 80),
        "site": _trim(contacts.get("site"), 120),
    }


def _known_sports(db: store.Database, ids: list[ID]) -> list[ID]:
    return [id_ for id_ in ids if any(s["id"] == id_ for s in db.sports)]


def create_venue(db: store.Database, actor: Actor, input_: dict[str, Any]) -> Entity:
    """`input_` — VenueInput и `orgId`."""
    _require_venue_org(db, actor, input_.get("orgId"))
    errors = _validate_venue(input_, False)
    if errors:
        fail("validation", "Проверьте поля площадки", errors)
    at = _now_iso()
    peak = input_.get("peakPricePerHour")
    v: Entity = {
        "id": store.next_id("v"),
        "orgId": input_["orgId"],
        "name": _trim(input_.get("name"), 80),
        "kind": input_["kind"],
        "description": _trim(input_.get("description"), 1000),
        "address": _trim(input_.get("address"), 160),
        "landmark": _trim(input_.get("landmark"), 160),
        "districtId": input_.get("districtId"),
        **_venue_point(db, input_),
        "sportIds": _known_sports(db, input_["sportIds"]),
        "indoor": bool(input_.get("indoor")),
        "pricePerHour": _price(input_["pricePerHour"]),
        "peakPricePerHour": None if peak is None else _price(peak),
        "features": list(dict.fromkeys(input_.get("features") or [])),
        "photoUrl": _trim(input_.get("photoUrl"), 500) or None,
        "contacts": _contacts(input_["contacts"]),
        "hours": {"open": input_["hours"]["open"], "close": input_["hours"]["close"]},
        "timeZone": DEFAULT_TZ,
        "slots": [],
        "status": "hidden" if input_.get("status") == "hidden" else "active",
        "ownerUpdatedAt": at,
        "createdAt": at,
    }
    _venues(db).append(v)
    _commit(["venues"], [v["id"]])
    return venue_details(db, actor, v["id"])


def update_venue(db: store.Database, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    """`input_` — часть полей VenueInput."""
    v = _get_venue(db, id_)
    _require_venue_org(db, actor, v["orgId"])
    errors = _validate_venue(input_, True)
    if errors:
        fail("validation", "Проверьте поля площадки", errors)
    for key, max_ in (("name", 80), ("description", 1000), ("address", 160), ("landmark", 160)):
        if key in input_:
            v[key] = _trim(input_[key], max_)
    if "kind" in input_:
        v["kind"] = input_["kind"]
    if "districtId" in input_ or "lat" in input_:
        v.update(_venue_point(db, input_, v))
    if "districtId" in input_:
        v["districtId"] = input_["districtId"]
    if "sportIds" in input_:
        v["sportIds"] = _known_sports(db, input_["sportIds"])
    if "indoor" in input_:
        v["indoor"] = bool(input_["indoor"])
    if "pricePerHour" in input_:
        v["pricePerHour"] = _price(input_["pricePerHour"])
    if "peakPricePerHour" in input_:
        peak = input_["peakPricePerHour"]
        v["peakPricePerHour"] = None if peak is None else _price(peak)
    if "features" in input_:
        v["features"] = list(dict.fromkeys(input_["features"] or []))
    if "photoUrl" in input_:
        v["photoUrl"] = _trim(input_["photoUrl"], 500) or None
    if "contacts" in input_:
        v["contacts"] = _contacts(input_["contacts"])
    if "hours" in input_:
        v["hours"] = {"open": input_["hours"]["open"], "close": input_["hours"]["close"]}
    if "status" in input_:
        v["status"] = "hidden" if input_["status"] == "hidden" else "active"
    v["ownerUpdatedAt"] = _now_iso()
    _commit(["venues", "events"], [v["id"]])
    return venue_details(db, actor, v["id"])


def _schedule_end(v: Entity, now: datetime) -> datetime:
    """Конец последнего дня, на который ведётся расписание (по местному времени площадки)."""
    last_day = clock.local(now, v["timeZone"]).date() + timedelta(days=SCHEDULE_DAYS + 1)
    return datetime.combine(last_day, time(), clock.zone_info(v["timeZone"]))


def set_venue_slots(db: store.Database, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    """`input_` — VenueSlotsInput: `{ slots: [{ startsAt, free, price? }] }`."""
    v = _get_venue(db, id_)
    _require_venue_org(db, actor, v["orgId"])
    slots = input_.get("slots") if isinstance(input_.get("slots"), list) else []
    if not slots:
        fail("validation", "Выберите окна, которые нужно изменить")
    now = clock.now()
    horizon = _schedule_end(v, now)
    changes: list[tuple[str, dict[str, Any]]] = []
    for s in slots:
        start = clock.parse(_prop(s, "startsAt"))
        if start is None or not is_slot_start(v, clock.iso(start)):
            fail("validation", "Такого окна нет в расписании площадки")
        if start + SLOT <= now:
            fail("bad_state", "Это окно уже прошло, менять его поздно")
        if start >= horizon:
            fail("validation", "Расписание ведётся на две недели вперёд")
        if s.get("price") is not None and _price(s["price"]) is None:
            fail("validation", PRICE_ERROR, {"price": PRICE_ERROR})
        changes.append((clock.iso(start), s))
    for starts_at, s in changes:
        if "price" in s:
            price = None if s["price"] is None else _price(s["price"])
        else:
            price = (slot_override(v, starts_at) or {}).get("price")
        free = bool(s.get("free"))
        v["slots"] = [x for x in v["slots"] if x["startsAt"] != starts_at]
        # Свободное окно по базовой цене — это состояние по умолчанию, хранить его не нужно
        if not free or price is not None:
            v["slots"].append({"startsAt": starts_at, "free": free, "price": price})
    # Прошедшие окна больше не нужны
    v["slots"] = [x for x in v["slots"] if clock.parse(x["startsAt"]) + SLOT > now]
    v["ownerUpdatedAt"] = _now_iso()
    _commit(["venues"], [v["id"]])
    return venue_details(db, actor, v["id"])


# ---------- Событие и площадка ----------


def event_venue_fields(db: store.Database, e: Entity) -> Entity:
    """Поля площадки и доступной среды для карточки события: `{ venue, access }`."""
    v = next((x for x in _venues(db) if x["id"] == e["venueId"]), None) if e.get("venueId") else None
    return {
        "venue": venue_short(v) if v is not None else None,
        "access": {
            "venue": [f for f in v["features"] if f in ACCESS_FEATURES] if v is not None else [],
            "extras": [x for x in e.get("accessExtras") or [] if x in EXTRAS],
        },
    }


def event_meets_needs(db: store.Database, e: Entity, needs: list[str] | None) -> bool:
    """Фильтр «Нужна доступная среда»: все отмеченные условия должны быть."""
    if not needs:
        return True
    access = event_venue_fields(db, e)["access"]
    return all(("escort" in access["extras"]) if n == "escort" else (n in access["venue"]) for n in needs)


def event_venue_patch(db: store.Database, input_: dict[str, Any], current: Entity | None = None) -> Entity:
    """Площадка и дополнения организатора при создании и правке события.

    Без `current` (создание) возвращает значения по умолчанию.
    """
    out: Entity = {}
    if "venueId" in input_ or current is None:
        id_ = input_.get("venueId")
        if id_ not in (None, "") and not any(v["id"] == id_ for v in _venues(db)):
            fail("validation", "Проверьте поля формы", {"venueId": "Такой площадки нет. Выберите другую"})
        out["venueId"] = id_
    if "accessExtras" in input_ or current is None:
        extras = input_.get("accessExtras") if isinstance(input_.get("accessExtras"), list) else []
        out["accessExtras"] = list(dict.fromkeys(x for x in extras if x in EXTRAS))
    return out


def _get_event(db: store.Database, id_: ID) -> Entity:
    found = db.record("events", id_)
    return found if found is not None else fail("not_found", "Событие не найдено")


def _is_organizer(actor: Actor, e: Entity) -> bool:
    return actor is not None and actor["id"] in organizer_ids(e)


def venue_move_patch(db: store.Database, actor: Actor, event_id: ID, venue_id: ID) -> Entity:
    """«Перенести встречу сюда»: правка места через обычное изменение события (с «было → стало»)."""
    user = _require_user(actor)
    e = _get_event(db, event_id)
    if not _is_organizer(user, e):
        fail("forbidden", "Перенести встречу может только организатор")
    v = _get_venue(db, venue_id)
    if not _is_public(db, v):
        fail("bad_state", "Эта площадка сейчас недоступна")
    if e.get("venueId") == v["id"] and e["place"]["address"] == v["address"]:
        fail("bad_state", "Встреча уже проходит на этой площадке")
    return {
        "venueId": v["id"],
        "place": {
            "address": v["address"],
            "landmark": "",
            "districtId": v["districtId"],
            "lat": v["lat"],
            "lng": v["lng"],
        },
        "firstStep": {"howToFind": v["landmark"]},
    }


def set_escort(db: store.Database, actor: Actor, event_id: ID, needed: bool) -> None:
    """«Мне нужно сопровождение»: отметка участника, видна организатору."""
    user = _require_user(actor)
    e = _get_event(db, event_id)
    mine = next(
        (
            p
            for p in db.participations
            if p["eventId"] == event_id and p["userId"] == user["id"] and p["status"] in ACTIVE_PARTICIPATION
        ),
        None,
    )
    if mine is None:
        fail("no_participation", "Отметить сопровождение может участник встречи. Сначала запишитесь")
    if bool(mine.get("needsEscort")) == needed:
        return
    mine["needsEscort"] = needed
    if needed:
        _notify(
            db,
            organizer_ids(e),
            "escort_needed",
            "Участнику нужно сопровождение",
            f"{user['name']} идёт на «{e['title']}» и просит сопровождение. Договоритесь, кто встретит у входа.",
            f"/events/{e['id']}/manage?tab=participants",
        )
    _commit(["events", "participations", "notifications"], [e["id"]])


# ---------- В5: удобное место для всей компании ----------


def _people_of(db: store.Database, user: Entity, input_: dict[str, Any]) -> dict[str, Any]:
    """Кого везти: группы по районам (`groups`), сколько посчитано (`counted`), без района, направление, встреча."""
    sport_id: ID | None = input_.get("sportId")
    event: Entity | None = None
    if input_.get("eventId"):
        event = _get_event(db, input_["eventId"])
        if not _is_organizer(user, event):
            fail("forbidden", "Подбирать место может только организатор")
        user_ids = [
            *organizer_ids(event),
            *(
                p["userId"]
                for p in db.participations
                if p["eventId"] == event["id"] and p["status"] in ACTIVE_PARTICIPATION
            ),
        ]
        sport_id = event["sportId"]
    elif input_.get("companionId"):
        c = next((x for x in db.companions if x["id"] == input_["companionId"]), None)
        if c is None:
            fail("not_found", "Объявление не найдено")
        if c["authorId"] != user["id"]:
            fail("forbidden", "Подбирать место может только автор объявления")
        user_ids = [c["authorId"], *(m["userId"] for m in c["metoo"])]
        if sport_id is None:
            sport_id = c["sportId"]
    else:
        user_ids = [user["id"]]
    counts: dict[ID, int] = {}
    without_district = 0
    for id_ in dict.fromkeys(user_ids):
        # Домашние точки не используем: только район, который человек сам указал в профиле
        district_id = next((u.get("districtId") for u in db.users if u["id"] == id_), None)
        if district_id and any(d["id"] == district_id for d in db.districts):
            counts[district_id] = counts.get(district_id, 0) + 1
        else:
            without_district += 1
    groups = sorted(
        (
            {
                "districtId": district_id,
                "districtName": next(d["name"] for d in db.districts if d["id"] == district_id),
                "people": people,
            }
            for district_id, people in counts.items()
        ),
        key=lambda g: (-g["people"], ru_sort_key(g["districtName"])),
    )
    return {
        "groups": groups,
        "counted": sum(g["people"] for g in groups),
        "withoutDistrict": without_district,
        "sportId": sport_id,
        "event": event,
    }


def _candidate(
    db: store.Database, v: Entity, starts_at: str | None, duration_min: float, event_id: ID | None
) -> dict[str, Any]:
    """Площадка-кандидат: `venue`, `days`, окна на время встречи (`covering`), `freeAtTime`, `price`."""
    days = venue_days(db, v)
    if not starts_at:
        return {
            "venue": v,
            "days": days,
            "covering": None,
            "freeAtTime": None,
            "price": base_price(v, _now_iso()),
        }
    covering = _slots_covering(days, starts_at, duration_min)
    free_at_time = covering is not None and all(
        s["status"] == "free" or (s["status"] == "event" and (s["event"] or {}).get("id") == event_id)
        for s in covering
    )
    price = max(s["price"] for s in covering) if covering is not None else base_price(v, starts_at)
    return {"venue": v, "days": days, "covering": covering, "freeAtTime": free_at_time, "price": price}


def _needs_of(value: Any) -> dict[str, Any]:
    """Условия подбора из запроса: `features`, `indoor`, `priceMax`, `freeAtTime`; неверные значения не учитываются."""
    raw = value if isinstance(value, dict) else {}
    features = raw.get("features")
    indoor = raw.get("indoor")
    return {
        "features": [f for f in features if f in VENUE_FEATURES] if isinstance(features, list) else [],
        "indoor": None if indoor is None else bool(indoor),
        "priceMax": parse_number(raw.get("priceMax")),
        "freeAtTime": bool(raw.get("freeAtTime")),
    }


def _passes(c: dict[str, Any], needs: dict[str, Any]) -> bool:
    venue = c["venue"]
    if not all(f in venue["features"] for f in needs["features"]):
        return False
    if needs["indoor"] is not None and venue["indoor"] != needs["indoor"]:
        return False
    if needs["priceMax"] is not None and c["price"] > needs["priceMax"]:
        return False
    return not (needs["freeAtTime"] and c["freeAtTime"] is False)


FEATURE_WORD = {
    "ramp": "пандус",
    "elevator": "лифт",
    "accessibleToilet": "туалет для маломобильных",
    "accessibleParking": "парковка для маломобильных",
    "lockerRoom": "раздевалка",
    "shower": "душ",
    "lighting": "освещение",
}


def _list_words(words: list[str]) -> str:
    """«пандус, лифт и душ»."""
    if len(words) < 2:
        return "".join(words)
    return f"{', '.join(words[:-1])} и {words[-1]}"


def _relax_hint(pool: list[dict[str, Any]], needs: dict[str, Any]) -> str | None:
    """Какое одно условие мешает больше всего: подсказка вместо пустого списка."""
    variants: list[tuple[str, dict[str, Any]]] = [
        (VENUE_FEATURE[f]["short"], {**needs, "features": [x for x in needs["features"] if x != f]})
        for f in needs["features"]
    ]
    if needs["indoor"] is not None:
        label = "Только крытые" if needs["indoor"] else "Только открытые"
        variants.append((label, {**needs, "indoor": None}))
    if needs["priceMax"] is not None:
        label = f"Аренда до {format_number(needs['priceMax'])}{NBSP}₽ в час"
        variants.append((label, {**needs, "priceMax": None}))
    if needs["freeAtTime"]:
        variants.append(("Свободно в это время", {**needs, "freeAtTime": False}))
    ranked = sorted(
        ((label, sum(_passes(c, relaxed) for c in pool)) for label, relaxed in variants),
        key=lambda item: -item[1],
    )
    if not ranked or ranked[0][1] == 0:
        return None
    label, total = ranked[0]
    word = "площадка" if total == 1 else "площадки" if total < 5 else "площадок"
    return f"Если убрать «{label}», подойдёт {total} {word}."


def _nearest_window(c: dict[str, Any], starts_at: str | None) -> Entity | None:
    """Окно для подсказки: свободное на время встречи, иначе ближайшее в тот же день, иначе ближайшее вообще."""
    if c["covering"] is not None and c["freeAtTime"]:
        return {
            "startsAt": c["covering"][0]["startsAt"],
            "endsAt": c["covering"][-1]["endsAt"],
            "price": c["price"],
        }
    v = c["venue"]
    same_day = venue_moment(starts_at, v["timeZone"]).date().isoformat() if starts_at else None
    merged = merge_windows(
        [s for d in c["days"] if not same_day or d["date"] == same_day for s in d["slots"]]
    )
    if not merged:
        merged = merge_windows([s for d in c["days"] for s in d["slots"]])
    return merged[0] if merged else None


def best_place(db: store.Database, actor: Actor, input_: dict[str, Any]) -> Entity:
    """`input_` — BestPlaceInput: `eventId` или `companionId`, `sportId`, `startsAt`, `durationMin`, `needs`."""
    user = _require_user(actor)
    people = _people_of(db, user, input_)
    needs = _needs_of(input_.get("needs"))
    event = people["event"]
    if event is not None and not _is_upcoming(event):
        fail("event_inactive", "Встреча уже прошла или отменена, подбирать место поздно")
    if event is not None:
        starts_at = event["startsAt"]
        duration_min = event["durationMin"]
    else:
        start = clock.parse(input_.get("startsAt"))
        starts_at = clock.iso(start) if start is not None else None
        duration_min = max(30, parse_number(input_.get("durationMin")) or SLOT_MIN)
    sport_id = _merged_sport(db, people["sportId"]) if people["sportId"] else None

    base = {
        "groups": people["groups"],
        "counted": people["counted"],
        "withoutDistrict": people["withoutDistrict"],
    }
    if not people["groups"]:
        return {
            **base,
            "options": [],
            "matched": 0,
            "relax": "Участники не указали район в профиле, поэтому посчитать расстояния не из чего.",
        }

    public_venues = [v for v in _venues(db) if _is_public(db, v)]
    by_sport = [v for v in public_venues if sport_id in v["sportIds"]] if sport_id else public_venues
    event_id = event["id"] if event is not None else None
    pool = [_candidate(db, v, starts_at, duration_min, event_id) for v in by_sport]
    matched = [c for c in pool if _passes(c, needs)]
    if not matched:
        sport_name = next((s["name"] for s in db.sports if s["id"] == sport_id), None) if sport_id else None
        if pool:
            relax = _relax_hint(pool, needs)
        elif sport_name:
            relax = f"Для направления «{sport_name}» площадок пока нет."
        else:
            relax = "Площадок пока нет."
        return {**base, "options": [], "matched": 0, "relax": relax}

    points = []
    for g in people["groups"]:
        d = next(x for x in db.districts if x["id"] == g["districtId"])
        points.append({**g, "point": {"lat": d["lat"], "lng": d["lng"]}})
    scored = []
    for c in matched:
        distances = [
            {
                "districtId": p["districtId"],
                "districtName": p["districtName"],
                "people": p["people"],
                "km": _distance(p["point"], c["venue"]),
            }
            for p in points
        ]
        # Площадку без координат не с чем сравнить
        if any(d["km"] is None for d in distances):
            continue
        total = sum(d["km"] * d["people"] for d in distances)
        scored.append(
            {
                "c": c,
                "distances": distances,
                "avgKm": round(total / people["counted"], 1),
                "maxKm": max(d["km"] for d in distances),
            }
        )
    if not scored:
        return {**base, "options": [], "matched": len(matched), "relax": None}

    by_avg = sorted(scored, key=lambda s: (s["avgKm"], s["maxKm"]))
    by_max = sorted(scored, key=lambda s: (s["maxKm"], s["avgKm"]))
    picked = [by_avg[0]]
    if by_max[0] is not by_avg[0]:
        picked.append(by_max[0])
    for s in by_avg:
        if len(picked) >= 3:
            break
        if not any(x is s for x in picked):
            picked.append(s)

    several = len(people["groups"]) > 1
    options: list[Entity] = []
    for s in picked:
        c = s["c"]
        v = c["venue"]
        badges: list[str] = []
        if s is by_avg[0]:
            badges.append("Ближе всего в среднем")
        if s["maxKm"] == by_max[0]["maxKm"] and several:
            badges.append("Самому дальнему ближе всего")
        window = _nearest_window(c, starts_at)

        reasons = [
            f"в среднем {_km(s['avgKm'])}, самому дальнему {_km(s['maxKm'])}"
            if several
            else f"{_km(s['avgKm'])} от района {people['groups'][0]['districtName']}"
        ]
        access_here = [f for f in (needs["features"] or ACCESS_FEATURES) if f in v["features"]]
        if access_here:
            reasons.append(f"есть {_list_words([FEATURE_WORD[f] for f in access_here])}")
        if c["freeAtTime"] and window is not None:
            reasons.append(f"свободно {window_label(window, v['timeZone'])}")
        elif c["freeAtTime"] is False:
            reasons.append(
                f"в это время занято, ближайшее окно {window_label(window, v['timeZone'])}"
                if window is not None
                else "в это время занято"
            )
        elif window is not None:
            reasons.append(f"ближайшее свободное окно {window_label(window, v['timeZone'])}")
        reasons.append(f"аренда {hour_price(c['price'])}" if c["price"] > 0 else "бесплатно")

        options.append(
            {
                "venue": venue_view(db, user, v, {"days": c["days"]}),
                "avgKm": s["avgKm"],
                "maxKm": s["maxKm"],
                "distances": s["distances"],
                "reasons": reasons,
                "summary": "; ".join(reasons),
                "badges": badges,
                "window": window,
                "freeAtTime": c["freeAtTime"],
                "isCurrent": event is not None and event.get("venueId") == v["id"],
            }
        )
    return {**base, "options": options, "matched": len(matched), "relax": None}
