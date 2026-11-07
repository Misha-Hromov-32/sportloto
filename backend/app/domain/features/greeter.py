"""С1 «Я впервые — меня встретят» и Н2 «Программа поддержки ветеранов».

Организатор назначает встречающего (себя или участника) и пишет приметы. Новичок отмечает
«Я здесь впервые» и получает памятку; встречающий и организатор видят, кого ждать.
На событии программы встречающий называется наставником, можно прийти с близким человеком.
Статус человека (ветеран или нет) не хранится и не спрашивается: отмечается только событие.
"""

import re
from typing import TYPE_CHECKING, Any, cast

from app.domain import clock
from app.domain.errors import fail
from app.domain.features.kit import (
    commit,
    date_token,
    db,
    first_name,
    get_event,
    notify,
    organizer_ids,
    participation,
    require_user,
)
from app.domain.features.participation_host import input_text
from app.domain.lib.plural import WORDS, count
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

NOTE_MAX = 200
PROGRAM_LABEL: dict[str, str] = {
    "veterans": "Программа поддержки ветеранов",
}

_SPACES = re.compile(r"\s+")


def _lower_first(text: str) -> str:
    return text[0].lower() + text[1:] if text else text


def program_of(event_id: ID) -> Entity | None:
    p = next((x for x in db().event_programs if x["eventId"] == event_id), None)
    return (
        {"kind": p["kind"], "label": PROGRAM_LABEL[p["kind"]], "withCompanion": p["withCompanion"]}
        if p is not None
        else None
    )


def has_greeter(event_id: ID) -> bool:
    return any(g["eventId"] == event_id for g in db().greeters)


def _require_organizer(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    if not d.is_organizer(user, e):
        fail("forbidden", "Это может сделать только организатор события")
    return e


def _require_upcoming(d: "Domain", e: Entity) -> None:
    if d.event_state(e) != "upcoming":
        fail("event_inactive", "Событие уже прошло, отменено или снято")


def _newcomers_of(d: "Domain", e: Entity) -> list[Entity]:
    """Новички с активной записью, первыми — подтверждённые."""
    rows = [(f, participation(e["id"], f["userId"])) for f in db().first_visits if f["eventId"] == e["id"]]
    rows = [(f, p) for f, p in rows if p is not None and p["status"] in ACTIVE_PARTICIPATION]
    rows.sort(key=lambda row: 0 if row[1]["status"] == "confirmed" else 1)
    return [
        {
            **d.person(d.user(f["userId"]), True),
            "status": p["status"],
            "withCompanion": f["withCompanion"],
        }
        for f, p in rows
    ]


def greeter_view(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    e = get_event(event_id)
    is_admin = (actor or {}).get("role") == "admin"
    is_organizer = d.is_organizer(actor, e)
    g = next((x for x in db().greeters if x["eventId"] == e["id"]), None)
    is_greeter = actor is not None and g is not None and g["userId"] == actor["id"]
    mine = participation(e["id"], (actor or {}).get("id"))
    active = mine is not None and mine["status"] in ACTIVE_PARTICIPATION
    confirmed = (mine or {}).get("status") == "confirmed"
    visit = (
        next((f for f in db().first_visits if f["eventId"] == e["id"] and f["userId"] == actor["id"]), None)
        if actor is not None
        else None
    )
    program = next((p for p in db().event_programs if p["eventId"] == e["id"]), None)
    greeter_user = d.user(g["userId"]) if g is not None else None
    greeter_is_organizer = g is not None and g["userId"] in organizer_ids(e)
    insider = is_organizer or is_admin or is_greeter or confirmed
    # Имя участника-встречающего видят только свои: список участников закрыт для посторонних.
    show_name = g is not None and (greeter_is_organizer or insider or active)
    if g is None:
        who = ""
    elif show_name:
        greeter_name = greeter_user["name"] if greeter_user is not None else "Встречающий"
        who = f"{greeter_name}{', организатор' if greeter_is_organizer else ''}"
    else:
        who = "Один из участников"

    memo = None
    if confirmed and visit is not None:
        first_step = e["firstStep"]
        find = ". ".join(
            x for x in [(g or {}).get("note"), e["place"].get("landmark"), first_step.get("howToFind")] if x
        )
        expect = " ".join(
            x
            for x in [
                first_step.get("firstTimeNote"),
                first_step.get("preparation"),
                "Вы придёте с близким человеком, организатор об этом знает."
                if visit["withCompanion"]
                else "",
            ]
            if x
        )
        memo = {
            "find": find or e["place"]["address"],
            "who": (
                f"Вас встретит {f'наставник {who}' if program is not None else who}. Подойдите и скажите, что вы впервые."
                if g is not None
                else "Организатор знает, что вы придёте впервые. Подойдите к нему и скажите об этом."
            ),
            "expect": expect or "Вам покажут, что делать, и поставят в пару с тем, кто уже занимается.",
        }

    greeter: Entity | None = None
    if g is not None:
        greeter = (
            {**d.person(greeter_user, True), "isOrganizer": greeter_is_organizer}
            if show_name
            else {"id": "", "name": who, "avatarUrl": None, "initials": "?", "isOrganizer": False}
        )
    my: Entity | None = None
    if active and visit is not None:
        my = {"firstVisit": True, "withCompanion": visit["withCompanion"]}
    elif active:
        my = {"firstVisit": False, "withCompanion": False}
    candidates: list[Entity] | None = None
    if is_organizer:
        people = [
            *(d.person(d.user(id_), True) for id_ in organizer_ids(e)),
            *(
                d.person(d.user(p["userId"]), True)
                for p in db().participations
                if p["eventId"] == e["id"] and p["status"] == "confirmed"
            ),
        ]
        # Каждый человек один раз; удалённые (без id) не предлагаются
        candidates = []
        seen: set[ID] = set()
        for p in people:
            if p["id"] and p["id"] not in seen:
                seen.add(p["id"])
                candidates.append(p)

    return {
        "eventId": e["id"],
        "greeter": greeter,
        "note": g["note"] if g is not None and insider else "",
        "mentor": program is not None,
        "withCompanionAllowed": bool((program or {}).get("withCompanion")),
        "my": my,
        "canMark": active and not is_organizer and d.event_state(e) == "upcoming",
        "memo": memo,
        "newcomers": _newcomers_of(d, e) if is_organizer or is_admin or is_greeter else None,
        "isGreeter": is_greeter,
        "canManage": is_organizer and d.event_state(e) == "upcoming",
        "candidates": candidates,
    }


def set_greeter(d: "Domain", actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    e = _require_organizer(d, actor, event_id)
    _require_upcoming(d, e)
    user = cast("Entity", actor)
    raw_id = input_.get("userId")
    user_id = user["id"] if raw_id is None else raw_id
    note = _SPACES.sub(" ", input_text(input_.get("note"))).strip()[:NOTE_MAX]
    allowed = isinstance(user_id, str) and (
        user_id in organizer_ids(e)
        or any(
            p["eventId"] == e["id"] and p["userId"] == user_id and p["status"] == "confirmed"
            for p in db().participations
        )
    )
    if not allowed:
        fail("bad_request", "Встречать может организатор или подтверждённый участник события")
    if len(note) < 5:
        fail(
            "validation",
            "Напишите, где вы будете ждать и как вас узнать",
            {"note": "Например: у входа в зал, в красной куртке"},
        )

    list_ = db().greeters
    prev = next((g for g in list_ if g["eventId"] == e["id"]), None)
    changed_person = (prev or {}).get("userId") != user_id
    at = clock.iso(clock.now())
    if prev is not None:
        prev.update({"userId": user_id, "note": note, "updatedAt": at})
    else:
        list_.append({"eventId": e["id"], "userId": user_id, "note": note, "updatedAt": at})

    program = any(p["eventId"] == e["id"] for p in db().event_programs)
    role = "наставником" if program else "встречающим"
    newcomers = _newcomers_of(d, e)
    if changed_person and user_id != user["id"]:
        coming = (
            f"Придут впервые: {count(len(newcomers), WORDS['person'])}."
            if newcomers
            else "Новичков пока нет."
        )
        notify(
            d,
            [user_id],
            "greeter",
            "Вас попросили быть наставником" if program else "Вас попросили встретить новичков",
            f"«{e['title']}», {date_token(e['startsAt'])}. {coming} Кого ждать и где — в карточке события.",
            f"/events/{e['id']}",
        )
    greeter_name = (d.user(user_id) or {}).get("name") or ""
    notify(
        d,
        [n["id"] for n in newcomers if n["status"] == "confirmed" and n["id"] != user_id],
        "first_visit",
        "Вас встретят",
        f"«{e['title']}», {date_token(e['startsAt'])}. {first_name(greeter_name)} будет {role}: {_lower_first(note)}.",
        f"/events/{e['id']}",
    )
    commit(["events", "notifications"], [e["id"]])
    return greeter_view(d, user, e["id"])


def clear_greeter(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    e = _require_organizer(d, actor, event_id)
    db().greeters = [g for g in db().greeters if g["eventId"] != e["id"]]
    commit(["events"], [e["id"]])
    return greeter_view(d, actor, e["id"])


def set_first_visit(d: "Domain", actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    """«Я здесь впервые»: только у активной записи на предстоящее событие. Повтор ничего не меняет."""
    user = require_user(actor)
    e = get_event(event_id)
    if d.is_organizer(user, e):
        fail("own_event", "Это ваше событие")
    mine = participation(e["id"], user["id"])
    if mine is None or mine["status"] not in ACTIVE_PARTICIPATION:
        fail("no_participation", "Сначала запишитесь на событие")
    _require_upcoming(d, e)

    list_ = db().first_visits
    existing = next((f for f in list_ if f["eventId"] == e["id"] and f["userId"] == user["id"]), None)
    program = next((p for p in db().event_programs if p["eventId"] == e["id"]), None)
    with_companion = bool(
        input_.get("on") and input_.get("withCompanion") and (program or {}).get("withCompanion")
    )
    if not input_.get("on"):
        if existing is not None:
            db().first_visits = [f for f in list_ if f is not existing]
            commit(["events"], [e["id"]])
        return greeter_view(d, user, e["id"])
    if existing is not None and existing["withCompanion"] == with_companion:
        return greeter_view(d, user, e["id"])
    if existing is not None:
        existing["withCompanion"] = with_companion
    else:
        list_.append(
            {
                "eventId": e["id"],
                "userId": user["id"],
                "withCompanion": with_companion,
                "at": clock.iso(clock.now()),
            }
        )

    if existing is None:
        g = next((x for x in db().greeters if x["eventId"] == e["id"]), None)
        role = "наставник" if program is not None else "встречающий"
        assigned = (
            "Встречающий уже назначен." if g is not None else "Назначьте встречающего в управлении событием."
        )
        notify(
            d,
            [
                id_
                for id_ in [*organizer_ids(e), *([g["userId"]] if g is not None else [])]
                if id_ != user["id"]
            ],
            "first_visit",
            "Придёт новичок",
            f"{user['name']} впервые на «{e['title']}»{' и придёт с близким человеком' if with_companion else ''}. {assigned}",
            f"/events/{e['id']}/manage",
        )
        greeter_name = ((d.user(g["userId"]) or {}).get("name") or "") if g is not None else ""
        notify(
            d,
            [user["id"]],
            "first_visit",
            "Памятка для первого раза",
            (
                f"«{e['title']}», {date_token(e['startsAt'])}. Вас встретит {role} {first_name(greeter_name)}: {_lower_first(g['note'])}. Остальное есть в карточке, в блоке «Что дальше»."
                if g is not None
                else f"«{e['title']}», {date_token(e['startsAt'])}. Организатор знает, что вы впервые. Как найти группу и что взять, написано в карточке, в блоке «Что дальше»."
            ),
            f"/events/{e['id']}",
        )
    commit(["events", "notifications"], [e["id"]])
    return greeter_view(d, user, e["id"])


def set_program(d: "Domain", actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    """Н2: отметить событие допущенной организации как событие программы."""
    e = _require_organizer(d, actor, event_id)
    _require_upcoming(d, e)
    if e["organizer"]["kind"] != "org":
        fail("forbidden", "Отметить событие программы может организация")
    org = next((o for o in db().organizations if o["id"] == e["organizer"]["id"]), None)
    if (org or {}).get("status") != "approved":
        fail("org_not_approved", "Организация ещё не допущена администратором")
    if input_.get("kind") is not None and input_["kind"] != "veterans":
        fail("bad_request", "Такой программы нет")
    list_ = db().event_programs
    prev = next((p for p in list_ if p["eventId"] == e["id"]), None)
    at = clock.iso(clock.now())
    if prev is not None:
        prev.update({"withCompanion": bool(input_.get("withCompanion")), "at": at})
    else:
        list_.append(
            {
                "eventId": e["id"],
                "kind": "veterans",
                "withCompanion": bool(input_.get("withCompanion")),
                "by": cast("Entity", actor)["id"],
                "at": at,
            }
        )
    commit(["events"], [e["id"]])
    return {"program": program_of(e["id"])}


def clear_program(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    e = _require_organizer(d, actor, event_id)
    db().event_programs = [p for p in db().event_programs if p["eventId"] != e["id"]]
    commit(["events"], [e["id"]])
    return {"program": None}


def greeter_reason(event_id: ID) -> str | None:
    """Подпись для подбора и ленты: «Новичков встречают»."""
    if not has_greeter(event_id):
        return None
    return (
        "Новичков встречает наставник"
        if any(p["eventId"] == event_id for p in db().event_programs)
        else "Новичков встречают"
    )
