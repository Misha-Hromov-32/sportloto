"""В6 «Спрос и инфраструктура».

Один слой спроса на всю платформу:
- «Ищу компанию», «Я тоже» и неудачные поиски подбора — группы спроса С2 (`demand.py`),
  те же, что видит клуб в «Спросе рядом», поэтому цифры совпадают;
- поиски в ленте и фразы помощнику — журнал `demand_log` (без человека, только что и где искали);
- «мест нет» — записи в лист ожидания;
- поиск в ленте без результата по направлению уходит в сигналы С2, как и неудачный подбор.
Предложение — встречи на 30 дней вперёд и свободные окна площадок (В4). Только агрегаты.
"""

import json
import random
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.schema import COLLECTIONS
from app.domain.features import demand, reports, venues
from app.domain.features.imports import scrub_text
from app.domain.features.kit import db
from app.domain.lib.text import normalize
from app.domain.lib.venues import ACCESS_FEATURES
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

DAYS = 30
LOG_LIMIT = 3000
DEDUP = timedelta(minutes=10)
MIN_PHRASE = 2
SUPPLY_DAYS = 30
WINDOW_DAYS = 7

# Повторы поиска — в памяти процесса
_recent: dict[str, datetime] = {}


def _log() -> list[Entity]:
    return db().demand_log


def _seen(key: str) -> bool:
    now = clock.now()
    last = _recent.get(key)
    _recent[key] = now
    return last is not None and now - last < DEDUP


def _actor_district(actor: Actor, district_id: ID | None) -> ID | None:
    """Район из фильтра, а без него — район из профиля."""
    return district_id if district_id is not None else (actor or {}).get("districtId")


def _day(iso: str) -> str | None:
    """Местная дата момента («2026-10-19»); None, если это не дата."""
    moment = clock.parse(iso)
    return None if moment is None else f"{clock.local(moment):%Y-%m-%d}"


def _since(iso: str, start: datetime) -> bool:
    """Момент `iso` не раньше `start`."""
    moment = clock.parse(iso)
    return moment is not None and moment >= start


AUDIENCE_RE: list[tuple[str, re.Pattern[str]]] = [
    ("senior", re.compile(r"пенси|пожил|старш\S* поколен|бабушк|дедушк|60\+|за 60|ветеран")),
    ("kids", re.compile(r"дет|ребен|ребён|школьн|подрост|малыш")),
    ("inclusive", re.compile(r"коляс|инвалид|пандус|незряч|слабовид|глух|овз|маломобил|сопровожден")),
]


def audience_of(text: str, access: Any = None) -> list[str]:
    t = normalize(text)
    out = [a for a, rx in AUDIENCE_RE if rx.search(t)]
    if isinstance(access, list) and access and "inclusive" not in out:
        out.append("inclusive")
    return out


_HIDDEN = re.compile(r"\[[^\]]*скрыт[ао]?\]")
_LONG_NUMBER = re.compile(r"[0-9]{5,}")
_SPACES = re.compile(r"\s+")


def _clean_phrase(text: str) -> str:
    """Фраза для журнала: без телефонов, почты и длинных чисел."""
    return _SPACES.sub(" ", _LONG_NUMBER.sub("", normalize(_HIDDEN.sub("", scrub_text(text))))).strip()[:80]


def _push(entry: dict[str, Any]) -> None:
    lst = _log()
    lst.append({"id": store.next_id("dl"), **entry})
    if len(lst) > LOG_LIMIT:
        db().demand_log = lst[-LOG_LIMIT:]


FEED_SCOPES = [None, "feed"]


def record_feed_search(d: "Domain", actor: Actor, p: dict[str, Any], results: int) -> None:
    """Поиск в ленте: фильтры и текст. Вызывается на каждый запрос списка, поэтому повторы глушим."""
    if (actor or {}).get("role") == "admin":
        return
    if (
        p.get("scope") not in FEED_SCOPES
        or p.get("ids") is not None
        or p.get("orgId")
        or p.get("organizerUserId")
        or p.get("forYou")
    ):
        return
    sport_ids: list[ID] = (
        p["sportIds"] if isinstance(p.get("sportIds"), list) else ([p["sportId"]] if p.get("sportId") else [])
    )
    q = _clean_phrase(p["q"]) if isinstance(p.get("q"), str) else ""
    access = p["access"] if isinstance(p.get("access"), list) else []
    if not q and not sport_ids and not p.get("districtId") and not p.get("free") and not access:
        return
    district_id = _actor_district(actor, p.get("districtId"))
    sig = json.dumps(
        [
            actor["id"] if actor else "guest",
            q,
            sport_ids,
            district_id,
            p.get("free"),
            access,
            p.get("when"),
            p.get("dayPart"),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if _seen(f"search|{sig}"):
        return
    entry: dict[str, Any] = {
        "at": clock.iso(clock.now()),
        "kind": "search",
        "sportId": sport_ids[0] if sport_ids else None,
        "districtId": district_id,
    }
    if q:
        entry["phrase"] = q
    entry["audience"] = audience_of(q, access)
    if p.get("free"):
        entry["free"] = True
    entry["results"] = results
    _push(entry)
    if results == 0 and sport_ids and sport_ids[0]:
        # Пустая выдача по направлению — тот же сигнал, что и неудачный подбор помощника
        demand.record_search_demand(d, actor, {**p, "sportIds": sport_ids}, None)


def record_phrase(d: "Domain", actor: Actor, text: str, filters: dict[str, Any] | None = None) -> None:  # noqa: ARG001
    """Фраза помощнику («бадминтон вечером на Взлётке»)."""
    filters = filters or {}
    if (actor or {}).get("role") == "admin":
        return
    phrase = _clean_phrase(text)
    if len(phrase) < 3:
        return
    if _seen(f"phrase|{actor['id'] if actor else 'guest'}|{phrase}"):
        return
    sport_ids = filters.get("sportIds")
    entry: dict[str, Any] = {
        "at": clock.iso(clock.now()),
        "kind": "phrase",
        "sportId": sport_ids[0] if sport_ids else None,
        "districtId": _actor_district(actor, filters.get("districtId")),
        "phrase": phrase,
        "audience": audience_of(phrase),
    }
    if filters.get("free"):
        entry["free"] = filters["free"]
    _push(entry)


# ---------- Сводка ----------


def _blank() -> dict[str, int]:
    return {"demand": 0, "unmet": 0, "vulnerable": 0}


def _price_of(e: Entity) -> float | None:
    if e["price"]["kind"] == "fixed":
        return e["price"]["amount"]
    if e["price"]["kind"] == "split":
        return round(e["price"]["total"] / e["capacity"]) if e.get("capacity") else None
    return None


def _norm(v: float, max_: float) -> float:
    return v / max_ if max_ > 0 else 0


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def analytics_view(d: "Domain", actor: Actor) -> Entity:
    reports.require_admin(actor)
    now = clock.now()
    from_ = now - timedelta(days=DAYS)
    districts = db().districts
    by_district: dict[ID, dict[str, int]] = {x["id"]: _blank() for x in districts}
    by_sport: dict[ID, int] = {}
    cells: dict[str, int] = {}
    today = clock.local(now).date()
    daily: dict[str, dict[str, int]] = {
        (today - timedelta(days=i)).isoformat(): {"demand": 0, "live": 0} for i in range(DAYS - 1, -1, -1)
    }
    totals = {
        "search": 0,
        "phrase": 0,
        "companion": 0,
        "waitlist": 0,
        "failed": 0,
        "events": 0,
        "venues": 0,
        "freeWindows": 0,
    }
    phrases: dict[str, int] = {}
    filters: dict[str, int] = {}
    entries = {"demo": 0, "live": 0}

    def add(
        kind: str,
        sport_id: ID | None,
        district_id: ID | None,
        weight: int,
        o: dict[str, Any] | None = None,
    ) -> None:
        o = o or {}
        totals[kind] += weight
        if sport_id:
            by_sport[sport_id] = by_sport.get(sport_id, 0) + weight
        acc = by_district.get(district_id) if district_id else None
        if acc is not None:
            acc["demand"] += weight
            if o.get("unmet"):
                acc["unmet"] += weight
            if o.get("vulnerable"):
                acc["vulnerable"] += weight
        if sport_id and district_id:
            cells[f"{district_id}|{sport_id}"] = cells.get(f"{district_id}|{sport_id}", 0) + weight
        if o.get("at"):
            day = daily.get(_day(o["at"]))
            if day is not None:
                day["demand"] += weight
                if not o.get("demo"):
                    day["live"] += weight
        if o.get("demo"):
            entries["demo"] += weight
        else:
            entries["live"] += weight

    for e in _log():
        if not _since(e["at"], from_):
            continue
        add(
            e["kind"],
            e.get("sportId"),
            e.get("districtId"),
            1,
            {
                "at": e["at"],
                "unmet": e["kind"] == "waitlist" or e.get("results") == 0,
                "vulnerable": bool(e.get("audience") or e.get("free")),
                "demo": e.get("demo"),
            },
        )
        if e.get("phrase"):
            phrases[e["phrase"]] = phrases.get(e["phrase"], 0) + 1
        if e["kind"] == "search":
            if e.get("sportId"):
                name = d.sport_view(e["sportId"])["name"]
                filters[name] = filters.get(name, 0) + 1
            if e.get("free"):
                filters["Только бесплатные"] = filters.get("Только бесплатные", 0) + 1
            if "inclusive" in (e.get("audience") or []):
                filters["Доступная среда"] = filters.get("Доступная среда", 0) + 1

    # «Мест нет»: записи в лист ожидания за период
    for p in db().participations:
        if p["status"] != "waitlist" or not _since(p["createdAt"], from_):
            continue
        e = db().record("events", p["eventId"])
        if e is None:
            continue
        add(
            "waitlist",
            e["sportId"],
            e["place"].get("districtId"),
            1,
            {"at": p["createdAt"], "unmet": True, "vulnerable": e["price"]["kind"] == "free"},
        )

    # Группы спроса С2: «Ищу компанию», «Я тоже», неудачные поиски — как в «Спросе рядом»
    for g in demand.demand_groups_for_analytics(d):
        companion = min(g["fromCompanions"], g["people"])
        failed = g["people"] - companion
        if companion:
            add("companion", g["sportId"], g["districtId"], companion, {"unmet": True})
        if failed:
            add("failed", g["sportId"], g["districtId"], failed, {"unmet": True})
    for c in db().companions:
        if c["status"] != "open" or not _since(c["createdAt"], from_):
            continue
        day = daily.get(_day(c["createdAt"]))
        if day is not None:
            day["demand"] += 1 + len(c["metoo"])
            day["live"] += 1 + len(c["metoo"])
    for s in db().demand_signals:
        day = daily.get(_day(s["at"])) if _since(s["at"], from_) else None
        if day is not None:
            day["demand"] += 1
            day["live"] += 1

    # Предложение: встречи на месяц вперёд и окна площадок на неделю
    until = now + timedelta(days=SUPPLY_DAYS)
    def supply_event(event):
        start = clock.parse(event["startsAt"])
        return event["status"] == "published" and start is not None and now <= start <= until
    upcoming = db().records("events", COLLECTIONS["events"].table.c.status == "published",
                            COLLECTIONS["events"].table.c.starts_at.between(now, until), predicate=supply_event)
    totals["events"] = len(upcoming)
    supply: dict[ID, list[Entity]] = {}
    sport_events: dict[ID, int] = {}
    cell_events: dict[str, int] = {}
    for e in upcoming:
        sport_events[e["sportId"]] = sport_events.get(e["sportId"], 0) + 1
        district_id = e["place"].get("districtId")
        if not district_id:
            continue
        supply[district_id] = [*supply.get(district_id, []), e]
        key = f"{district_id}|{e['sportId']}"
        cell_events[key] = cell_events.get(key, 0) + 1
    venue_list = [v for v in db().venues if v["status"] == "active"]
    venue_stats: dict[ID, dict[str, int]] = {}
    for v in venue_list:
        if not v.get("districtId"):
            continue
        free = 0
        for day in venues.venue_days(db(), v, WINDOW_DAYS):
            free += day["freeCount"]
        st = venue_stats.get(v["districtId"]) or {"venues": 0, "freeWindows": 0, "noAccess": 0}
        st["venues"] += 1
        st["freeWindows"] += free
        if not any(f in ACCESS_FEATURES for f in v["features"]):
            st["noAccess"] += 1
        venue_stats[v["districtId"]] = st
        totals["freeWindows"] += free
    totals["venues"] = len(venue_list)

    def confirmed(id_: ID) -> int:
        return sum(1 for p in db().participations if p["eventId"] == id_ and p["status"] == "confirmed")

    def no_access(e: Entity) -> bool:
        access = venues.event_venue_fields(db(), e)["access"]
        return not access["venue"] and "escort" not in access["extras"]

    raw: list[Entity] = []
    for x in districts:
        acc = by_district[x["id"]]
        lst = supply.get(x["id"], [])
        paid = [e for e in lst if e["price"]["kind"] != "free"]
        prices = [n for n in (_price_of(e) for e in paid) if n is not None]
        fills = [min(1, confirmed(e["id"]) / e["capacity"]) for e in paid if e.get("capacity")]
        vs = venue_stats.get(x["id"]) or {"venues": 0, "freeWindows": 0, "noAccess": 0}
        no_access_events = sum(1 for e in lst if no_access(e))
        raw.append(
            {
                "id": x["id"],
                "name": x["name"],
                "demand": acc["demand"],
                "unmet": acc["unmet"],
                "vulnerable": acc["vulnerable"],
                "events": len(lst),
                "freeEvents": len(lst) - len(paid),
                "paidEvents": len(paid),
                "avgPrice": round(avg_price) if (avg_price := _mean(prices)) is not None else None,
                "paidFill": _mean(fills),
                "seats": sum(e.get("capacity") or 0 for e in lst),
                "venues": vs["venues"],
                "freeWindows": vs["freeWindows"],
                "venuesNoAccess": vs["noAccess"],
                "eventsNoAccess": no_access_events,
                "gap": round(acc["demand"] / max(1, len(lst)), 1),
                "commercial": 0,
                "social": 0,
            }
        )

    def max_of(f: Callable[[Entity], float]) -> float:
        return max((f(r) for r in raw), default=0)

    max_demand = max_of(lambda r: r["demand"])
    max_paid = max_of(lambda r: r["paidEvents"])
    max_price = max_of(lambda r: r["avgPrice"] or 0)
    max_unmet = max_of(lambda r: r["unmet"])
    max_vuln = max_of(lambda r: r["vulnerable"])
    for r in raw:
        # Коммерческий спрос: сколько ищут, есть ли платные встречи, как они заполняются и сколько стоят
        r["commercial"] = round(
            100
            * (
                0.4 * _norm(r["demand"], max_demand)
                + 0.3 * (r["paidFill"] or 0)
                + 0.2 * _norm(r["paidEvents"], max_paid)
                + 0.1 * _norm(r["avgPrice"] or 0, max_price)
            )
        )
        # Общественная потребность: неудовлетворённые запросы, старшие, дети, инклюзия, мало бесплатного и доступного
        free_share = r["freeEvents"] / r["events"] if r["events"] else 0
        access_share = 1 - r["eventsNoAccess"] / r["events"] if r["events"] else 0
        r["social"] = round(
            100
            * (
                0.4 * _norm(r["unmet"], max_unmet)
                + 0.3 * _norm(r["vulnerable"], max_vuln)
                + 0.15 * (1 - free_share if r["demand"] else 0)
                + 0.15 * (1 - access_share if r["demand"] else 0)
            )
        )

    sports = sorted(
        (
            {"id": id_, "name": d.sport_view(id_)["name"], "demand": n, "events": sport_events.get(id_, 0)}
            for id_, n in by_sport.items()
        ),
        key=lambda s: -s["demand"],
    )
    out_cells: list[Entity] = []
    for r in raw:
        for s in sports:
            n = cells.get(f"{r['id']}|{s['id']}", 0)
            events = cell_events.get(f"{r['id']}|{s['id']}", 0)
            if not n and not events:
                continue
            out_cells.append(
                {
                    "districtId": r["id"],
                    "sportId": s["id"],
                    "demand": n,
                    "events": events,
                    "gap": round(n / max(1, events), 1),
                }
            )

    return {
        "days": DAYS,
        "from": clock.iso(from_),
        "to": clock.iso(now),
        "demoEntries": entries["demo"],
        "liveEntries": entries["live"],
        "totals": totals,
        "daily": [{"date": date, **v} for date, v in daily.items()],
        "phrases": [
            {"text": text, "count": count}
            for text, count in sorted(
                ((t, c) for t, c in phrases.items() if c >= MIN_PHRASE), key=lambda item: -item[1]
            )[:10]
        ],
        "filters": [
            {"label": label, "count": count}
            for label, count in sorted(filters.items(), key=lambda item: -item[1])[:8]
        ],
        "districts": sorted(raw, key=lambda r: -r["demand"]),
        "sports": sports,
        "cells": out_cells,
        "venuesAvailable": len(venue_list) > 0,
    }


# ---------- Демонстрационная история спроса за 30 дней ----------


# Профиль: район, направление, вес, аудитория, бесплатно.
# Где и что ищут чаще: спальные районы — игры и дети, Академгородок — старшее поколение.
PROFILES: list[tuple[ID, ID, int, str | None, bool]] = [
    ("d-vzlet", "s-badminton", 9, None, False),
    ("d-vzlet", "s-football", 7, None, True),
    ("d-vzlet", "s-volleyball", 4, None, False),
    ("d-solnech", "s-football", 7, "kids", True),
    ("d-solnech", "s-workout", 4, "kids", True),
    ("d-solnech", "s-basketball", 3, None, True),
    ("d-akadem", "s-nordic", 8, "senior", True),
    ("d-akadem", "s-chess", 4, "senior", True),
    ("d-akadem", "s-skiing", 3, None, False),
    ("d-center", "s-yoga", 5, None, False),
    ("d-center", "s-running", 5, None, True),
    ("d-center", "s-tennis", 4, None, False),
    ("d-oct", "s-swimming", 4, "inclusive", False),
    ("d-oct", "s-running", 3, None, True),
    ("d-sov", "s-football", 4, "kids", True),
    ("d-sov", "s-hockey", 3, "kids", False),
    ("d-kirov", "s-nordic", 4, "senior", True),
    ("d-kirov", "s-tabletennis", 2, None, False),
    ("d-lenin", "s-football", 3, "kids", True),
    ("d-lenin", "s-boxing", 2, None, False),
    ("d-sverd", "s-cycling", 3, None, True),
    ("d-sverd", "s-hiking", 2, None, True),
    ("d-north", "s-chess", 2, "kids", True),
    ("d-north", "s-dance", 2, None, False),
    ("d-zhd", "s-tennis", 3, None, False),
    ("d-zhd", "s-yoga", 2, None, False),
    ("d-pokrovka", "s-taichi", 2, "senior", True),
    ("d-pokrovka", "s-badminton", 2, None, False),
    ("d-vetluzh", "s-skiing", 3, None, False),
    ("d-vetluzh", "s-swimming", 2, "inclusive", False),
]

SPORT_WORD: dict[str, str] = {
    "s-badminton": "бадминтон",
    "s-football": "футбол",
    "s-volleyball": "волейбол",
    "s-workout": "зарядка",
    "s-basketball": "баскетбол",
    "s-nordic": "скандинавская ходьба",
    "s-chess": "шахматы",
    "s-skiing": "лыжи",
    "s-yoga": "йога",
    "s-running": "пробежка",
    "s-tennis": "теннис",
    "s-swimming": "бассейн",
    "s-hockey": "хоккей",
    "s-tabletennis": "настольный теннис",
    "s-boxing": "бокс",
    "s-cycling": "велопрогулка",
    "s-hiking": "поход",
    "s-dance": "танцы",
    "s-taichi": "тайцзи",
}

AUDIENCE_WORD: dict[str, str] = {
    "senior": "для пенсионеров",
    "kids": "для детей",
    "inclusive": "с сопровождением",
}

PART_WORDS = ["вечером", "в выходные", "утром", "для начинающих", "рядом"]


def seed_demand_log(input_: dict[str, Any]) -> list[Entity]:
    """История спроса за 30 дней. `input_`: now (`datetime` или мс эпохи), districts.

    Случайные числа — от постоянного зерна: история одинакова при каждом сбросе демо-данных.
    """
    rng = random.Random(20261019)
    weights = [p[2] for p in PROFILES]
    names = {x["id"]: normalize(x["name"]) for x in input_["districts"]}
    now = input_["now"]
    today = clock.local(now)
    out: list[Entity] = []
    for day in range(DAYS - 1, -1, -1):
        date = today - timedelta(days=day)
        # Будни чуть активнее, к выходным спрос растёт
        per_day = 14 + rng.randint(0, 8) + (6 if date.isoweekday() in {5, 6} else 0)
        for _ in range(per_day):
            district_id, sport_id, weight, audience, free = rng.choices(PROFILES, weights)[0]
            roll = rng.random()
            kind = "search" if roll < 0.58 else "phrase" if roll < 0.83 else "waitlist"
            at = date.replace(hour=rng.randint(8, 21), minute=rng.randrange(60), second=0, microsecond=0)
            if at > now:
                continue
            tail = AUDIENCE_WORD[audience] if audience and rng.random() < 0.6 else rng.choice(PART_WORDS)
            place = f" {names.get(district_id, '')}" if rng.random() < 0.4 else ""
            entry: Entity = {
                "id": f"dl-{len(out) + 1}",
                "at": clock.iso(at),
                "kind": kind,
                "sportId": sport_id,
                "districtId": district_id,
            }
            if kind == "phrase" or (kind == "search" and rng.random() < 0.3):
                entry["phrase"] = f"{SPORT_WORD.get(sport_id, '')} {tail}{place}".strip()
            entry["audience"] = [audience] if audience else []
            if free and rng.random() < 0.6:
                entry["free"] = True
            if kind == "search":
                entry["results"] = 0 if rng.random() < 0.12 + weight / 40 else rng.randint(1, 5)
            entry["demo"] = True
            out.append(entry)
    return out
