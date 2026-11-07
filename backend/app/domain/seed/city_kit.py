"""Сборка демо-данных города из описания: люди, клубы, площадки, встречи, записи, обсуждения,
«Ищу компанию», вещи на полке и история спроса.

Описание города — модуль с таблицами (см. city_moscow.py). Всё дописывается в общие списки сида,
поэтому записи остаются демо-записями: их ключи попадают в `settings.seedIds`.
Номера записей с префиксом города через дефис (`p-msk-12`) не совпадут с номерами,
которые выдаёт счётчик (`p-7pt`).
"""

import random
import zlib
from collections.abc import Callable
from datetime import datetime, time, timedelta
from types import ModuleType
from typing import Any

from app.domain import clock
from app.domain.features.analytics import AUDIENCE_WORD, PART_WORDS, SPORT_WORD
from app.domain.lib.text import normalize
from app.domain.lib.venues import local_date, slot_starts
from app.domain.seed.city_photos import avatar, cover, item, logo
from app.domain.types import Entity

HOUR = 60
DAY = 24 * HOUR

# Доля занятых окон площадки, в процентах (как у площадок Красноярска).
_BUSY = {"hall": 45, "court": 40, "pool": 50, "ice": 55, "studio": 35, "field": 35, "yard": 10, "park": 0}

# Записки к заявкам на встречи «по заявке»: по очереди, чтобы не повторяться подряд.
_NOTES = [
    "Играл(а) раньше, давно не было практики.",
    "Хожу на такие встречи пару раз в месяц, уровень средний.",
    "Новичок, но очень хочу попробовать.",
    "Занимаюсь второй год, могу подстроиться под любую команду.",
    "Приду с другом, если будет второе место, напишу.",
]


def _hash(text: str) -> int:
    return zlib.crc32(text.encode())


def seed_city(spec: ModuleType, ctx: dict[str, Any]) -> None:
    """Дописывает город `spec` в коллекции `ctx`.

    `ctx`: now, ago, users, organizations, events, participations, messages, companions, venues, shelf,
    districts, demand_log.
    """
    now: datetime = ctx["now"]
    ago: Callable[[float], str] = ctx["ago"]
    tz: str = spec.TZ
    prefix: str = spec.PREFIX
    today = clock.local(now, tz).date()

    def at(day: int, hhmm: str) -> str:
        hour, minute = (int(x) for x in hhmm.split(":"))
        moment = datetime.combine(today + timedelta(days=day), time(hour, minute), tzinfo=clock.zone_info(tz))
        return clock.iso(moment)

    ctx["districts"].extend({"id": d[0], "name": d[1], "lat": d[2], "lng": d[3]} for d in spec.DISTRICTS)
    districts = {d[0]: d for d in spec.DISTRICTS}

    def home(district_id: str) -> Entity:
        d = districts[district_id]
        return {"lat": d[2], "lng": d[3]}

    # ---------- Люди ----------
    people: list[Entity] = []
    for p in spec.PEOPLE:
        levels: dict[str, str] = dict(p["levels"])
        people.append(
            {
                "id": p["id"],
                "name": p["name"],
                "avatarUrl": avatar(p["photo"]),
                "age": p["age"],
                "role": "user",
                "city": spec.CITY,
                "districtId": p["district"],
                "about": p["about"],
                "interests": list(levels),
                "levels": levels,
                "readiness": p.get("readiness"),
                "home": home(p["district"]),
                "radiusKm": p.get("radius", 5),
                "email": f"{p['id'][2:]}@vmeste.demo",
                "phone": "",
                "demo": None,
                "createdAt": ago((30 + _hash(p["id"]) % 300) * DAY),
                "gender": p["gender"],
            }
        )
    ctx["users"].extend(people)
    by_id = {u["id"]: u for u in people}

    # ---------- Клубы и сообщества ----------
    orgs: dict[str, Entity] = {}
    for o in spec.ORGS:
        days = o.get("days", 60 + _hash(o["id"]) % 200)
        orgs[o["id"]] = {
            "id": o["id"],
            "name": o["name"],
            "type": o["type"],
            "description": o["description"],
            "sportIds": o["sports"],
            "city": spec.CITY,
            "districtId": o["district"],
            "address": o["address"],
            "contacts": {"phone": "", "email": o.get("email", ""), "social": ""},
            "logoUrl": logo(o["logo"]),
            "coverUrl": cover(o["cover"]),
            "ownerId": o["owner"],
            "status": "approved",
            "reviews": [
                {
                    "id": f"rv-{o['id']}-s",
                    "decision": "submitted",
                    "reason": "",
                    "adminId": None,
                    "at": ago(days * DAY),
                },
                {
                    "id": f"rv-{o['id']}-a",
                    "decision": "approved",
                    "reason": "",
                    "adminId": "u-maria",
                    "at": ago(days * DAY - 5 * HOUR),
                },
            ],
            "createdWithAssistant": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(days * DAY + HOUR),
            "updatedAt": ago(days * DAY - 5 * HOUR),
        }
    ctx["organizations"].extend(orgs.values())

    # ---------- Площадки ----------
    venues: dict[str, Entity] = {}
    for v in spec.VENUES:
        venue: Entity = {
            "id": v["id"],
            "orgId": v["org"],
            "name": v["name"],
            "kind": v["kind"],
            "description": v["description"],
            "address": v["address"],
            "landmark": v["landmark"],
            "districtId": v["district"],
            "lat": v["lat"],
            "lng": v["lng"],
            "sportIds": v["sports"],
            "indoor": v["indoor"],
            "pricePerHour": v["price"],
            "peakPricePerHour": v.get("peak"),
            "features": v["features"],
            "photoUrl": cover(v["photo"]),
            "contacts": {"phone": "", "email": orgs[v["org"]]["contacts"]["email"], "site": ""},
            "hours": {"open": v["hours"][0], "close": v["hours"][1]},
            "timeZone": tz,
            "slots": [],
            "status": "active",
            "ownerUpdatedAt": ago((_hash(v["id"]) % 6) * DAY + 3 * HOUR),
            "createdAt": ago(90 * DAY),
        }
        busy = _BUSY[venue["kind"]]
        for day in range(15):
            for i, starts_at in enumerate(slot_starts(venue, local_date(now, tz, day))):
                if _hash(f"{venue['id']}:{day}:{i}") % 100 < busy:
                    venue["slots"].append({"startsAt": starts_at, "free": False, "price": None})
        venues[v["id"]] = venue
    ctx["venues"].extend(venues.values())

    # ---------- Встречи ----------
    def place_of(e: Entity) -> Entity:
        if e.get("venue"):
            v = venues[e["venue"]]
            return {
                "address": v["address"],
                "landmark": v["landmark"],
                "districtId": v["districtId"],
                "lat": v["lat"],
                "lng": v["lng"],
            }
        address, district_id, lat, lng, landmark = spec.PLACES[e["place"]]
        return {"address": address, "landmark": landmark, "districtId": district_id, "lat": lat, "lng": lng}

    def price_of(value: Any) -> Entity:
        if value is None:
            return {"kind": "free"}
        if isinstance(value, int):
            return {"kind": "fixed", "amount": value}
        _, total, note = value
        return {"kind": "split", "total": total, "note": note}

    def organizer_user(by: str) -> str:
        return orgs[by]["ownerId"] if by.startswith("o-") else by

    p_seq = 0
    note_seq = 0
    city_people = [u["id"] for u in people]

    def fill(e: Entity, going: int, pending: int) -> None:
        nonlocal p_seq, note_seq
        host = organizer_user(e["by"])
        candidates = sorted(
            (uid for uid in city_people if uid != host),
            key=lambda uid: (e["sport"] not in by_id[uid]["levels"], _hash(f"{e['id']}|{uid}")),
        )
        for i, uid in enumerate(candidates[: going + pending]):
            p_seq += 1
            waiting = i >= going
            note = ""
            if waiting:
                note = _NOTES[note_seq % len(_NOTES)]
                note_seq += 1
            joined = 5 * DAY - (_hash(f"{e['id']}:{uid}") % (4 * DAY))
            ctx["participations"].append(
                {
                    "id": f"p-{prefix}-{p_seq}",
                    "eventId": e["id"],
                    "userId": uid,
                    "status": "pending" if waiting else "confirmed",
                    "prevStatus": None,
                    "note": note,
                    "rejectReason": "",
                    "source": "self",
                    "createdAt": ago(joined),
                    "decidedAt": None if waiting else ago(joined - 30),
                }
            )

    def first_day(e: Entity) -> int:
        """Ближайший день недели `dow` (1 — пн … 7 — вс) не раньше завтрашнего, плюс `later` недель."""
        return ((e["dow"] - today.isoweekday()) % 7 or 7) + 7 * e.get("later", 0)

    def soon(hours: float) -> str:
        """Сегодня, через `hours` часов от сборки сида: начало на ближайшие :00 или :30."""
        moment = now + timedelta(hours=hours)
        moment = moment.replace(second=0, microsecond=0) + timedelta(minutes=(30 - moment.minute % 30) % 30)
        return clock.iso(moment)

    for e in spec.EVENTS:
        weeks = e.get("series", 1)
        day = first_day(e) if "dow" in e else 0
        series = (
            {"id": f"series-{e['id']}", "rule": "weekly", "until": at(day + 7 * (weeks - 1), "23:59")}
            if weeks > 1
            else None
        )
        step = {
            "intensity": "medium",
            "bring": "",
            "preparation": "",
            "age": "",
            "howToFind": "",
            "amenities": [],
            "firstTimeNote": "",
            **e.get("step", {}),
        }
        for week in range(weeks):
            id_ = e["id"] if week == 0 else f"{e['id']}-w{week + 1}"
            created = e.get("created", 2 + _hash(e["id"]) % 9) * DAY
            record: Entity = {
                "id": id_,
                "title": e["title"],
                "sportId": e["sport"],
                "organizer": {"kind": "org" if e["by"].startswith("o-") else "user", "id": e["by"]},
                "createdBy": organizer_user(e["by"]),
                "startsAt": soon(e["soon"]) if "soon" in e else at(day + 7 * week, e["time"]),
                "durationMin": e.get("duration", 90),
                "place": place_of(e),
                "description": e["description"],
                "level": e.get("level", "any"),
                "beginnersWelcome": e.get("beginners", False),
                "firstStep": step,
                "price": price_of(e.get("price")),
                "paymentNote": e.get("payNote", ""),
                "cancelPolicy": e.get("cancel", {"kind": "anytime"}),
                "joinMode": e.get("join", "open"),
                "capacity": e.get("cap"),
                "minParticipants": e.get("min"),
                "status": "published",
                "moderation": None,
                "cancelReason": "",
                "changes": [],
                "series": series,
                "privateInfo": e.get("private", ""),
                "discussion": "everyone",
                "extra": e.get("extra", {}),
                "coverUrl": cover(e["cover"]),
                "createdWithAssistant": False,
                "aiFlag": "none",
                "aiReason": "",
                "createdAt": ago(created),
                "updatedAt": ago(created),
                "venueId": e.get("venue"),
                "accessExtras": e.get("access", []),
            }
            if e.get("online"):
                record["paymentMode"] = "online"
                record["paymentNote"] = "Оплата на сайте"
            ctx["events"].append(record)
            going = e.get("going", 0)
            # В повторах серии записей чуть меньше: до них дальше
            fill(record | {"by": e["by"], "sport": e["sport"]}, max(0, going - 2 * week), e.get("pending", 0))

    # ---------- Обсуждения ----------
    m_seq = 0
    for event_id, lines in spec.CHATS.items():
        ids: list[str] = []
        for author, text, minutes_ago, reply in lines:
            m_seq += 1
            id_ = f"m-{prefix}-{m_seq}"
            as_org = author.startswith("o-")
            ctx["messages"].append(
                {
                    "id": id_,
                    "eventId": event_id,
                    "authorId": orgs[author]["ownerId"] if as_org else author,
                    "asOrgId": author if as_org else None,
                    "text": text,
                    "replyTo": ids[reply] if reply is not None else None,
                    "reactions": {},
                    "status": "visible",
                    "hiddenReason": "",
                    "system": False,
                    "aiFlag": "none",
                    "aiReason": "",
                    "createdAt": ago(minutes_ago),
                }
            )
            ids.append(id_)

    # ---------- «Ищу компанию» ----------
    for c in spec.COMPANIONS:
        minutes = c["hours"] * HOUR
        ctx["companions"].append(
            {
                "id": c["id"],
                "authorId": c["author"],
                "sportId": c["sport"],
                "text": c["text"],
                "districtId": c["district"],
                "point": home(c["district"]),
                "when": c["when"],
                "level": c.get("level", "beginner"),
                "readiness": c.get("readiness", "join"),
                "metoo": [
                    {"userId": uid, "at": ago(max(5, minutes - (i + 1) * 47))}
                    for i, uid in enumerate(c["metoo"])
                ],
                "status": "open",
                "eventId": None,
                "createdWithAssistant": False,
                "createdAt": ago(minutes),
            }
        )

    # ---------- Полка ----------
    for s in spec.SHELF:
        owner = s["owner"]
        record = {
            "id": s["id"],
            "owner": {"kind": "org" if owner.startswith("o-") else "user", "id": owner},
            "createdBy": organizer_user(owner),
            "note": s.get("note", ""),
            "name": s["name"],
            "kind": s["kind"],
            "sportId": s.get("sport"),
            "quantity": s.get("qty", 1),
            "condition": s.get("condition", "good"),
            "districtId": s["district"],
            "terms": s.get("terms", ["return_after", "no_deposit"]),
            "photoUrl": item(s["photo"]),
            "createdAt": ago(s.get("days", 10) * DAY),
            "updatedAt": ago(s.get("days", 10) * DAY),
        }
        if s.get("sale"):
            record["sale"] = {"price": s["sale"]}
        ctx["shelf"].append(record)

    # ---------- История спроса за 30 дней (для аналитики) ----------
    rng = random.Random(_hash(spec.CITY))
    names = {d[0]: normalize(d[1]) for d in spec.DISTRICTS}
    weights = [p[2] for p in spec.DEMAND]
    local_now = clock.local(now, tz)
    n = 0
    for day in range(29, -1, -1):
        date = local_now - timedelta(days=day)
        for _ in range(6 + rng.randint(0, 4) + (3 if date.isoweekday() in {5, 6} else 0)):
            district_id, sport_id, weight, audience, free = rng.choices(spec.DEMAND, weights)[0]
            roll = rng.random()
            kind = "search" if roll < 0.58 else "phrase" if roll < 0.83 else "waitlist"
            moment = date.replace(hour=rng.randint(8, 21), minute=rng.randrange(60), second=0, microsecond=0)
            if moment > local_now:
                continue
            n += 1
            entry: Entity = {
                "id": f"dl-{prefix}-{n}",
                "at": clock.iso(moment),
                "kind": kind,
                "sportId": sport_id,
                "districtId": district_id,
            }
            tail = AUDIENCE_WORD[audience] if audience and rng.random() < 0.6 else rng.choice(PART_WORDS)
            where = f" {names[district_id]}" if rng.random() < 0.4 else ""
            if kind == "phrase" or (kind == "search" and rng.random() < 0.3):
                entry["phrase"] = f"{SPORT_WORD.get(sport_id, '')} {tail}{where}".strip()
            entry["audience"] = [audience] if audience else []
            if free and rng.random() < 0.6:
                entry["free"] = True
            if kind == "search":
                entry["results"] = 0 if rng.random() < 0.12 + weight / 40 else rng.randint(1, 5)
            entry["demo"] = True
            ctx["demand_log"].append(entry)
