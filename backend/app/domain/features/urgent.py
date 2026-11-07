"""С3 «Срочный добор игроков».

За 48 часов до начала организатор пишет, скольких не хватает. Подходящим по направлению,
уровню и району приходит уведомление, в ленте появляется метка «Срочно: нужно N».
Метка гаснет сама, когда людей добрали, и за час до начала.
"""

from collections.abc import Collection
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock
from app.domain.errors import fail
from app.domain.features.kit import (
    commit,
    confirmed_count,
    date_token,
    db,
    get_event,
    notify,
    organizer_ids,
    participation,
    require_user,
)
from app.domain.lib.geo import distance_km
from app.domain.lib.numbers import NBSP, parse_number
from app.domain.lib.plural import plural
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

# Добор включается за 48 часов до начала и гаснет за час.
WINDOW = timedelta(hours=48)
STOP_BEFORE = timedelta(hours=1)
MAX_NEED = 10
MAX_NOTIFY = 15
# Насколько далеко от дома человека может быть встреча, чтобы его позвать.
NEAR_KM = 7

PLAYERS_GEN = ("игрока", "игроков", "игроков")


def players_needed(n: int) -> str:
    return f"{n}{NBSP}{plural(n, PLAYERS_GEN)}"


def _remaining_of(e: Entity, need: int, baseline: int) -> int:
    confirmed = confirmed_count(e["id"])
    left = need - max(0, confirmed - baseline)
    if e["capacity"] is not None:
        left = min(left, max(0, e["capacity"] - confirmed))
    return max(0, left)


def _open_call(e: Entity) -> Entity | None:
    return next((c for c in db().urgent_calls if c["eventId"] == e["id"] and not c.get("closedAt")), None)


def urgent_badge(e: Entity, now: datetime) -> Entity | None:
    """Метка для ленты и карточки. Читает только данные: её вызывает domain.event_view."""
    call = _open_call(e)
    if call is None or e["status"] != "published":
        return None
    start = clock.parse(e["startsAt"])
    if start is None or start - now <= STOP_BEFORE:
        return None
    need = _remaining_of(e, call["need"], call["baseline"])
    return {"need": need, "until": clock.iso(start - STOP_BEFORE)} if need > 0 else None


def _level_fits(user_level: str | None, e: Entity) -> bool:
    if e["level"] == "any" or e["beginnersWelcome"]:
        return True
    if not user_level:
        return e["level"] != "experienced"
    if user_level == e["level"]:
        return True
    return e["level"] == "amateur" and user_level == "experienced"


def _home_of(u: Entity) -> dict[str, Any] | None:
    if u.get("home") is not None:
        return u["home"]
    d = next((x for x in db().districts if x["id"] == u.get("districtId")), None)
    return {"lat": d["lat"], "lng": d["lng"]} if d is not None else None


def _not_joined(e: Entity, u: Entity) -> bool:
    p = participation(e["id"], u["id"])
    return p is None or not (p["status"] in ACTIVE_PARTICIPATION or p["status"] == "rejected")


def _near(e: Entity, u: Entity) -> bool:
    home = _home_of(u)
    if home is None:
        return False
    km = distance_km(home, e["place"])
    # Неизвестное расстояние (нет координат) — не «рядом»
    return km is not None and km <= NEAR_KM


def urgent_candidates(e: Entity, notified: Collection[ID] = ()) -> list[Entity]:
    """Кого позвать: направление в интересах, уровень подходит, живёт недалеко, ещё не записан и не получал отказа.

    Тех, кому уже писали (`notified`), отсекаем до ограничения числа: повторный зов достаётся новым людям.
    """
    skip = {*organizer_ids(e), *notified}
    users = [u for u in db().users if u["role"] == "user" and u["id"] not in skip]
    users = [u for u in users if e["sportId"] in u["interests"]]
    users = [u for u in users if _not_joined(e, u)]
    users = [u for u in users if _level_fits(u["levels"].get(e["sportId"]), e)]
    users = [u for u in users if _near(e, u)]
    return users[:MAX_NOTIFY]


def urgent_view(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    e = get_event(event_id)
    if not d.is_organizer(actor, e) and (actor or {}).get("role") != "admin":
        fail("forbidden", "Срочный добор видит только организатор события")
    now = clock.now()
    call = _open_call(e)
    badge = urgent_badge(e, now)
    confirmed = confirmed_count(e["id"])
    spots = MAX_NEED if e["capacity"] is None else max(0, e["capacity"] - confirmed)
    state = d.event_state(e)
    start = clock.parse(e["startsAt"]) or now
    reason = ""
    if state != "upcoming":
        reason = "Событие уже началось, прошло или отменено."
    elif start - now > WINDOW:
        reason = "Срочный добор включается за 48 часов до начала. Пока можно позвать людей из «Ищу компанию»."
    elif start - now <= STOP_BEFORE:
        reason = "До начала меньше часа, звать людей уже поздно."
    elif spots == 0:
        reason = "Все места заняты."
    return {
        "eventId": e["id"],
        "active": badge is not None,
        "need": call["need"] if call is not None else 0,
        "remaining": badge["need"] if badge is not None else 0,
        "notified": len(call["notified"]) if call is not None else 0,
        "createdAt": call["createdAt"] if call is not None else None,
        "canStart": not reason,
        "reason": reason,
        "maxNeed": min(MAX_NEED, spots),
        "until": clock.iso(start - STOP_BEFORE),
    }


def start_urgent(d: "Domain", actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    if not d.is_organizer(user, e):
        fail("forbidden", "Позвать игроков может только организатор события")
    view = urgent_view(d, user, e["id"])
    if not view["canStart"]:
        fail("bad_state" if d.event_state(e) == "upcoming" else "event_inactive", view["reason"])
    raw = parse_number(input_.get("need"))
    need = round(raw) if raw is not None else None
    if need is None or need < 1 or need > view["maxNeed"]:
        fail("validation", f"Укажите число от 1 до {view['maxNeed']}", {"need": f"От 1 до {view['maxNeed']}"})

    list_ = db().urgent_calls
    now = clock.iso(clock.now())
    call = _open_call(e)
    if call is not None:
        call.update({"need": need, "baseline": confirmed_count(e["id"])})
    else:
        call = {
            "eventId": e["id"],
            "need": need,
            "baseline": confirmed_count(e["id"]),
            "createdBy": user["id"],
            "createdAt": now,
            "notified": [],
            "closedAt": None,
        }
        list_.append(call)
    # Повторный запрос с другим числом зовёт только тех, кому ещё не писали
    fresh = urgent_candidates(e, call["notified"])
    district = next((x for x in db().districts if x["id"] == e["place"].get("districtId")), {}).get("name")
    notify(
        d,
        [u["id"] for u in fresh],
        "urgent",
        "Срочно нужны игроки",
        f"«{e['title']}», {date_token(e['startsAt'])}{f', {district}' if district else ''}: не хватает {players_needed(need)}. Если можете прийти, запишитесь в карточке.",
        f"/events/{e['id']}",
    )
    call["notified"].extend(u["id"] for u in fresh)
    commit(["events", "notifications"], [e["id"]])
    return urgent_view(d, user, e["id"])


def stop_urgent(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    if not d.is_organizer(user, e):
        fail("forbidden", "Это может сделать только организатор события")
    call = _open_call(e)
    if call is not None:
        call["closedAt"] = clock.iso(clock.now())
        commit(["events"], [e["id"]])
    return urgent_view(d, user, e["id"])
