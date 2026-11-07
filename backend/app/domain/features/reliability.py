"""С15 «Надёжность организатора».

После встречи подтверждённым участникам приходит вопрос «Встреча состоялась?» (в уведомлениях,
в карточке и в «Моих занятиях»), один ответ на человека. В фактах организатора: «Подтвердили участники:
N из M встреч». Если большинство ответивших сказали «нет», встреча не считается проведённой.
"""

from collections.abc import Callable
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock
from app.domain.errors import fail
from app.domain.features.kit import commit, db, get_event, notify, participation, require_user
from app.domain.features.managers import engagement
from app.domain.features.participation_host import event_end
from app.domain.routing import Route, route
from app.domain.schema import COLLECTIONS
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

# Вопрос приходит уведомлением, если встреча закончилась не раньше, чем столько часов назад.
ASK_WITHIN = timedelta(hours=48)
# Ответить можно в течение двух недель после встречи.
ANSWER_WITHIN = timedelta(days=14)


def _votes_of(event_id: ID) -> list[Entity]:
    return [v for v in db().engagement.held_votes if v["eventId"] == event_id]


def held_verdict(event_id: ID) -> str | None:
    """Итог по встрече: подтвердили, опровергли или пока неясно (нет ответов или поровну)."""
    votes = _votes_of(event_id)
    yes = sum(1 for v in votes if v["answer"] == "yes")
    no = len(votes) - yes
    if no > yes:
        return "disputed"
    if yes > no:
        return "confirmed"
    return None


def with_reliability(facts: Entity, past: list[Entity]) -> Entity:
    """Факты организатора с ответами участников: опровергнутые встречи не считаются проведёнными."""
    confirmed = 0
    disputed = 0
    for e in past:
        verdict = held_verdict(e["id"])
        if verdict == "confirmed":
            confirmed += 1
        if verdict == "disputed":
            disputed += 1
    return {**facts, "held": facts["held"] - disputed, "confirmed": confirmed, "disputed": disputed}


def held_check_of(d: "Domain", actor: Actor, e: Entity) -> Entity | None:
    if actor is None or d.event_state(e) != "past":
        return None
    if (participation(e["id"], actor["id"]) or {}).get("status") != "confirmed":
        return None
    end = event_end(e)
    if end is None:
        return None
    until = end + ANSWER_WITHIN
    vote = next((v for v in _votes_of(e["id"]) if v["userId"] == actor["id"]), None)
    return {
        "canAnswer": vote is None and clock.now() < until,
        "answer": vote["answer"] if vote is not None else None,
        "until": clock.iso(until),
    }


def answer_held(d: "Domain", actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    answer = input_.get("answer")
    if answer not in {"yes", "no"}:
        fail("validation", "Выберите ответ: «Да» или «Нет»")
    if d.event_state(e) != "past":
        fail("bad_state", "Ответить можно после окончания встречи")
    if (participation(e["id"], user["id"]) or {}).get("status") != "confirmed":
        fail("no_participation", "Ответить могут только участники, которые были записаны на встречу")
    check = held_check_of(d, user, e)
    if check is not None and check["answer"]:
        fail("already_decided", "Вы уже ответили на этот вопрос")
    if check is None or not check["canAnswer"]:
        fail("event_past", "Срок ответа прошёл: отвечают в течение двух недель после встречи")
    engagement().held_votes.append(
        {"eventId": e["id"], "userId": user["id"], "answer": answer, "at": clock.iso(clock.now())}
    )
    commit(["events", "organizations", "users"], [e["id"]])
    return held_check_of(d, user, e)


def reliability_tick(d: "Domain") -> None:
    """Проверка по времени: недавно закончившиеся встречи получают вопрос в уведомлениях.

    Каждому участнику — один раз на встречу.
    """
    now = clock.now()
    asked = engagement().held_asked
    changed = False
    confirmed = [p for p in db().participations if p["status"] == "confirmed"]
    event_ids = {p["eventId"] for p in confirmed}
    if not event_ids:
        return
    events = db().records(
        "events", COLLECTIONS["events"].table.c.id.in_(event_ids),
        predicate=lambda e: e["id"] in event_ids,
    )
    by_event: dict[str, list[Entity]] = {}
    for participation_ in confirmed:
        by_event.setdefault(participation_["eventId"], []).append(participation_)
    for e in events:
        if e["status"] != "published":
            continue
        end = event_end(e)
        if end is None or end > now or now - end > ASK_WITHIN:
            continue
        voted = {v["userId"] for v in _votes_of(e["id"])}
        people = [
            p["userId"]
            for p in by_event[e["id"]]
            if p["userId"] not in voted
            and f"{p['userId']}|{e['id']}" not in asked
        ]
        if not people:
            continue
        notify(
            d,
            people,
            "held_question",
            "Встреча состоялась?",
            f"«{e['title']}» закончилась. Ответьте одним нажатием: так другие узнают, что организатору можно доверять.",
            f"/events/{e['id']}#held",
        )
        asked.extend(f"{id_}|{e['id']}" for id_ in people)
        changed = True
    if changed:
        commit(["notifications", "users"])


# ---------- Маршруты ----------


def reliability_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("put", r"^/events/([^/]+)/held$", lambda p, b, _q: answer_held(d, actor(), p[0], b)),
    ]
