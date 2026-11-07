"""С10. Регулярные занятия, облегчённо.

Серия «каждую неделю» — это отдельные события с общим `series.id`. Можно записаться на все
предстоящие встречи сразу (каждая проходит обычные правила записи: места, режим, состав)
и отменить одну встречу, не выходя из серии.
"""

from app.core.errors import AppError
from app.domain.errors import fail
from app.domain.features.participation_host import ParticipationHost, my_participation
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.schema import COLLECTIONS
from app.domain.types import ID, Actor, Entity


def series_events(host: ParticipationHost, e: Entity) -> list[Entity]:
    if e.get("series") is None:
        return []
    id_ = e["series"]["id"]
    return sorted(
        (
            x
            for x in host.db.records("events", COLLECTIONS["events"].table.c.series["id"].astext == id_,
                                    predicate=lambda x: (x.get("series") or {}).get("id") == id_)
            if (x.get("series") or {}).get("id") == id_ and host.event_state(x) == "upcoming"
        ),
        key=lambda x: x["startsAt"],
    )


def require_series(host: ParticipationHost, event_id: ID) -> Entity:
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    if e.get("series") is None:
        fail("bad_state", "Это занятие не повторяется")
    if e["status"] == "deleted":
        fail("event_deleted", "Событие удалено")
    return e


def series_view(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    e = require_series(host, event_id)
    return {
        "seriesId": e["series"]["id"],
        "until": e["series"]["until"],
        "events": [host.event_view(actor, x) for x in series_events(host, e)],
    }


def join_series(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы записаться")
    e = require_series(host, event_id)
    results: list[Entity] = []
    for x in series_events(host, e):
        mine = my_participation(host.db, user["id"], x["id"])
        if mine is not None and mine["status"] in ACTIVE_PARTICIPATION:
            results.append(
                {"eventId": x["id"], "startsAt": x["startsAt"], "outcome": "already", "reason": ""}
            )
            continue
        check = host.can_join(user, x)
        if not check["ok"]:
            results.append(
                {
                    "eventId": x["id"],
                    "startsAt": x["startsAt"],
                    "outcome": "skipped",
                    "reason": check["reason"],
                }
            )
            continue
        try:
            status = (host.join(user, x["id"]).get("my") or {}).get("status")
            outcome = status if status in ACTIVE_PARTICIPATION else "skipped"
            results.append({"eventId": x["id"], "startsAt": x["startsAt"], "outcome": outcome, "reason": ""})
        except AppError as error:
            results.append(
                {"eventId": x["id"], "startsAt": x["startsAt"], "outcome": "skipped", "reason": error.message}
            )
    if not results:
        fail("event_inactive", "У этой серии больше нет предстоящих встреч")
    return {
        "results": results,
        "joined": sum(1 for r in results if r["outcome"] not in ("skipped", "already")),
        "skipped": sum(1 for r in results if r["outcome"] == "skipped"),
    }
