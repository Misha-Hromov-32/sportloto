"""С6. План Б.

Встречу отменили или перенесли на неудобное время — человеку сразу предлагаются похожие встречи,
на которые можно записаться прямо сейчас. Похожая — то же направление, в пределах двух дней
от исходного времени, есть места, человеку можно записаться; ближе к нему по расстоянию, потом по времени.
"""

import math
from datetime import datetime, timedelta

from app.domain import clock
from app.domain.schema import COLLECTIONS
from app.domain.errors import fail
from app.domain.features.participation_host import ParticipationHost, my_participation
from app.domain.features.waitlist_offer import held_seats
from app.domain.lib.geo import distance_km
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

WINDOW = timedelta(days=2)
LIMIT = 3


def _km(value: float | None) -> float:
    """Расстояние для сортировки: неизвестное — в конец списка."""
    return math.inf if value is None else value


def similar_events(
    host: ParticipationHost,
    actor: Actor,
    e: Entity,
    since: datetime | None = None,
) -> list[Entity]:
    """Похожие встречи.

    `since` — когда встреча сорвалась (по умолчанию — сейчас): куда человек записался после этого
    (прямо из списка), остаётся в списке со статусом; куда был записан раньше, взамен не предлагаем.
    """
    db = host.db
    now = clock.now()
    if since is None:
        since = now
    start = clock.parse(e["startsAt"])
    if start is None:
        return []

    def sport_of(id_: ID) -> ID:
        s = next((s for s in db.sports if s["id"] == id_), None)
        merged = s.get("mergedInto") if s is not None else None
        return merged if merged is not None else id_

    sport = sport_of(e["sportId"])
    point = host.actor_point(actor) if actor is not None else None
    from_ = point if point is not None else e["place"]

    def keep(x: Entity, x_start: datetime | None) -> bool:
        if x["id"] == e["id"] or sport_of(x["sportId"]) != sport:
            return False
        if host.event_state(x) != "upcoming":
            return False
        if x_start is None or abs(x_start - start) > WINDOW:
            return False
        mine = my_participation(db, actor["id"], x["id"]) if actor is not None else None
        if mine is not None and mine["status"] in ACTIVE_PARTICIPATION:
            joined_at = clock.parse(mine["createdAt"])
            return mine["status"] != "waitlist" and joined_at is not None and joined_at >= since
        if (
            x["capacity"] is not None
            and host.confirmed_count(x) + held_seats(db, x["id"], now) >= x["capacity"]
        ):
            return False
        return host.can_join(actor, x)["ok"]

    rows = []
    table = COLLECTIONS["events"].table
    sports = {s["id"] for s in db.sports if sport_of(s["id"]) == sport} | {sport}
    candidates = db.records("events", table.c.sport_id.in_(sports), table.c.starts_at.between(start - WINDOW, start + WINDOW),
                            predicate=lambda x: sport_of(x["sportId"]) == sport and
                            (x_start := clock.parse(x["startsAt"])) is not None and abs(x_start - start) <= WINDOW)
    for x in candidates:
        x_start = clock.parse(x["startsAt"])
        if keep(x, x_start):
            rows.append((_km(distance_km(from_, x["place"])), abs(x_start - start), x))
    rows.sort(key=lambda row: row[:2])
    return [x for _, _, x in rows[:LIMIT]]


def plan_b_view(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    mine = my_participation(host.db, actor["id"], event_id) if actor is not None else None
    reason = (
        "reschedule"
        if (mine or {}).get("leftBecause") == "reschedule"
        else "cancelled"
        if host.event_state(e) == "cancelled" and mine is not None and mine["status"] in ACTIVE_PARTICIPATION
        else None
    )
    return {
        "eventId": event_id,
        "reason": reason,
        "alternatives": [
            host.event_view(actor, x) for x in similar_events(host, actor, e, broke_at(e, mine))
        ],
    }


def broke_at(e: Entity, mine: Entity | None) -> datetime | None:
    """Когда встреча сорвалась для человека: отказ от нового времени или отмена организатором."""
    if mine is not None and mine.get("leftBecause") == "reschedule" and mine.get("decidedAt"):
        return clock.parse(mine["decidedAt"])
    return clock.parse(e["updatedAt"])


def plan_b_hint(host: ParticipationHost, e: Entity) -> str:
    """Строка в уведомление об отмене: есть ли что предложить взамен."""
    return " В карточке события есть похожие встречи." if similar_events(host, None, e) else ""


def decline_reschedule(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Не смогу в новое время»: запись отменяется без отметки о поздней отмене, человеку — похожие встречи."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    mine = my_participation(host.db, user["id"], event_id)
    if (mine or {}).get("leftBecause") == "reschedule" and mine["status"] == "cancelled":
        return host.event_details(user, event_id)
    if mine is None or mine["status"] not in ACTIVE_PARTICIPATION:
        fail("no_participation", "У вас нет активной записи на это событие")
    joined_at = clock.parse(mine["createdAt"])
    moved = any(
        (changed_at := clock.parse(c["at"])) is not None
        and joined_at is not None
        and changed_at > joined_at
        and any(i["field"] == "startsAt" for i in c["items"])
        for c in e["changes"]
    )
    if not moved:
        fail("bad_state", "Время этой встречи не меняли. Чтобы не идти, отмените запись")

    host.leave(user, event_id, {"reason": "reschedule"})
    mine["leftBecause"] = "reschedule"
    alternatives = similar_events(host, user, e)
    if alternatives:
        titles = ", ".join(f"«{x['title']}»" for x in alternatives)
        host.notify(
            [user["id"]],
            "plan_b",
            "Похожие встречи взамен",
            f"Вместо «{e['title']}» можно пойти: {titles}. Записаться можно в карточке.",
            f"/events/{e['id']}#plan-b",
        )
    host.commit(["events", "participations", "notifications"], [e["id"]])
    return host.event_details(user, event_id)
