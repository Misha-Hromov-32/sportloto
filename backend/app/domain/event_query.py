"""SQL-страницы публичной ленты без загрузки полного каталога в память.

Поддерживаемые условия повторяют правила ленты. Сложные персональные фильтры
остаются на общем доменном пути; загруженные для изменения коллекции не обходятся.
"""

import re
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa

from app.domain import clock, core, store
from app.domain.errors import fail
from app.domain.features import urgent
from app.domain.lib.cities import city_by_id, radius_km
from app.domain.lib.numbers import parse_number
from app.domain.schema import COLLECTIONS


def _common_conditions(table, params: dict[str, Any]) -> list[Any]:
    conditions = [
        column == params[key]
        for key, column in (
            ("status", table.c.status),
            ("districtId", table.c.place["districtId"].astext),
            ("joinMode", table.c.join_mode),
        )
        if params.get(key)
    ]
    if params.get("level"):
        conditions.append(table.c.level.in_([params["level"], "any"]))
    if params.get("beginners"):
        conditions.append(sa.or_(table.c.beginners_welcome.is_(True), table.c.level == "beginner"))
    if params.get("free"):
        conditions.append(table.c.price["kind"].astext == "free")
    return conditions


def candidates(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Отбирает кандидатов. Права доступа и остальные фильтры проверяет лента."""
    db = store.data()
    table = COLLECTIONS["events"].table
    where = []
    if (params.get("scope") or "feed") == "feed":
        end = table.c.starts_at + table.c.duration_min * sa.literal_column("INTERVAL '1 minute'")
        where += [table.c.status.not_in(["cancelled", "removed", "deleted"]),
                  sa.or_(table.c.starts_at.is_(None), end > clock.now()),
                  table.c.visibility.is_distinct_from("invite")]
    where.extend(_common_conditions(table, params))
    sports = params.get("sportIds")
    if sports is None and params.get("sportId"):
        sports = [params["sportId"]]
    if isinstance(sports, list) and sports:
        where.append(table.c.sport_id.in_([core.domain._main_sport_id(s) for s in sports]))
    when = core._when_range(params.get("when"), params.get("date"))
    if when:
        where.append(sa.or_(table.c.starts_at.is_(None), table.c.starts_at.between(*when)))
    city = city_by_id(params.get("place@city")) if isinstance(params.get("place@city"), str) else None
    if city:
        where.append(_distance_predicate(table.c.place, city))
    if params.get("ids") is not None and isinstance(params["ids"], list):
        where.append(table.c.id.in_(params["ids"]))
    from app.domain.event_reads import project
    return project(db, {f.key for f in COLLECTIONS["events"].fields}, *(where or [sa.true()]))

_SUPPORTED = {
    "scope", "sportId", "sportIds", "when", "date", "month", "level", "beginners",
    "free", "joinMode", "districtId", "status", "ids", "point", "radiusKm", "place@city",
    "aiFlag", "aiFlagged", "state",
    "adminSearch", "adminStates", "adminAppeal", "adminOrganizer",
}
_OPERATORS = {"eq", "in", "contains", "gte", "lte"}


def _distance_predicate(place: Any, city: dict[str, Any]) -> Any:
    lat_text, lng_text = place["lat"].astext, place["lng"].astext
    numeric = r"^-?[0-9]+([.][0-9]+)?$"
    lat = sa.case((lat_text.op("~")(numeric), sa.cast(lat_text, sa.Float)), else_=None)
    lng = sa.case((lng_text.op("~")(numeric), sa.cast(lng_text, sa.Float)), else_=None)
    center = city["center"]
    radians = sa.func.radians
    h = sa.func.pow(sa.func.sin((radians(lat) - radians(center["lat"])) / 2), 2) + (
        sa.func.cos(radians(lat)) * sa.func.cos(radians(center["lat"]))
        * sa.func.pow(sa.func.sin((radians(lng) - radians(center["lng"])) / 2), 2)
    )
    distance = 2 * 6371 * sa.func.asin(sa.func.least(1.0, sa.func.sqrt(h)))
    return sa.and_(lat.is_not(None), lng.is_not(None), distance <= radius_km(city))


def feed_page(
    filters: list[dict[str, Any]], sorters: list[dict[str, Any]],
    pagination: dict[str, Any] | None, params: dict[str, Any], user: Any,
) -> dict[str, Any] | None:
    db = store.data()
    if "events" in db._data or db._partial.get("events"):  # noqa: SLF001
        # SQL ещё не видит изменения точечно загруженных событий до flush.
        return None
    if not isinstance(pagination, dict):
        return None
    unbounded = pagination.get("mode") in {"off", "client"}
    scope = params.get("scope") or "feed"
    if scope not in {"feed", "admin"}:
        return None
    if scope == "admin" and (not core._is_admin(user) or params.get("state")):
        return None
    if any(value not in (None, "", False, []) and key not in _SUPPORTED for key, value in params.items()):
        return None
    urgent_only = any(f.get("field") == "urgent" and f.get("operator") == "nnull" for f in filters)
    if any(
        not (f.get("field") == "urgent" and f.get("operator") == "nnull")
        and (f.get("field") not in _SUPPORTED or f.get("operator") not in _OPERATORS)
        for f in filters
    ):
        return None
    if any(s.get("field") not in ({"startsAt", "counts.confirmed"} if scope == "admin" else {"startsAt"}) for s in sorters):
        return None
    if any(f.get("field") in {"aiFlag", "state"} and f.get("operator") != "eq" for f in filters):
        return None
    if params.get("state") not in (None, "", "upcoming"):
        return None
    page = int(parse_number(pagination.get("currentPage")) or 1)
    size = int(parse_number(pagination.get("pageSize")) or 20)
    if page < 1 or size < 1 or size > 1000:
        return None
    collection = COLLECTIONS["events"]
    table = collection.table
    columns = [table.c[name] for field in collection.fields for name in field.columns]
    where = [] if scope == "admin" else [
        table.c.status == "published", table.c.visibility.is_distinct_from("invite"),
        table.c.starts_at + table.c.duration_min * sa.literal_column("INTERVAL '1 minute'") > clock.now(),
    ]
    if params.get("state") == "upcoming":
        where.append(table.c.starts_at > clock.now())
    if params.get("aiFlag"):
        # event_view exposes the real moderation flag only to administrators.
        flag = table.c.ai_flag if core._is_admin(user) else sa.literal("none")  # noqa: SLF001
        where.append(flag == params["aiFlag"])
    if params.get("aiFlagged"):
        where.append(table.c.ai_flag != "none")
    if scope == "admin":
        end = table.c.starts_at + table.c.duration_min * sa.literal_column("INTERVAL '1 minute'")
        active = table.c.status.not_in(["cancelled", "removed", "deleted"])
        states = params.get("adminStates")
        if isinstance(states, list) and states:
            state_conditions = {
                "upcoming": sa.and_(active, sa.or_(table.c.starts_at.is_(None), table.c.starts_at > clock.now())),
                "live": sa.and_(active, table.c.starts_at <= clock.now(), end > clock.now()),
                "past": sa.and_(active, end <= clock.now()),
                **{state: table.c.status == state for state in ("cancelled", "removed", "deleted")},
            }
            where.append(sa.or_(*(state_conditions.get(state, sa.false()) for state in states)))
        if params.get("adminAppeal"):
            where.append(table.c.moderation["appeal"].astext.is_not(None))
        if params.get("adminOrganizer") in {"org", "user"}:
            where.append(table.c.organizer_kind == params["adminOrganizer"])
        if isinstance(params.get("adminSearch"), str) and params["adminSearch"].strip():
            hay = sa.func.replace(sa.func.lower(sa.func.concat_ws(" ", table.c.title, table.c.description, table.c.place["address"].astext)), "ё", "е")
            sports = [(s["id"], core.normalize(" ".join([s["name"], *(s.get("synonyms") or [])]))) for s in db.sports]
            orgs = [(o["id"], core.normalize(o["name"])) for o in db.organizations]
            users = [(u["id"], core.normalize(u["name"])) for u in db.users]
            for word in core.normalize(params["adminSearch"]).split():
                where.append(sa.or_(hay.contains(word, autoescape=True),
                    table.c.sport_id.in_([id_ for id_, name in sports if word in name]),
                    sa.and_(table.c.organizer_kind == "org", table.c.organizer_id.in_([id_ for id_, name in orgs if word in name])),
                    sa.and_(table.c.organizer_kind == "user", table.c.organizer_id.in_([id_ for id_, name in users if word in name]))))
    when = core._when_range(params.get("when"), params.get("date"))  # noqa: SLF001
    if when is not None:
        where.append(table.c.starts_at.between(*when))
    month = params.get("month")
    if month:
        if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            fail("validation", "Выберите месяц в формате ГГГГ-ММ")
        year, number = map(int, month.split("-"))
        zone = clock.zone_info(clock.display_zone())
        start = datetime(year, number, 1, tzinfo=zone).astimezone(UTC)
        end = datetime(year + int(number == 12), number % 12 + 1, 1, tzinfo=zone).astimezone(UTC)
        where.extend((table.c.starts_at >= start, table.c.starts_at < end))
    sports = params.get("sportIds")
    if sports is None and params.get("sportId"):
        sports = [params["sportId"]]
    if sports is not None:
        if not isinstance(sports, list):
            return None
        wanted = [core.domain._main_sport_id(value) for value in sports]  # noqa: SLF001
        if wanted:
            where.append(table.c.sport_id.in_(wanted))
    ids = params.get("ids")
    if ids is not None:
        if not isinstance(ids, list):
            return None
        where.append(table.c.id.in_([value for value in ids if isinstance(value, str)]))
    where.extend(_common_conditions(table, params))
    for condition in filters:
        if condition["field"] == "place@city":
            value = condition.get("value")
            city = city_by_id(value) if isinstance(value, str) else None
            where.append(_distance_predicate(table.c.place, city) if city else sa.false())
    direction = sorters[0].get("order") if sorters else ("desc" if scope == "admin" else "asc")
    sort_value = table.c.starts_at
    if scope == "admin" and sorters and sorters[0].get("field") == "counts.confirmed":
        ps = COLLECTIONS["participations"].table
        children = sa.case((sa.func.jsonb_typeof(ps.c.children) == "array", sa.func.jsonb_array_length(ps.c.children)), else_=0)
        seats = sa.case((ps.c.adult_seat.is_(False), 0), else_=1) + children
        sort_value = sa.select(sa.func.coalesce(sa.func.sum(seats), 0)).where(ps.c.event_id == table.c.id, ps.c.status == "confirmed").correlate(table).scalar_subquery()
    order = sort_value.asc() if direction == "asc" else sort_value.desc()
    query = sa.select(*columns).where(*where).order_by(order, table.c.ord, table.c.id)
    if urgent_only:
        # The badge also depends on current participants and the event capacity.
        # Read only the small set with open calls, evaluate the authoritative badge,
        # then paginate. An expired/satisfied call must not inflate the total.
        candidates = {call["eventId"] for call in db.urgent_calls if not call.get("closedAt")}
        if not candidates:
            return {"data": [], "total": 0}
        query = query.where(table.c.id.in_(candidates))
    else:
        total = db.connection.execute(sa.select(sa.func.count()).select_from(table).where(*where)).scalar_one()
        if total == 0:
            return {"data": [], "total": 0}
        if unbounded:
            if total > 1000:
                fail("validation", "Каталог слишком большой для загрузки целиком. Обновите страницу и используйте страницы каталога")
            query = query.limit(1000)
        else:
            query = query.limit(size).offset((page-1)*size)
    rows = [db._row(collection, row._mapping) for row in db.connection.execute(query)]  # noqa: SLF001
    if urgent_only:
        rows = [row for row in rows if urgent.urgent_badge(row, clock.now()) is not None]
        total = len(rows)
        if not unbounded:
            rows = rows[(page-1)*size:page*size]
    point = params.get("point") or core.domain._actor_point(user)  # noqa: SLF001
    views = core.domain.event_views(user, rows, {"point": point, "match": core.domain._match_for(user)})  # noqa: SLF001
    return {"data": views, "total": total}
