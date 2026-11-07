"""Ресурсы и действия API поверх доменных правил.

Списки, карточки, создание, правка и удаление — в форме Refine (`getList`, `getOne`, …); действия —
таблица маршрутов `{метод, шаблон адреса, обработчик}`. Транзакцию открывает HTTP-слой:
здесь правила только выполняются. Кто смотрит — `actor()`, его задаёт HTTP-слой по токену сессии.

Здесь же — подсказки прав для интерфейса (accessControlProvider), сброс демо-данных и сдвиг дат.
"""

import copy
import json
import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

import sqlalchemy as sa

from app.core.errors import AppError
from app.domain import assistant, bus, clock, core, seed, store
from app.domain.errors import fail
from app.domain.features import (
    again,
    calendar,
    community_api,
    demand,
    digest,
    event_photos,
    family,
    favorites,
    greeter,
    inventory,
    invite_only,
    managers,
    match,
    mcp,
    payments,
    plan_b,
    references,
    reliability,
    series,
    share,
    stop_list,
    team,
    templates,
    urgent,
    venues,
    waitlist_offer,
)
from app.domain.lib.cities import city_by_id, point_in_city
from app.domain.lib.numbers import parse_number
from app.domain.lib.text import ru_sort_key
from app.domain.routing import Listed, Params, Resources, Route, route
from app.domain.schema import COLLECTIONS, Collection
from app.domain.seed.companion_people import seed_companion_people
from app.domain.types import Actor

logger = logging.getLogger(__name__)

# ---------- Кто смотрит ----------

_actor_id: ContextVar[str | None] = ContextVar("domain_actor_id", default=None)


def actor() -> Actor:
    """Пользователь текущего запроса из базы этой же транзакции."""
    return core.domain.user(_actor_id.get())


def actor_id() -> str | None:
    return _actor_id.get()


@contextmanager
def acting_as(user_id: str | None) -> Iterator[None]:
    token = _actor_id.set(user_id)
    try:
        yield
    finally:
        _actor_id.reset(token)


# Подборка дня: письмо уходит только на подтверждённую почту. Нет строки — почта подтверждена.
_EMAIL_PENDING = sa.text("SELECT verified_at IS NULL FROM email_status WHERE user_id = :user_id")


def _email_verified(user_id: str) -> bool:
    return not store.data().connection.execute(_EMAIL_PENDING, {"user_id": user_id}).scalar()


digest.use_email_check(_email_verified)


# ---------- Фильтры, сортировка, страницы ----------

_FILTER_OPERATORS = {"eq", "in", "contains", "gte", "lte"}
# Строка, похожая на дату ISO: такие значения сравниваются как моменты, а не как текст.
_DATE_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _conditions(value: Any, name: str) -> list[dict[str, Any]]:
    """Фильтры или сортировка Refine: список объектов, у которых поле `field` — строка (если есть)."""
    if value is None:
        return []
    if isinstance(value, list) and all(
        isinstance(c, dict) and isinstance(c.get("field", ""), str) for c in value
    ):
        return value
    return fail(
        "validation", f"Параметр {name} — список условий", {name: "Ожидается список объектов с полем field"}
    )


def filters_to_params(filters: list[dict[str, Any]] | None) -> Params:
    """Плоский объект из фильтров Refine: { field: value } для eq/in/contains/gte/lte."""
    params: Params = {}
    for f in filters or []:
        if "field" in f and f.get("operator") in _FILTER_OPERATORS:
            value = f.get("value")
            if value is None or value == "":
                continue
            params[f["field"]] = value
    return params


def get_path(record: Any, path: str) -> Any:
    value = record
    for key in path.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    return value


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _same(a: Any, b: Any) -> bool:
    """Равенство значения поля и значения фильтра: True не равно 1."""
    return isinstance(a, bool) == isinstance(b, bool) and a == b


def _text(value: Any) -> str:
    """Значение поля как текст для фильтра «содержит»: у списка и объекта — значения через запятую."""
    if value is None:
        return ""
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list):
        return ", ".join(_text(v) for v in value)
    return str(value)


def _ordered(field_value: Any, value: Any) -> tuple[Any, Any] | None:
    """Пара для gte/lte/gt/lt: числа — как числа, даты — как моменты, строки — по-русски.

    None — значения несравнимы (поля нет, число против текста): условие не выполняется.
    """
    if _is_number(field_value):
        number = parse_number(value)
        return None if number is None else (field_value, number)
    if isinstance(field_value, str) and isinstance(value, str):
        if _DATE_LIKE.match(field_value) and _DATE_LIKE.match(value):
            left, right = clock.parse(field_value), clock.parse(value)
            if left is not None and right is not None:
                return left, right
        return ru_sort_key(field_value), ru_sort_key(value)
    return None


_IN_CITY = "@city"


def _in_city(record: Any, field: str, city_id: Any) -> bool:
    """Фильтр `place@city` (или `@city` — точка в самой записи): точка внутри границы города."""
    path = field[: -len(_IN_CITY)].rstrip(".")
    point = get_path(record, path) if path else record
    city = city_by_id(city_id) if isinstance(city_id, str) else None
    return city is not None and point_in_city(point, city)


def matches(record: Any, f: dict[str, Any]) -> bool:
    if f["field"].endswith(_IN_CITY):
        return _in_city(record, f["field"], f.get("value"))
    v = get_path(record, f["field"])
    operator = f.get("operator")
    value = f.get("value")
    if operator == "eq":
        return _same(v, value)
    if operator == "ne":
        return not _same(v, value)
    if operator == "in":
        return any(_same(v, x) for x in value) if isinstance(value, list) else True
    if operator == "nin":
        return not any(_same(v, x) for x in value) if isinstance(value, list) else True
    if operator == "contains":
        return _text(value).lower() in _text(v).lower()
    if operator in {"gte", "lte", "gt", "lt"}:
        pair = _ordered(v, value)
        if pair is None:
            return False
        left, right = pair
        return {
            "gte": left >= right,
            "lte": left <= right,
            "gt": left > right,
            "lt": left < right,
        }[operator]
    if operator == "null":
        return v is None
    if operator == "nnull":
        return v is not None
    return True


def apply_rest(rows: list[Any], filters: list[dict[str, Any]] | None, consumed: list[str]) -> list[Any]:
    """Фильтры, которые ресурс не обработал сам, применяются к полям ответа."""
    rest = [f for f in filters or [] if "field" in f and f["field"] not in consumed]
    return [r for r in rows if all(matches(r, f) for f in rest)] if rest else rows


def _sort_key(value: Any) -> tuple[int, Any]:
    """Ключ сортировки поля: числа (и флаги) — по величине, остальное — как текст по-русски."""
    if isinstance(value, int | float):
        return 0, value
    return 1, ru_sort_key(_text(value))


def _sorted_by(rows: list[Any], field: str, descending: bool) -> list[Any]:
    """Сортировка по одному полю; строки без значения поля — в конце при любом направлении."""
    present = [r for r in rows if get_path(r, field) is not None]
    missing = [r for r in rows if get_path(r, field) is None]
    present.sort(key=lambda r: _sort_key(get_path(r, field)), reverse=descending)
    return present + missing


def sort_rows(rows: list[Any], sorters: list[dict[str, Any]] | None) -> list[Any]:
    """Сортировка по нескольким полям: первое поле главное, следующие решают при равенстве."""
    # Сортировка устойчивая: проходы от последнего поля к первому дают порядок по всем полям сразу.
    for s in reversed([s for s in sorters or [] if "field" in s]):
        rows = _sorted_by(rows, s["field"], descending=s.get("order") != "asc")
    return rows


def paginate(rows: list[Any], pagination: dict[str, Any] | None) -> list[Any]:
    if not pagination or not isinstance(pagination, dict) or pagination.get("mode") in {"off", "client"}:
        return rows
    page = int(parse_number(pagination.get("currentPage")) or 1)
    size = int(parse_number(pagination.get("pageSize")) or 20)
    return rows[(page - 1) * size : page * size]


EVENT_FILTER_KEYS = [
    "scope",
    "orgId",
    "organizerUserId",
    "sportId",
    "sportIds",
    "q",
    "when",
    "date",
    "month",
    "dayPart",
    "level",
    "beginners",
    "free",
    "priceMax",
    "joinMode",
    "near",
    "radiusKm",
    "districtId",
    "point",
    "ids",
    "forYou",
    "aiFlagged",
    "status",
    "access",  # Н1
    "composition",  # В7
    "family",  # Н6
]

# Только поля, которые event_view возвращает без вычислений и маскирования правами.
# createdBy, privateInfo, moderation, aiFlag и производные поля сюда добавлять нельзя.
_RAW_EVENT_FIELDS = frozenset(
    {
        "id", "title", "description", "sportId", "organizer", "organizer.kind", "organizer.id",
        "startsAt", "durationMin", "place", "place.address", "place.landmark", "place.districtId",
        "place.lat", "place.lng", "level", "beginnersWelcome", "price", "price.kind", "price.amount",
        "price.total", "price.note", "paymentNote", "cancelPolicy", "joinMode", "capacity",
        "minParticipants", "status", "cancelReason", "series", "coverUrl", "createdAt", "updatedAt",
        "venueId", "accessExtras",
    }
)


def _can_page_raw_events(
    filters: list[dict[str, Any]],
    sorters: list[dict[str, Any]],
    pagination: dict[str, Any] | None,
    params: Params,
) -> bool:
    return (
        bool(pagination)
        and isinstance(pagination, dict)
        and pagination.get("mode") not in {"off", "client"}
        and all(
            f.get("field") in EVENT_FILTER_KEYS
            or f.get("field") in _RAW_EVENT_FIELDS
            or f.get("field") == "place@city"
            or f.get("field") in {"state", "aiFlag"}
            for f in filters
        )
        and all(s.get("field") in _RAW_EVENT_FIELDS for s in sorters)
    )

# ---------- Ресурсы и маршруты ----------


def _host() -> Any:
    return core.domain.participation_host


def _companions(p: Params) -> list[Any]:
    return core.domain.list_companions(actor(), p)


def _event_getter(id_: str, meta: Params | None = None) -> Any:
    # С13: код из ссылки-приглашения открывает закрытую встречу и запоминается за вошедшим
    invite = (meta or {}).get("invite")
    invite = invite if isinstance(invite, str) and invite else None
    if invite:
        invite_only.redeem_invite(core.domain.participation_read_host, actor(), id_, invite)
    return core.domain.event_details(actor(), id_, {"invite": invite})


def _rule(id_: str, _meta: Params | None = None) -> Any:
    found = next((r for r in store.data().rules if r["id"] == id_), None)
    return found if found is not None else fail("not_found", "Пункт правил не найден")


def _district(id_: str, _meta: Params | None = None) -> Any:
    found = next((d for d in store.data().districts if d["id"] == id_), None)
    return references.district_view(found) if found is not None else fail("not_found", "Район не найден")


def _core_resources() -> Resources:
    d = core.domain
    return Resources(
        listers={
            "events": lambda p: Listed(d.list_events(actor(), p), EVENT_FILTER_KEYS),
            "participations": lambda p: Listed(
                d.list_participations(actor(), p), ["eventId", "mine", "status", "scope"]
            ),
            "messages": lambda p: Listed(d.list_messages(actor(), p), ["eventId", "scope", "invite"]),
            "sports": lambda p: Listed(
                d.list_sports(p), ["q", "kind", "categoryId", "includeMerged", "includeHidden"]
            ),
            "categories": lambda p: Listed(d.list_categories(p), ["includeHidden"]),
            # Справочники: скрытые города и правила видит только администратор с includeHidden
            "cities": lambda p: Listed(references.list_cities(actor(), p), ["includeHidden"]),
            "districts": lambda _p: Listed(references.list_districts(), []),
            "rules": lambda p: Listed(references.list_rules(actor(), p), ["includeHidden"]),
            "organizations": lambda p: Listed(
                d.list_organizations(actor(), p), ["scope", "status", "q", "aiFlagged"]
            ),
            "companions": lambda p: Listed(
                _companions(p), ["sportId", "status", "mine", "districtId", "q", "city"]
            ),
            "notifications": lambda p: Listed(d.list_notifications(actor(), p), ["unread"]),
            "users": lambda p: Listed(d.list_users(actor(), p), ["q", "sportId", "readiness"]),
            "audit": lambda p: Listed(d.list_audit(actor(), p), ["action", "targetType", "q"]),
            "invites": lambda _p: Listed(d.list_invites(actor()), []),
            # В4: площадки
            "venues": lambda p: Listed(
                venues.list_venues(store.data(), actor(), p),
                [
                    "q",
                    "sportIds",
                    "sportId",
                    "districtId",
                    "date",
                    "dayPart",
                    "priceMax",
                    "features",
                    "indoor",
                    "scope",
                    "orgId",
                ],
            ),
        },
        getters={
            "events": _event_getter,
            "organizations": lambda id_, _m=None: d.organization_details(actor(), id_),
            "companions": lambda id_, _m=None: d.companion_details(actor(), id_),
            "users": lambda id_, _m=None: d.user_profile(id_),
            "sports": lambda id_, _m=None: d.sport_details(id_),
            "rules": _rule,
            "districts": _district,
            "cities": lambda id_, _m=None: references.city_details(id_),
            "venues": lambda id_, _m=None: venues.venue_details(store.data(), actor(), id_),  # В4
        },
        creators={
            "events": lambda v: d.create_event(actor(), v),
            "messages": lambda v: d.post_message(actor(), v),
            "organizations": lambda v: d.create_organization(actor(), v),
            "companions": lambda v: d.create_companion(actor(), v),
            "sports": lambda v: d.create_sport(actor(), v),
            "venues": lambda v: venues.create_venue(store.data(), actor(), v),  # В4
        },
        updaters={
            "events": lambda id_, v: d.update_event(actor(), id_, v),
            "organizations": lambda id_, v: d.update_organization(actor(), id_, v),
            "users": lambda id_, v: d.update_profile(actor(), id_, v),
            # Устарело: «Прочитано» — это действие, а не правка: POST /notifications/:id/read.
            "notifications": lambda id_, _v: d.mark_read(actor(), [id_]),
            "venues": lambda id_, v: venues.update_venue(store.data(), actor(), id_, v),  # В4
        },
        deleters={
            "events": lambda id_: d.delete_own_event(actor(), id_),
            "messages": lambda id_: d.delete_own_message(actor(), id_),
            # Устарело: то же, что POST /companions/:id/close.
            "companions": lambda id_: d.close_companion(actor(), id_),
        },
    )


def _str(value: Any) -> str:
    """Строковое поле тела запроса или query; не строка — пустая строка."""
    return value if isinstance(value, str) else ""


def _join(id_: str, p: Params) -> Any:
    res = core.domain.join(actor(), id_, p)
    # С1: «Я здесь впервые» отмечается вместе с записью
    if p.get("firstVisit"):
        greeter.set_first_visit(
            core.domain, actor(), id_, {"on": True, "withCompanion": bool(p.get("withCompanion"))}
        )
    return res


def _escort(id_: str, p: Params) -> Any:
    venues.set_escort(store.data(), actor(), id_, p.get("needed") is not False)
    return core.domain.event_details(actor(), id_)


def _draft(p: Params) -> Any:
    kind = p.get("kind")
    text = _str(p.get("text"))
    ctx = core.domain.assistant_context
    if len(text.strip()) < 5:
        fail("validation", "Напишите хотя бы одну фразу о том, что хотите", {"text": "Напишите подробнее"})
    if kind == "event":
        return assistant.draft_event(text, ctx)
    if kind == "companion":
        return assistant.draft_companion(text, ctx)
    if kind == "organization":
        return assistant.draft_organization(text, ctx)
    return fail("bad_request", "Неизвестный тип черновика")


def _core_routes() -> list[Route]:
    d = core.domain
    a = actor
    return [
        route(
            "put",
            r"^/events/([^/]+)/photos$",
            lambda g, p, _q: event_photos.save_event_photos(_host(), a(), g[0], p),
        ),
        route("post", r"^/events/([^/]+)/join$", lambda g, p, _q: _join(g[0], p)),
        # ---------- С1, С3, Н2, С2: встречающий, новички, срочный добор, программа, спрос ----------
        route("get", r"^/events/([^/]+)/greeter$", lambda g, _p, _q: greeter.greeter_view(d, a(), g[0])),
        route("put", r"^/events/([^/]+)/greeter$", lambda g, p, _q: greeter.set_greeter(d, a(), g[0], p)),
        route("delete", r"^/events/([^/]+)/greeter$", lambda g, _p, _q: greeter.clear_greeter(d, a(), g[0])),
        route(
            "put",
            r"^/events/([^/]+)/first-visit$",
            lambda g, p, _q: greeter.set_first_visit(
                d, a(), g[0], {"on": True, "withCompanion": bool(p.get("withCompanion"))}
            ),
        ),
        route(
            "delete",
            r"^/events/([^/]+)/first-visit$",
            lambda g, _p, _q: greeter.set_first_visit(d, a(), g[0], {"on": False}),
        ),
        route("get", r"^/events/([^/]+)/urgent$", lambda g, _p, _q: urgent.urgent_view(d, a(), g[0])),
        route(
            "post",
            r"^/events/([^/]+)/urgent$",
            lambda g, p, _q: urgent.start_urgent(d, a(), g[0], {"need": p.get("need")}),
        ),
        route("delete", r"^/events/([^/]+)/urgent$", lambda g, _p, _q: urgent.stop_urgent(d, a(), g[0])),
        route(
            "put",
            r"^/events/([^/]+)/program$",
            lambda g, p, _q: greeter.set_program(
                d, a(), g[0], {"kind": p.get("kind"), "withCompanion": bool(p.get("withCompanion"))}
            ),
        ),
        route("delete", r"^/events/([^/]+)/program$", lambda g, _p, _q: greeter.clear_program(d, a(), g[0])),
        route("get", r"^/organizations/([^/]+)/demand$", lambda g, _p, _q: demand.demand_view(d, a(), g[0])),
        route(
            "post",
            r"^/organizations/([^/]+)/demand/offer$",
            lambda g, p, _q: demand.offer_demand(d, a(), g[0], p),
        ),
        route("post", r"^/events/([^/]+)/leave$", lambda g, _p, _q: d.leave(a(), g[0])),
        route("post", r"^/events/([^/]+)/cancel$", lambda g, p, _q: d.cancel_event(a(), g[0], p)),
        route("post", r"^/events/([^/]+)/ack-changes$", lambda g, _p, _q: d.acknowledge_changes(a(), g[0])),
        route("post", r"^/events/([^/]+)/moderate$", lambda g, p, _q: d.moderate_event(a(), g[0], p)),
        route("post", r"^/events/([^/]+)/appeal$", lambda g, p, _q: d.appeal_event(a(), g[0], p)),
        route("post", r"^/events/([^/]+)/dismiss-flag$", lambda g, _p, _q: d.dismiss_event_flag(a(), g[0])),
        route(
            "post",
            r"^/events/([^/]+)/invite$",
            lambda g, p, _q: d.invite(
                a(), {"eventId": g[0], "userId": _str(p.get("userId")), "companionId": p.get("companionId")}
            ),
        ),
        route("post", r"^/participations/([^/]+)/decide$", lambda g, p, _q: d.decide(a(), g[0], p)),
        route("post", r"^/messages/([^/]+)/react$", lambda g, p, _q: d.react(a(), g[0], p.get("key"))),
        route("post", r"^/messages/([^/]+)/moderate$", lambda g, p, _q: d.moderate_message(a(), g[0], p)),
        route(
            "post",
            r"^/organizations/([^/]+)/submit$",
            lambda g, p, _q: d.update_organization(a(), g[0], {**p, "submit": True}),
        ),
        route(
            "post", r"^/organizations/([^/]+)/decide$", lambda g, p, _q: d.decide_organization(a(), g[0], p)
        ),
        route("put", r"^/companions/([^/]+)/metoo$", lambda g, _p, _q: d.set_metoo(a(), g[0], True)),
        route("delete", r"^/companions/([^/]+)/metoo$", lambda g, _p, _q: d.set_metoo(a(), g[0], False)),
        # Устарело: переключатель; используйте PUT и DELETE.
        route("post", r"^/companions/([^/]+)/metoo$", lambda g, _p, _q: d.toggle_metoo(a(), g[0])),
        route(
            "post",
            r"^/companions/([^/]+)/invite$",
            lambda g, p, _q: d.invite(
                a(),
                {"eventId": _str(p.get("eventId")), "userId": _str(p.get("userId")), "companionId": g[0]},
            ),
        ),
        route("post", r"^/companions/([^/]+)/close$", lambda g, _p, _q: d.close_companion(a(), g[0])),
        route("post", r"^/sports/([^/]+)/promote$", lambda g, p, _q: d.promote_sport(a(), g[0], p)),
        route("post", r"^/sports/([^/]+)/merge$", lambda g, p, _q: d.merge_sport(a(), g[0], p)),
        route("get", r"^/sports/suggest$", lambda _g, _p, q: d.list_sports({"q": _str(q.get("q"))})),
        route("post", r"^/notifications/read$", lambda _g, p, _q: d.mark_read(a(), p.get("ids"))),
        route("post", r"^/notifications/([^/]+)/read$", lambda g, _p, _q: d.mark_read(a(), [g[0]])),
        route("get", r"^/me$", lambda _g, _p, _q: d.identity(a())),
        route("get", r"^/demo/accounts$", lambda _g, _p, _q: d.demo_accounts()),
        route("get", r"^/admin/stats$", lambda _g, _p, _q: d.admin_stats(a())),
        route("get", r"^/admin/events-summary$", lambda _g, _p, _q: d.admin_event_counts(a())),
        route("get", r"^/demo/state$", lambda _g, _p, _q: d.demo_state()),
        route("post", r"^/demo/reset$", lambda _g, _p, _q: reset_demo()),
        route(
            "post",
            r"^/demo/assistant-failure$",
            lambda _g, p, _q: (
                _require_demo_switches("/demo/assistant-failure")
                or d.set_assistant_failure(
                    bool(p.get("on")), "timeout" if p.get("mode") == "timeout" else "error"
                )
            ),
        ),
        route(
            "post",
            r"^/assistant/search$",
            lambda _g, p, _q: assistant.parse_search(_str(p.get("text")), d.assistant_context),
            assistant="search",
        ),
        route("post", r"^/assistant/draft$", lambda _g, p, _q: _draft(p), assistant="draft"),
        route(
            "post",
            r"^/assistant/explain$",
            lambda _g, p, _q: d.explain_event_for(a(), _str(p.get("eventId"))),
            assistant="match",
        ),
        # В2: диалог подбора — фраза и выбранные шаги → фильтры, события с объяснением, уточнения
        route(
            "post", r"^/assistant/match$", lambda _g, p, _q: match.match_events(d, a(), p), assistant="match"
        ),
        route(
            "post",
            r"^/assistant/premoderate$",
            lambda _g, p, _q: assistant.premoderate(_str(p.get("text"))),
            assistant="premoderation",
        ),
        # ---------- В4, В5, Н1: площадки, подбор места, сопровождение ----------
        route(
            "post",
            r"^/venues/([^/]+)/slots$",
            lambda g, p, _q: venues.set_venue_slots(store.data(), a(), g[0], p),
        ),
        route("post", r"^/venues/best-place$", lambda _g, p, _q: venues.best_place(store.data(), a(), p)),
        route(
            "post",
            r"^/events/([^/]+)/move-to-venue$",
            lambda g, p, _q: d.update_event(
                a(), g[0], venues.venue_move_patch(store.data(), a(), g[0], _str(p.get("venueId")))
            ),
        ),
        route("put", r"^/events/([^/]+)/escort$", lambda g, p, _q: _escort(g[0], p)),
        # ---------- С4, С6, С10: резерв из листа ожидания, план Б, серия ----------
        route(
            "post",
            r"^/events/([^/]+)/offer/accept$",
            lambda g, _p, _q: waitlist_offer.accept_offer(_host(), a(), g[0]),
        ),
        route(
            "post",
            r"^/events/([^/]+)/offer/decline$",
            lambda g, _p, _q: waitlist_offer.decline_offer(_host(), a(), g[0]),
        ),
        route(
            "get", r"^/events/([^/]+)/alternatives$", lambda g, _p, _q: plan_b.plan_b_view(_host(), a(), g[0])
        ),
        route(
            "post",
            r"^/events/([^/]+)/decline-reschedule$",
            lambda g, _p, _q: plan_b.decline_reschedule(_host(), a(), g[0]),
        ),
        route("get", r"^/events/([^/]+)/series$", lambda g, _p, _q: series.series_view(_host(), a(), g[0])),
        route(
            "post", r"^/events/([^/]+)/join-series$", lambda g, _p, _q: series.join_series(_host(), a(), g[0])
        ),
        route(
            "get",
            r"^/demo/short-reserve$",
            lambda _g, _p, _q: waitlist_offer.participation_demo_state(store.data()),
        ),
        route(
            "post",
            r"^/demo/short-reserve$",
            lambda _g, p, _q: waitlist_offer.set_short_reserve(_host(), bool(p.get("on"))),
        ),
    ]


class Registry:
    """Ресурсы и маршруты ядра и всех модулей, собранные один раз."""

    def __init__(self) -> None:
        core_resources = _core_resources()
        self.listers = dict(core_resources.listers)
        self.getters = dict(core_resources.getters)
        self.creators = dict(core_resources.creators)
        self.updaters = dict(core_resources.updaters)
        self.deleters = dict(core_resources.deleters)
        self.routes = _core_routes()

        # В3 + С7: инвентарь для игры, общая полка и помощь партнёров
        self._add(inventory.inventory_resources(actor))
        self.routes.extend(inventory.inventory_routes(actor))
        # В6, В8, С16, С17: спрос и инфраструктура, импорт из сообществ, жалобы, приостановка допуска
        self._add(community_api.community_resources(actor))
        self.routes.extend(community_api.community_routes(actor))
        community_api.track_demand(self.listers, self.routes, actor)
        # В1: токены ассистента, журнал вызовов и точка протокола MCP
        self.routes.extend(mcp.mcp_routes(actor))
        # С8, С11, С14, С15, Н5: избранное, шаблоны, управляющие и выгрузка, надёжность; ссылка близкому
        d = core.domain
        self.routes.extend(
            [
                *favorites.favorites_routes(d, actor),
                *templates.templates_routes(),
                *managers.managers_routes(d, actor),
                *reliability.reliability_routes(d, actor),
                *share.share_routes(d, actor),
                *digest.digest_routes(d, actor),  # подборка дня
                *stop_list.stop_list_routes(d, actor),  # D-16
                *payments.payments_routes(d, actor),  # оплата на сайте
                *references.references_routes(actor),  # справочники в админке
            ]
        )
        # С12, С13, Н3, Н6: собраться снова, ссылка-приглашение, запись командой, дети
        self.routes.extend(
            [
                *again.again_routes(_host, actor),
                *invite_only.invite_only_routes(_host, actor),
                *team.team_routes(_host, actor),
                *family.family_routes(_host, actor),
            ]
        )

    def _add(self, resources: Resources) -> None:
        self.listers.update(resources.listers)
        self.getters.update(resources.getters)
        self.creators.update(resources.creators)
        self.updaters.update(resources.updaters)
        self.deleters.update(resources.deleters)

    def find_route(self, method: str, path: str) -> tuple[Route, list[str]] | None:
        for r in self.routes:
            if r.method == method:
                match_ = r.pattern.search(path)
                if match_:
                    return r, list(match_.groups())
        return None


@cache
def registry() -> Registry:
    return Registry()


def _unknown(resource: str) -> Any:
    return fail("not_found", f"Ресурс «{resource}» не поддерживается")


def get_list(
    resource: str,
    filters: list[dict[str, Any]] | None = None,
    sorters: list[dict[str, Any]] | None = None,
    pagination: dict[str, Any] | None = None,
) -> dict[str, Any]:
    lister = registry().listers.get(resource) or _unknown(resource)
    filters = _conditions(filters, "filters")
    sorters = _conditions(sorters, "sorters")
    params = filters_to_params(filters)
    if resource == "users" and isinstance(pagination, dict) and pagination.get("mode") not in {"off", "client"}:
        safe = {"q", "sportId", "readiness", "id", "name", "age", "city", "districtId", "about", "createdAt"}
        if all(f.get("field") in safe for f in filters) and all(s.get("field") in safe for s in sorters):
            d = core.domain
            rows = d.list_users(actor(), params, raw=True)
            filtered = sort_rows(apply_rest(rows, filters, ["q", "sportId", "readiness"]), sorters)
            return {"data": [d.user_view(u) for u in paginate(filtered, pagination)], "total": len(filtered)}
    if resource == "events":
        from app.domain.event_query import feed_page  # noqa: PLC0415 — избегаем цикла импорта

        page = feed_page(filters, sorters, pagination, params, actor())
        if page is not None:
            return page
    if resource == "events" and _can_page_raw_events(filters, sorters, pagination, params):
        d = core.domain
        user = actor()
        raw = d.list_events(user, params, raw=True)
        raw = [{**event, "state": d.event_state(event),
                "aiFlag": event.get("aiFlag") if user is not None and user["role"] == "admin" else "none"}
               for event in raw]
        filtered = sort_rows(apply_rest(raw, filters, EVENT_FILTER_KEYS), sorters)
        page = paginate(filtered, pagination)
        point = params.get("point")
        if point is None:
            point = d._actor_point(user)  # noqa: SLF001
        selected = [d._event_for_read(e["id"]) or e for e in page]
        views = d.event_views(user, selected, {"point": point, "match": d._match_for(user)})  # noqa: SLF001
        return {"data": views, "total": len(filtered)}
    listed = lister(params)
    filtered = sort_rows(apply_rest(list(listed.rows), filters, listed.consumed), sorters)
    return {"data": paginate(filtered, pagination), "total": len(filtered)}


def get_one(resource: str, id_: str, meta: Params | None = None) -> Any:
    getter = registry().getters.get(resource) or _unknown(resource)
    return getter(id_, meta) if isinstance(meta, dict) and meta else getter(id_)


def get_many(resource: str, ids: list[str]) -> list[Any]:
    getter = registry().getters.get(resource) or _unknown(resource)
    out = []
    for id_ in ids:
        try:
            out.append(getter(id_))
        except AppError:
            continue
    return out


def create(resource: str, variables: Params) -> Any:
    creator = registry().creators.get(resource) or _unknown(resource)
    return creator(variables)


def update(resource: str, id_: str, variables: Params) -> Any:
    updater = registry().updaters.get(resource) or _unknown(resource)
    return updater(id_, variables)


def delete_one(resource: str, id_: str) -> Any:
    deleter = registry().deleters.get(resource) or _unknown(resource)
    return deleter(id_)


# ---------- Помощник: журнал, режим сбоя, запасной путь ----------

ASSISTANT_DOWN = "Помощник сейчас недоступен. Ваш текст остался в форме, допишите остальное сами"
ASSISTANT_TIMEOUT = "Помощник не ответил вовремя. Ваш текст остался в форме, допишите остальное сами"
# Сколько ждём помощника, прежде чем перейти на запасной путь (как таймаут модели).
ASSISTANT_TIMEOUT_SECONDS = 6


def assistant_fallback(handler: Route, payload: Params) -> dict[str, Any]:
    """Запасной путь для поиска фразой: обычный текстовый поиск по той же фразе."""
    if handler.assistant == "search" or handler.pattern.search("/assistant/match"):
        return {"fallback": {"q": _str(payload.get("text"))}}
    return {}


def assistant_failure() -> tuple[bool, str]:
    settings = store.data().settings
    return bool(settings.get("assistantFailure")), settings.get("assistantFailureMode") or "error"


def log_assistant(handler: Route, duration_ms: float, ok: bool) -> None:
    core.domain.log_ai_request(actor(), handler.assistant, duration_ms, ok, not ok)


# ---------- Проверки по времени (С4, С9, С15, Н3) ----------


def lazy_checks() -> None:
    """Истёкшие резервы, напоминания, вопрос «Встреча состоялась?», места команды, подборка дня."""
    calendar.participation_tick(core.domain.participation_host)
    reliability.reliability_tick(core.domain)  # С15
    team.team_tick(core.domain.participation_host)  # Н3: неподтверждённые места команды
    digest.digest_tick(core.domain)  # подборка дня в выбранный час
    payments.payments_tick(core.domain)  # оплата: сроки, складчина, зачисления, заказы


# ---------- Демо-данные ----------


def _collection_value(data: dict[str, Any], path: str) -> list[Any]:
    if "." in path:
        ns, key = path.split(".", 1)
        return (data.get(ns) or {}).get(key) or []
    return data.get(path) or []


# Записи о настоящих деньгах (оплата на сайте): обновление демо-данных их не заменяет, не чистит
# и не сдвигает по датам — даже те, что пришли из сидов. Полный сброс (POST /demo/reset) — только для разработки.
MONEY_COLLECTIONS = frozenset({"payments", "paymentOps", "paymentDues", "orders", "credits", "payouts"})
# Справочники правит администратор («Справочники»): новая версия сидов не меняет и не удаляет
# существующие записи, а только добавляет записи, которых ещё нет по ключу.
REFERENCE_COLLECTIONS = frozenset({"cities", "districts", "sports", "categories", "rules"})
# Правила добавляют записи этих коллекций в начало списка: при слиянии записи людей остаются первыми.
_NEWEST_FIRST = frozenset(
    {"notifications", "audit", "inventory.shelf", "inventory.loans", "inventory.support"}
)
# Ключ записи в коллекциях без своего id: поля, которые её определяют (как правила ищут такие записи).
_COMPOSITE_KEYS: dict[str, tuple[str, ...]] = {
    "idempotency": ("userId", "resource", "key"),
    "greeters": ("eventId",),
    "firstVisits": ("eventId", "userId"),
    "urgentCalls": ("eventId", "createdAt"),
    "eventPrograms": ("eventId",),
    "inviteGrants": ("eventId", "userId"),
    "engagement.favorites": ("userId", "eventId"),
    "engagement.follows": ("userId", "kind", "targetId"),
    "engagement.managers": ("orgId", "userId"),
    "engagement.heldVotes": ("eventId", "userId"),
}
# Ссылки `{ kind, id }` без внешнего ключа в базе: по ним висячие записи тоже находятся.
_REF_FIELDS = {"events": "organizer", "inventory.shelf": "owner"}
_REF_TARGETS = {"user": "users", "org": "organizations"}
_BACKUPS_KEPT = 20


@dataclass(slots=True)
class DemoOptions:
    """Настройки демо-данных сервера (задаёт DomainRuntime при запуске)."""

    reset_enabled: bool = True
    backup_dir: str = ""


demo_options = DemoOptions()


def configure_demo(*, reset_enabled: bool = True, backup_dir: str = "") -> None:
    demo_options.reset_enabled = reset_enabled
    demo_options.backup_dir = backup_dir


def _require_demo_switches(path: str) -> None:
    """На публичном сервере сброс и переключатели демо выключены: отвечаем, как на неизвестный маршрут."""
    if not demo_options.reset_enabled:
        fail("not_found", f"Действие POST {path} не поддерживается")


def _seed_collections() -> list[Collection]:
    return [c for c in COLLECTIONS.values() if not c.write_only]


def row_key(c: Collection, row: Any) -> str:
    """Устойчивый ключ записи: id, свой ключ коллекции или составной ключ для коллекций без id."""
    if c.scalar:
        return str(row)
    if c.key is not None:
        return str(row.get(c.key))
    return json.dumps([row.get(k) for k in _COMPOSITE_KEYS[c.path]], ensure_ascii=False)


def seed_ids(data: dict[str, Any]) -> dict[str, list[str]]:
    """Ключи записей сида по коллекциям — служебное поле `settings.seedIds`."""
    return {c.path: [row_key(c, r) for r in _collection_value(data, c.path)] for c in _seed_collections()}


def _known_seed_ids() -> dict[str, set[str]]:
    """Какие записи пришли из сидов. В базе до этого учёта — записи, ключи которых есть в текущем сиде."""
    db = store.data()
    known = db.settings.get("seedIds")
    if not isinstance(known, dict):
        known = seed_ids(_fresh_seed())
        db.settings["seedIds"] = known
    return {path: set(ids) for path, ids in known.items()}


def _mark_seed(path: str, keys: list[str]) -> None:
    current = store.data().settings.setdefault("seedIds", {}).setdefault(path, [])
    current.extend(k for k in keys if k not in set(current))


@cache
def _foreign_keys() -> dict[str, list[tuple[str, str]]]:
    """Внешние ключи доменных таблиц: путь коллекции → [(поле записи, путь коллекции-цели)]."""
    by_table = {c.table.name: c.path for c in COLLECTIONS.values()}
    out: dict[str, list[tuple[str, str]]] = {}
    for c in _seed_collections():
        if c.scalar:
            continue
        by_column = {f.columns[0]: f.key for f in c.fields if len(f.columns) == 1}
        refs = out.setdefault(c.path, [])
        for fk in c.table.foreign_keys:
            target = by_table.get(fk.column.table.name)
            field = by_column.get(fk.parent.name)
            if target is not None and field is not None:
                refs.append((field, target))
    return out


def _references(path: str, row: Any) -> Iterator[tuple[str, str, Any]]:
    """Ссылки записи на другие записи: (поле, коллекция-цель, id)."""
    if not isinstance(row, dict):
        return
    for field, target in _foreign_keys().get(path, []):
        value = row.get(field)
        if value is not None:
            yield field, target, value
    ref_field = _REF_FIELDS.get(path)
    ref = row.get(ref_field) if ref_field else None
    if (
        ref_field
        and isinstance(ref, dict)
        and ref.get("kind") in _REF_TARGETS
        and isinstance(ref.get("id"), str)
    ):
        yield ref_field, _REF_TARGETS[ref["kind"]], ref["id"]


def _money_refs() -> set[str]:
    """Всё, на что ссылаются записи о деньгах: события, люди, заявки, заказы, организации."""
    refs: set[str] = set()
    for path in MONEY_COLLECTIONS:
        for row in store.data().collection(COLLECTIONS[path]):
            for key, value in row.items():
                if isinstance(value, str) and key.endswith("Id"):
                    refs.add(value)
                elif isinstance(value, dict) and isinstance(value.get("id"), str):
                    refs.add(value["id"])
    return refs


def _kept_settings() -> dict[str, Any]:
    db = store.data()
    if not db.seeded:
        return {}
    # Настройки помощника и ставки оплаты задаёт администратор: обновление демо-данных их не трогает.
    return {k: db.settings[k] for k in ("assistant", "payments") if k in db.settings}


def load_seed(data: dict[str, Any]) -> None:
    """Заменить все коллекции содержимым `data`: словарь коллекций, как его собирает `seed.build_seed`."""
    db = store.data()
    for c in _seed_collections():
        db.replace(c, copy.deepcopy(_collection_value(data, c.path)))
    kept = _kept_settings()
    db.version = data["version"]
    db.seeded_at = data["seededAt"]
    db.seq = data["seq"]
    db.settings = {**copy.deepcopy(data["settings"]), **kept, "seedIds": seed_ids(data)}


def _write_backup(directory: str, snapshot: dict[str, Any]) -> Path | None:
    """Снимок записей людей перед обновлением демо-данных; хранятся последние `_BACKUPS_KEPT`."""
    folder = Path(directory)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        base = f"domain-{stamp}-v{snapshot['fromVersion']}-v{snapshot['toVersion']}"
        path = folder / f"{base}.json"
        n = 1
        while path.exists():
            n += 1
            path = folder / f"{base}-{n}.json"
        path.write_text(json.dumps(snapshot, ensure_ascii=False, default=str), encoding="utf-8")
        # Имя начинается с даты и времени: по алфавиту — по старшинству.
        for old in sorted(folder.glob("domain-*.json"))[:-_BACKUPS_KEPT]:
            old.unlink(missing_ok=True)
    except OSError:
        logger.exception("Снимок данных людей не сохранён в %s", directory)
        return None
    return path


def merge_seed(data: dict[str, Any]) -> dict[str, Any]:
    """Новая версия демо-данных без потери того, что создали люди.

    Записи из прошлых сидов (`settings.seedIds`) заменяются записями нового сида, записи людей
    остаются. Записи людей, которые ссылаются на исчезнувшие демо-записи, удаляются; у людей
    обнуляется только ссылка (район), сами аккаунты с паролями не трогаются. Записи о деньгах
    остаются как есть, а демо-записи, на которые они ссылаются, сохраняются.
    """
    db = store.data()
    fresh = not db.seeded
    known = None if fresh else db.settings.get("seedIds")
    new_ids = seed_ids(data)
    new_sets = {path: set(ids) for path, ids in new_ids.items()}
    old_sets = {path: set(ids) for path, ids in known.items()} if isinstance(known, dict) else new_sets
    money = set() if fresh else MONEY_COLLECTIONS
    money_refs = _money_refs() if money else set()
    references = set() if fresh else REFERENCE_COLLECTIONS

    old_rows: dict[str, dict[str, Any]] = {}
    merged: dict[str, list[Any]] = {}
    mine_by_path: dict[str, list[Any]] = {}
    protected: dict[str, set[str]] = {}
    reference_seed: dict[str, list[str]] = {}
    collisions = 0
    for c in _seed_collections():
        if c.path in money:
            continue
        rows = db.collection(c)
        new_keys, old_seed = new_sets[c.path], old_sets.get(c.path, set())
        old_rows[c.path] = {row_key(c, r): r for r in rows}
        if c.path in references:
            have = set(old_rows[c.path])
            added = [r for r in copy.deepcopy(_collection_value(data, c.path)) if row_key(c, r) not in have]
            merged[c.path] = [*rows, *added]
            mine_by_path[c.path] = [r for r in rows if row_key(c, r) not in old_seed]
            protected[c.path] = have
            # Демо-записью остаётся то, что пришло из сидов: записи администратора — нет.
            reference_seed[c.path] = sorted((old_seed & have) | (new_keys - have))
            continue
        mine: list[Any] = []
        rescued: list[Any] = []
        for r in rows:
            k = row_key(c, r)
            if k in new_keys:
                collisions += k not in old_seed
            elif k not in old_seed:
                mine.append(r)
            elif k in money_refs:
                rescued.append(r)
        seeded = copy.deepcopy(_collection_value(data, c.path))
        merged[c.path] = [*mine, *seeded, *rescued] if c.path in _NEWEST_FIRST else [*seeded, *rescued, *mine]
        mine_by_path[c.path] = mine
        protected[c.path] = {row_key(c, r) for r in rescued}

    snapshot = {
        "savedAt": clock.iso(clock.now()),
        "fromVersion": db.version,
        "toVersion": data["version"],
        "records": {path: rows for path, rows in mine_by_path.items() if rows},
        "money": {path: db.collection(COLLECTIONS[path]) for path in sorted(money)},
    }
    has_people = any(snapshot["records"].values()) or any(snapshot["money"].values())
    backup = (
        _write_backup(demo_options.backup_dir, snapshot) if demo_options.backup_dir and has_people else None
    )

    def present() -> dict[str, set[str]]:
        return {path: {row_key(COLLECTIONS[path], r) for r in rows} for path, rows in merged.items()}

    # Демо-записи, нужные записям о деньгах, тянут за собой то, на что ссылаются сами.
    keys_now = present()
    queue = [(path, k) for path, keys in protected.items() for k in keys]
    rescued_total = len(queue)
    while queue:
        path, k = queue.pop()
        for _field, target, value in _references(path, old_rows[path][k]):
            if target not in merged or value in keys_now[target] or value not in old_rows[target]:
                continue
            merged[target].append(old_rows[target][value])
            keys_now[target].add(value)
            protected[target].add(value)
            queue.append((target, value))
            rescued_total += 1

    removed: dict[str, int] = {}
    cleared = 0
    while True:
        keys_now = present()
        changed = False
        for path, rows in merged.items():
            keep: list[Any] = []
            for r in rows:
                dangling = [
                    field
                    for field, target, value in _references(path, r)
                    if target in keys_now and value not in keys_now[target]
                ]
                if not dangling or row_key(COLLECTIONS[path], r) in protected[path]:
                    keep.append(r)
                elif path == "users":
                    for field in dangling:
                        r[field] = None
                    cleared += 1
                    keep.append(r)
                else:
                    removed[path] = removed.get(path, 0) + 1
                    changed = True
            rows[:] = keep
        if not changed:
            break

    for path, rows in merged.items():
        db.replace(COLLECTIONS[path], rows)
    seed_map = {**new_ids, **{p: [*new_ids[p], *sorted(keys)] for p, keys in protected.items() if keys}}
    for path in money:
        seed_map[path] = list(known.get(path, [])) if isinstance(known, dict) else []
    seed_map.update(reference_seed)
    kept = _kept_settings()
    summary = {
        "fromVersion": db.version,
        "toVersion": data["version"],
        "kept": sum(len(rows) for rows in mine_by_path.values()),
        "removed": removed,
        "cleared": cleared,
        "rescued": rescued_total,
        "collisions": collisions,
        "backup": str(backup) if backup else None,
    }
    db.version = data["version"]
    db.seeded_at = data["seededAt"]
    db.seq = max(db.seq, data["seq"])
    db.settings = {**copy.deepcopy(data["settings"]), **kept, "seedIds": seed_map}
    if not fresh:
        logger.info(
            "Демо-данные обновлены с версии %s до %s: записей людей сохранено %s, висячих удалено %s %s, "
            "ссылок на район обнулено %s, демо-записей сохранено ради оплаты %s, совпадений ключей %s, снимок %s",
            summary["fromVersion"],
            summary["toVersion"],
            summary["kept"],
            sum(removed.values()),
            removed,
            cleared,
            rescued_total,
            collisions,
            summary["backup"] or "не сохранялся",
        )
    return summary


def _fresh_seed() -> dict[str, Any]:
    """Демо-данные с датами от текущего момента."""
    return seed.build_seed(clock.now())


def reset_demo() -> dict[str, Any]:
    """POST /demo/reset: пересоздать демо-данные с датами от текущего момента."""
    _require_demo_switches("/demo/reset")
    current = actor_id()
    load_seed(_fresh_seed())
    # Журнал помощника очищается вместе с данными.
    db = store.data()
    db.after_commit_sql.append(COLLECTIONS["aiRequests"].table.delete())
    # Аккаунт, созданный через регистрацию, после сброса не существует: выходим явно, а не «молча».
    signed_out = bool(current and not any(u["id"] == current for u in db.users))
    bus.publish(
        [
            "events",
            "participations",
            "messages",
            "organizations",
            "companions",
            "notifications",
            "sports",
            "users",
            "audit",
            "invites",
            "admin",
            "demo",
            "venues",
        ]
    )
    return {"ok": True, "signedOut": signed_out}


def ensure_seeded() -> bool:
    """Загрузить начальные данные или дополнить вымышленные анкеты без сброса базы.

    Новая версия сидов вливается в базу (`merge_seed`): люди и всё, что они создали, остаются.
    Полный сброс — только явный, `POST /demo/reset` от администратора.
    """
    db = store.data()
    if db.seeded and db.version == seed.SCHEMA_VERSION:
        marked = "seedIds" not in db.settings
        if marked:
            _known_seed_ids()
        before = {c["id"] for c in db.companions}
        added = seed_companion_people(
            {
                "settings": db.settings,
                "users": db.users,
                "sports": db.sports,
                "districts": db.districts,
                "companions": db.companions,
            },
            clock.now(),
        )
        if added:
            _mark_seed("companions", [c["id"] for c in db.companions if c["id"] not in before])
        return added or marked
    merge_seed(_fresh_seed())
    return True


_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
_TOKEN_RE = re.compile(r"\{\{date:([^}]+)\}\}")
# Сдвиг дат двигает расписание, а не прошлое: журналы и сроки действия ключей и ссылок
# идут по настоящим часам, иначе токен не истечёт, а журнал покажет неверное время.
_REAL_TIME_COLLECTIONS = {"audit", "mcpCalls"}
_REAL_TIME_FIELDS = {"expiresAt", "revokedAt", "lastUsedAt"}


def _shift_iso(value: str, days: int) -> str:
    """Дата ISO на `days` календарных дней позже; местное время суток сохраняется."""
    moment = clock.parse(value)
    if moment is None:
        return value
    return clock.iso(clock.local(moment) + timedelta(days=days))


def _shift_value(value: Any, days: int) -> Any:
    if isinstance(value, str):
        if _ISO_RE.match(value):
            return _shift_iso(value, days)
        if "{{date:" in value:
            return _TOKEN_RE.sub(lambda m: f"{{{{date:{_shift_iso(m.group(1), days)}}}}}", value)
        return value
    if isinstance(value, list):
        return [_shift_value(v, days) for v in value]
    if isinstance(value, dict):
        return {k: v if k in _REAL_TIME_FIELDS else _shift_value(v, days) for k, v in value.items()}
    return value


def dates_stale_days() -> int:
    """Сколько календарных дней (по поясу отображения) прошло с подготовки демо-данных."""
    db = store.data()
    if not db.seeded:
        return 0
    seeded = clock.parse(db.seeded_at)
    if seeded is None:
        return 0
    return (clock.local(clock.now()).date() - clock.local(seeded).date()).days


def refresh_dates() -> bool:
    """Демо-данные открыли в другой календарный день: даты демо-записей сдвигаются на целое число дней.

    «Завтра» и «в субботу» снова впереди, время встреч не меняется. Сдвигаются только записи из сидов
    (`settings.seedIds`): встречи, записи и уведомления людей, даты их регистрации и записи о деньгах
    остаются как есть. Журналы и сроки действия тоже не сдвигаются (`_REAL_TIME_COLLECTIONS`,
    `_REAL_TIME_FIELDS`).
    """
    days = dates_stale_days()
    if days < 1:
        return False
    db = store.data()
    known = _known_seed_ids()
    seed_map: dict[str, list[str]] = dict(db.settings["seedIds"])
    for c in _seed_collections():
        keys = known.get(c.path)
        if c.path in MONEY_COLLECTIONS or c.path in _REAL_TIME_COLLECTIONS or not keys:
            continue
        if c.path == "events":
            rows = db.records("events", c.table.c.id.in_(keys), predicate=lambda r: r["id"] in keys)
            shifted = []
            for row in rows:
                value = _shift_value(row, days)
                row.clear()
                row.update(value)
                shifted.append(row_key(c, row))
            seed_map[c.path] = shifted
            continue
        rows = db.collection(c)
        shifted: list[str] = []
        for i, r in enumerate(rows):
            if row_key(c, r) in keys:
                rows[i] = _shift_value(r, days)
                shifted.append(row_key(c, rows[i]))
        # Составной ключ может включать дату: учёт сидов идёт за сдвинутыми записями.
        seed_map[c.path] = shifted
    db.seeded_at = _shift_value(db.seeded_at, days)
    db.settings = {
        **_shift_value({k: v for k, v in db.settings.items() if k != "seedIds"}, days),
        "seedIds": seed_map,
        "datesShiftedAt": clock.iso(clock.now()),
        "datesShiftedDays": days,
    }
    bus.publish(["events", "participations", "notifications", "messages", "demo", "venues"])
    return True


# ---------- Подсказки прав для интерфейса (accessControlProvider) ----------


def can(resource: str, action: str, params: Params | None = None) -> dict[str, Any]:
    """Что показывать и что делать активным. Это подсказка экрану: каждое действие ещё раз проверяет домен."""
    params = params if isinstance(params, dict) else {}
    db = store.data()
    user = actor()
    is_admin = user is not None and user["role"] == "admin"

    def deny(reason: str) -> dict[str, Any]:
        return {"can": False, "reason": reason}

    allow = {"can": True}

    if resource == "admin":
        return allow if is_admin else deny("Раздел доступен только администратору")

    if user is None:
        if action in {"list", "show"}:
            return deny("Войдите, чтобы продолжить") if resource in {"notifications", "me"} else allow
        return deny("Войдите, чтобы продолжить")

    def event(id_: Any) -> Any:
        return db.record("events", id_) if isinstance(id_, str) else None

    key = f"{resource}.{action}"
    if key == "events.create":
        return deny("Администратор не создаёт события") if is_admin else allow
    if key == "events.createAsOrg":
        org = next(
            (o for o in db.organizations if o["id"] == params.get("orgId") and o["ownerId"] == user["id"]),
            None,
        )
        if org is None:
            return deny("Публиковать от имени организации может только её представитель")
        return (
            allow
            if org["status"] == "approved"
            else deny("Организация ещё не допущена. Публиковать от её имени можно после проверки")
        )
    if key == "events.manage":
        e = event(params.get("id"))
        return (
            allow
            if e is not None and core.domain.is_organizer(user, e)
            else deny("Управлять событием может только организатор")
        )
    if key in {"events.moderate", "organizations.decide"}:
        return allow if is_admin else deny("Только администратор")
    if key == "participations.decide":
        e = event(params.get("eventId"))
        return (
            allow
            if e is not None and core.domain.is_organizer(user, e)
            else deny("Решение по заявке принимает организатор события")
        )
    if key == "messages.hide":
        e = event(params.get("eventId"))
        return (
            allow
            if is_admin or (e is not None and core.domain.is_organizer(user, e))
            else deny("Скрывать сообщения может организатор или администратор")
        )
    if key in {"organizations.create", "companions.create", "companions.metoo"}:
        return deny("Недоступно администратору") if is_admin else allow
    if key == "organizations.edit":
        org = next((o for o in db.organizations if o["id"] == params.get("id")), None)
        return (
            allow
            if org is not None and org["ownerId"] == user["id"]
            else deny("Изменять организацию может только её представитель")
        )
    return allow


__all__ = [
    "acting_as",
    "actor",
    "assistant_failure",
    "assistant_fallback",
    "can",
    "configure_demo",
    "create",
    "delete_one",
    "ensure_seeded",
    "get_list",
    "get_many",
    "get_one",
    "lazy_checks",
    "load_seed",
    "log_assistant",
    "merge_seed",
    "refresh_dates",
    "registry",
    "reset_demo",
    "update",
]
