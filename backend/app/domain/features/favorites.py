"""С8 «Подписки и избранное».

Сердечко на событии, подписка на клуб и на организатора-человека, сохранённый поиск ленты.
Когда публикуется встреча, подходящая под подписку или поиск, человек получает одно уведомление
(без повторов, даже если подошло несколько подписок). Всё собрано во вкладке «Избранное» в «Моих занятиях».
"""

import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.kit import (
    commit,
    date_token,
    db,
    get_event,
    notify,
    organizer_ids,
    require_user,
)
from app.domain.features.managers import engagement, is_manager, manager_ids_of
from app.domain.features.participation_host import input_text
from app.domain.routing import Route, route
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

MAX_SEARCHES = 10
MAX_FAVORITES = 200
NAME_MAX = 60
OPEN = ["upcoming", "live"]
SEARCH_KEYS = [
    "place@city",
    "month",
    "family",
    "program.kind",
    "q",
    "sportIds",
    "when",
    "date",
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
    "composition",
    "access",
]

_SPACES = re.compile(r"\s+")
_QUOTES = re.compile(r"[«»]")


def _can_collect(actor: Actor) -> Entity:
    user = require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "У администратора нет избранного и подписок")
    return user


def is_favorite(actor: Actor, event_id: ID) -> bool:
    return actor is not None and any(
        f["userId"] == actor["id"] and f["eventId"] == event_id for f in db().engagement.favorites
    )


def set_favorite(actor: Actor, event_id: ID, on: bool) -> Entity:
    user = _can_collect(actor)
    e = get_event(event_id)
    if e["status"] == "deleted":
        fail("event_deleted", "Событие удалено")
    s = engagement()
    exists = any(f["userId"] == user["id"] and f["eventId"] == e["id"] for f in s.favorites)
    if on and not exists:
        if sum(1 for f in s.favorites if f["userId"] == user["id"]) >= MAX_FAVORITES:
            fail("validation", "В избранном слишком много событий. Уберите прошедшие")
        s.favorites.append({"userId": user["id"], "eventId": e["id"], "at": clock.iso(clock.now())})
    if not on and exists:
        s.favorites = [f for f in s.favorites if not (f["userId"] == user["id"] and f["eventId"] == e["id"])]
    if on != exists:
        commit(["events"], [e["id"]])
    return {"eventId": e["id"], "favorite": on}


# ---------- Подписки ----------


def _owners_of(kind: str, id_: ID) -> list[ID]:
    """Кто управляет целью подписки: на себя и на свой клуб подписаться нельзя."""
    if kind == "org":
        o = next((x for x in db().organizations if x["id"] == id_), None)
        if o is None or o["status"] != "approved":
            fail("not_found", "Страница организации недоступна")
        return [o["ownerId"], *manager_ids_of(o["id"])]
    u = next((x for x in db().users if x["id"] == id_), None)
    if u is None or u["role"] == "admin":
        fail("not_found", "Профиль недоступен")
    return [u["id"]]


def _follow_block(actor: Actor, kind: str, id_: ID) -> str:
    if actor is None:
        return "Войдите, чтобы подписаться"
    if actor["role"] == "admin":
        return "Администратор не подписывается на организаторов"
    if actor["id"] in _owners_of(kind, id_):
        return "Это ваша организация" if kind == "org" else "Это ваш профиль"
    return ""


def follow_state(actor: Actor, kind: str, id_: ID) -> Entity:
    if kind not in {"org", "user"}:
        fail("bad_request", "Неизвестный вид подписки")
    reason = _follow_block(actor, kind, id_)
    all_ = [f for f in db().engagement.follows if f["kind"] == kind and f["targetId"] == id_]
    return {
        "kind": kind,
        "targetId": id_,
        "following": actor is not None and any(f["userId"] == actor["id"] for f in all_),
        "followers": len(all_),
        "reason": reason,
    }


def set_follow(actor: Actor, kind: str, id_: ID, on: bool) -> Entity:
    user = _can_collect(actor)
    if kind not in {"org", "user"}:
        fail("bad_request", "Неизвестный вид подписки")
    if on:
        reason = _follow_block(user, kind, id_)
        if reason:
            fail("forbidden", reason)
    s = engagement()
    exists = any(f["userId"] == user["id"] and f["kind"] == kind and f["targetId"] == id_ for f in s.follows)
    if on and not exists:
        s.follows.append({"userId": user["id"], "kind": kind, "targetId": id_, "at": clock.iso(clock.now())})
    if not on and exists:
        s.follows = [
            f
            for f in s.follows
            if not (f["userId"] == user["id"] and f["kind"] == kind and f["targetId"] == id_)
        ]
    if on != exists:
        commit(["organizations"] if kind == "org" else ["users"], [id_])
    return follow_state(user, kind, id_)


# ---------- Сохранённые поиски ----------


def _clean_criteria(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in SEARCH_KEYS:
        v = raw.get(key)
        if v is not None and v != "":
            out[key] = v
    return out


def _matching(
    d: "Domain", user: Entity, criteria: dict[str, Any], ids: list[ID] | None = None
) -> list[Entity]:
    return d.list_events(
        user, {**criteria, "scope": "feed", **({"ids": ids} if ids is not None else {})}, raw=True
    )


def save_search(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    user = _can_collect(actor)
    name = _SPACES.sub(" ", input_text(input_.get("name")).strip())[:NAME_MAX]
    if len(name) < 2:
        fail("validation", "Назовите поиск", {"name": "Например: «Шахматы по вечерам»"})
    criteria = _clean_criteria(input_.get("criteria"))
    if not criteria:
        fail("validation", "Сначала выберите, что искать: направление, день или район")
    query = input_text(input_.get("query")).removeprefix("?")[:500]
    s = engagement()
    mine = [x for x in s.saved_searches if x["userId"] == user["id"]]
    if any(x["query"] == query for x in mine):
        fail("duplicate", "Такой поиск уже сохранён. Он во вкладке «Избранное» в «Моих занятиях»")
    if len(mine) >= MAX_SEARCHES:
        fail("validation", f"Можно сохранить до {MAX_SEARCHES} поисков. Удалите ненужный")
    saved = {
        "id": store.next_id("ss"),
        "userId": user["id"],
        "name": name,
        "query": query,
        "criteria": criteria,
        "summary": input_text(input_.get("summary")).strip()[:200],
        "createdAt": clock.iso(clock.now()),
    }
    s.saved_searches.append(saved)
    commit(["users"], [user["id"]])
    return {**saved, "matches": len(_matching(d, user, criteria))}


def delete_search(actor: Actor, id_: ID) -> Entity:
    user = require_user(actor)
    s = engagement()
    found = next((x for x in s.saved_searches if x["id"] == id_), None)
    if found is None or found["userId"] != user["id"]:
        fail("not_found", "Поиск уже удалён")
    s.saved_searches = [x for x in s.saved_searches if x is not found]
    commit(["users"], [user["id"]])
    return {"id": id_}


# ---------- Вкладка «Избранное» ----------


def favorites_view(d: "Domain", actor: Actor) -> Entity:
    user = _can_collect(actor)
    s = db().engagement
    favorites = [f for f in s.favorites if f["userId"] == user["id"]]
    found = [db().record("events", f["eventId"]) for f in favorites]
    views = d.event_views(user, [e for e in found if e is not None and e["status"] != "deleted"])
    # Сначала то, что впереди, по времени; прошедшие и отменённые в конце, свежие из них первыми
    events = [
        *sorted((v for v in views if v["state"] in OPEN), key=lambda v: v["startsAt"]),
        *sorted((v for v in views if v["state"] not in OPEN), key=lambda v: v["startsAt"], reverse=True),
    ]

    def follow_view(f: Entity) -> list[Entity]:
        own = sum(
            1
            for e in d._organizer_events_for_read({"kind": f["kind"], "id": f["targetId"]})  # noqa: SLF001 indexed domain read
            if d.event_state(e) in OPEN
        )
        if f["kind"] == "org":
            o = next((x for x in db().organizations if x["id"] == f["targetId"]), None)
            if o is None:
                return []
            return [
                {
                    "kind": f["kind"],
                    "id": o["id"],
                    "name": o["name"],
                    "avatarUrl": o["logoUrl"],
                    "caption": "Клуб или организация"
                    if o["status"] == "approved"
                    else "Страница сейчас закрыта",
                    "link": f"/orgs/{o['id']}",
                    "upcoming": own,
                    "at": f["at"],
                }
            ]
        u = d.user(f["targetId"])
        if u is None:
            return []
        return [
            {
                "kind": f["kind"],
                "id": u["id"],
                "name": u["name"],
                "avatarUrl": u["avatarUrl"],
                "caption": "Организатор",
                "link": f"/profile/{u['id']}",
                "upcoming": own,
                "at": f["at"],
            }
        ]

    mine = sorted((f for f in s.follows if f["userId"] == user["id"]), key=lambda f: f["at"], reverse=True)
    follows = [view for f in mine for view in follow_view(f)]

    searches = [
        {
            "id": x["id"],
            "name": x["name"],
            "query": x["query"],
            "summary": x["summary"],
            "createdAt": x["createdAt"],
            "matches": len(_matching(d, user, x["criteria"])),
        }
        for x in sorted(
            (x for x in s.saved_searches if x["userId"] == user["id"]),
            key=lambda x: x["createdAt"],
            reverse=True,
        )
    ]

    return {"events": events, "follows": follows, "searches": searches}


# ---------- Уведомление о новой подходящей встрече ----------


def notify_followers(d: "Domain", e: Entity) -> None:
    """Вызывается при публикации события. Каждому подписчику — одно уведомление на встречу.

    Сначала подписка на организатора, иначе первый подходящий сохранённый поиск.
    Автору, организаторам и администраторам не пишем.
    """
    s = db().engagement
    if not s.follows and not s.saved_searches:
        return
    skip = set(organizer_ids(e))
    skip.add(e["createdBy"])
    reasons: dict[ID, str] = {}
    for f in s.follows:
        if (
            f["kind"] == e["organizer"]["kind"]
            and f["targetId"] == e["organizer"]["id"]
            and f["userId"] not in reasons
        ):
            reasons[f["userId"]] = "follow"
    for search in s.saved_searches:
        if search["userId"] in reasons:
            continue
        user = d.user(search["userId"])
        if user is None or len(_matching(d, user, search["criteria"], [e["id"]])) == 0:
            continue
        reasons[search["userId"]] = search["name"]
    district = next((x["name"] for x in db().districts if x["id"] == e["place"].get("districtId")), None)
    if e["organizer"]["kind"] == "org":
        organizer = next((o["name"] for o in db().organizations if o["id"] == e["organizer"]["id"]), None)
    else:
        organizer = (d.user(e["organizer"]["id"]) or {}).get("name")
    for user_id, reason in reasons.items():
        key = f"{user_id}|{e['id']}"
        user = d.user(user_id)
        if user is None or user["role"] == "admin" or user_id in skip or key in s.match_notified:
            continue
        if e["organizer"]["kind"] == "org" and is_manager(e["organizer"]["id"], user_id):
            continue
        s.match_notified.append(key)
        notify(
            d,
            [user_id],
            "new_match",
            f"Новая встреча у «{_QUOTES.sub('', organizer or '')}»"
            if reason == "follow"
            else f"Новое по поиску «{reason}»",
            f"«{e['title']}», {date_token(e['startsAt'])}{f', {district}' if district else ''}. Если подходит, запишитесь в карточке.",
            f"/events/{e['id']}",
        )


# ---------- Маршруты ----------


def favorites_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/me/favorites$", lambda _p, _b, _q: favorites_view(d, actor())),
        route("put", r"^/events/([^/]+)/favorite$", lambda p, _b, _q: set_favorite(actor(), p[0], True)),
        route("delete", r"^/events/([^/]+)/favorite$", lambda p, _b, _q: set_favorite(actor(), p[0], False)),
        route("get", r"^/follows/(org|user)/([^/]+)$", lambda p, _b, _q: follow_state(actor(), p[0], p[1])),
        route(
            "put",
            r"^/follows/(org|user)/([^/]+)$",
            lambda p, _b, _q: set_follow(actor(), p[0], p[1], True),
        ),
        route(
            "delete",
            r"^/follows/(org|user)/([^/]+)$",
            lambda p, _b, _q: set_follow(actor(), p[0], p[1], False),
        ),
        route("post", r"^/saved-searches$", lambda _p, b, _q: save_search(d, actor(), b)),
        route("delete", r"^/saved-searches/([^/]+)$", lambda p, _b, _q: delete_search(actor(), p[0])),
    ]
