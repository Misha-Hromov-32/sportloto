"""«Поделиться с близким» и Н5 «Информация без интернета».

Записавшийся участник получает ссылку `/share/:token` для родных: название, время, адрес,
как найти, контакт организатора и имя участника — только то, что он видит сам. Ссылка
работает без входа до конца встречи, её можно отозвать. Для офлайна сервер отдаёт
карточки ближайших записей, экран хранит их на устройстве.
"""

import secrets
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING

from app.domain import clock
from app.domain.errors import fail
from app.domain.features.kit import commit, db, get_event, participation, require_user
from app.domain.features.managers import engagement
from app.domain.features.participation_host import event_end
from app.domain.routing import Route, route
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

OFFLINE_LIMIT = 5
OPEN = ["upcoming", "live"]


def _new_token() -> str:
    return secrets.token_hex(10)


def _expires(link: Entity) -> datetime | None:
    return clock.parse(link["expiresAt"])


def _active_link(event_id: ID, user_id: ID, now: datetime) -> Entity | None:
    return next(
        (
            lnk
            for lnk in db().engagement.share_links
            if lnk["eventId"] == event_id
            and lnk["userId"] == user_id
            and not lnk.get("revokedAt")
            and (expires := _expires(lnk)) is not None
            and expires > now
        ),
        None,
    )


def _share_block(d: "Domain", user: Entity, e: Entity) -> str:
    if d.event_state(e) not in OPEN:
        return "Поделиться можно только встречей, которая ещё не закончилась"
    if (participation(e["id"], user["id"]) or {}).get("status") != "confirmed":
        return "Поделиться встречей могут участники, которых уже записали"
    return ""


def share_state(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    reason = _share_block(d, user, e)
    link = None if reason else _active_link(e["id"], user["id"], clock.now())
    return {
        "canShare": not reason,
        "reason": reason,
        "link": {
            "token": link["token"],
            "path": f"/share/{link['token']}",
            "expiresAt": link["expiresAt"],
            "createdAt": link["createdAt"],
        }
        if link is not None
        else None,
    }


def create_share(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    reason = _share_block(d, user, e)
    if reason:
        fail("bad_state", reason)
    now = clock.now()
    end = event_end(e)
    if _active_link(e["id"], user["id"], now) is None:
        engagement().share_links.append(
            {
                "token": _new_token(),
                "eventId": e["id"],
                "userId": user["id"],
                "createdAt": clock.iso(now),
                # Ссылка живёт до конца встречи
                "expiresAt": clock.iso(end if end is not None else now),
                "revokedAt": None,
            }
        )
        commit(["participations"], [e["id"]])
    return share_state(d, user, e["id"])


def revoke_share(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    now = clock.now()
    link = _active_link(e["id"], user["id"], now)
    if link is not None:
        link["revokedAt"] = clock.iso(now)
        commit(["participations"], [e["id"]])
    return share_state(d, user, e["id"])


def _organizer_contact(e: Entity) -> dict[str, str]:
    """Контакт организатора, который видит участник: телефон и почта клуба.

    У частного лица — только сведения для участников.
    """
    if e["organizer"]["kind"] == "org":
        o = next((x for x in db().organizations if x["id"] == e["organizer"]["id"]), None)
        if o is None:
            return {"name": "Организация", "contact": ""}
        return {
            "name": o["name"],
            "contact": ", ".join(c for c in [o["contacts"]["phone"], o["contacts"]["email"]] if c),
        }
    u = next((x for x in db().users if x["id"] == e["organizer"]["id"]), None)
    return {"name": u["name"] if u is not None else "Организатор", "contact": ""}


def _how_to_find(e: Entity) -> str:
    return ". ".join(x for x in [e["place"].get("landmark"), e["firstStep"].get("howToFind")] if x)


def shared_card(d: "Domain", token: str) -> Entity:
    """Страница по ссылке открывается без входа. Устаревшая или отозванная ссылка не раскрывает подробностей."""
    link = next((lnk for lnk in db().engagement.share_links if lnk["token"] == token), None)
    if link is None:
        fail("not_found", "Ссылка не найдена. Возможно, в ней опечатка")
    e = db().record("events", link["eventId"])
    if e is None:
        fail("not_found", "Встреча не найдена")
    person = next((u for u in db().users if u["id"] == link["userId"]), None)
    state = d.event_state(e)
    expires = _expires(link)
    if link.get("revokedAt"):
        status = "revoked"
    elif expires is not None and expires <= clock.now():
        status = "expired"
    elif state in {"cancelled", "removed", "deleted"}:
        status = "cancelled"
    elif (participation(e["id"], link["userId"]) or {}).get("status") != "confirmed":
        status = "left"
    else:
        status = "active"
    open_ = status == "active"
    organizer = _organizer_contact(e)
    sport = next((s for s in db().sports if s["id"] == e["sportId"]), None)
    return {
        "status": status,
        "participantName": person["name"].split(" ")[0] if person is not None else "Участник",
        "title": "" if status in {"revoked", "expired"} else e["title"],
        "sportName": sport["name"] if open_ and sport is not None else "",
        "startsAt": e["startsAt"],
        "durationMin": e["durationMin"],
        "address": e["place"]["address"] if open_ else "",
        "howToFind": _how_to_find(e) if open_ else "",
        "organizerName": organizer["name"] if open_ else "",
        "organizerContact": organizer["contact"] if open_ else "",
        "privateInfo": e["privateInfo"] if open_ else "",
        "cancelReason": e["cancelReason"] if status == "cancelled" else "",
        "expiresAt": link["expiresAt"],
    }


def offline_cards(d: "Domain", actor: Actor) -> list[Entity]:
    """Н5: ближайшие подтверждённые записи с адресом, ориентирами и контактами — для хранения на устройстве."""
    user = require_user(actor)
    now = clock.now()
    found = [
        db().record("events", p["eventId"])
        for p in db().participations
        if p["userId"] == user["id"] and p["status"] == "confirmed"
    ]
    events = sorted(
        (
            e
            for e in found
            if e is not None and d.event_state(e) in OPEN and (end := event_end(e)) is not None and end > now
        ),
        key=lambda e: e["startsAt"],
    )[:OFFLINE_LIMIT]

    def card(e: Entity) -> Entity:
        organizer = _organizer_contact(e)
        sport = next((s for s in db().sports if s["id"] == e["sportId"]), None)
        return {
            "eventId": e["id"],
            "title": e["title"],
            "sportName": sport["name"] if sport is not None else "",
            "startsAt": e["startsAt"],
            "durationMin": e["durationMin"],
            "address": e["place"]["address"],
            "howToFind": _how_to_find(e),
            "bring": e["firstStep"].get("bring"),
            "organizerName": organizer["name"],
            "organizerContact": organizer["contact"],
            "privateInfo": e["privateInfo"],
        }

    return [card(e) for e in events]


# ---------- Маршруты ----------


def share_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/events/([^/]+)/share$", lambda p, _b, _q: share_state(d, actor(), p[0])),
        route("post", r"^/events/([^/]+)/share$", lambda p, _b, _q: create_share(d, actor(), p[0])),
        route("delete", r"^/events/([^/]+)/share$", lambda p, _b, _q: revoke_share(d, actor(), p[0])),
        route("get", r"^/share/([^/]+)$", lambda p, _b, _q: shared_card(d, p[0])),
        route("get", r"^/me/offline-cards$", lambda _p, _b, _q: offline_cards(d, actor())),
    ]
