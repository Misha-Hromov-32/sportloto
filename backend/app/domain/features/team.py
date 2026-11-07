"""Н3. Запись всей командой, облегчённо.

«Записать нас»: человек записывается сам и указывает до пяти друзей с платформы. Места держатся
за ними сутки (на /demo — 2 минуты), каждый подтверждает своё место или отказывается; кто не ответил
вовремя, тот место освобождает. На встречу по заявке уходит одна заявка: организатор принимает
или отклоняет команду целиком, а места держатся только после того, как он её принял.
Срок проверяется фоновой проверкой по времени и перед каждым изменением данных.
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, NoReturn

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.composition import composition_block
from app.domain.features.invite_only import is_invite_only, person_short
from app.domain.features.participation_host import (
    ParticipationHost,
    date_token,
    input_text,
    my_participation,
)
from app.domain.features.stop_list import is_stop_listed
from app.domain.features.waitlist_offer import deadline_text
from app.domain.lib.plural import count
from app.domain.routing import Route, route
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

HOLD_HOURS = 24
SHORT_HOLD_MINUTES = 2
MAX_FRIENDS = 5
WAITING = ["invited", "agreed"]
PLACES = ("место", "места", "мест")


def hold_period(db: store.Database) -> timedelta:
    if db.settings.get("shortReserve"):
        return timedelta(minutes=SHORT_HOLD_MINUTES)
    return timedelta(hours=HOLD_HOURS)


def teams(db: store.Database) -> list[Entity]:
    return db.event_teams


def holds_count(t: Entity) -> bool:
    return t["status"] == "active" and (not t["needsApproval"] or bool(t["accepted"]))


def team_held_seats(db: store.Database, event_id: ID, now: datetime) -> int:
    """Места, которые держатся за друзьями, ещё не ответившими. Их нельзя занять обычной записью."""
    n = 0
    for t in db.event_teams:
        if t["eventId"] != event_id or not holds_count(t):
            continue
        until = clock.parse(t["until"])
        if until is None or until <= now:
            continue
        n += sum(1 for m in t["members"] if m["status"] == "invited")
    return n


def team_seats_needed(db: store.Database, p: Entity) -> int:
    """Сколько ещё мест нужно команде сверх места того, кто записывал: для решения по заявке."""
    if not p.get("teamId"):
        return 0
    t = next((x for x in teams(db) if x["id"] == p["teamId"]), None)
    return (
        sum(1 for m in t["members"] if m["status"] in WAITING)
        if t is not None and t["status"] == "active"
        else 0
    )


def first_name(u: Entity | None) -> str:
    return u["name"].split(" ")[0] if u is not None else "Участник"


def view(host: ParticipationHost, t: Entity) -> Entity:
    captain = host.user(t["captainId"])

    def member(m: Entity) -> Entity:
        u = host.user(m["userId"])
        return {
            "user": person_short(u)
            if u is not None
            else {"id": m["userId"], "name": "Удалённый пользователь", "avatarUrl": None, "initials": "?"},
            "status": m["status"],
        }

    return {
        "id": t["id"],
        "eventId": t["eventId"],
        "captain": person_short(captain)
        if captain is not None
        else {"id": "", "name": "Удалённый пользователь", "avatarUrl": None, "initials": "?"},
        "members": [member(m) for m in t["members"]],
        "until": t["until"],
        "needsApproval": t["needsApproval"],
        "accepted": t["accepted"],
        "status": t["status"],
        "seats": 1 + sum(1 for m in t["members"] if m["status"] not in ("declined", "expired")),
    }


def require_event(host: ParticipationHost, event_id: ID) -> Entity:
    e = host.event(event_id)
    return e if e is not None else fail("not_found", "Событие не найдено. Возможно, ссылка устарела")


def spots_left(host: ParticipationHost, e: Entity) -> int | None:
    return host.event_view(None, e)["counts"]["spotsLeft"]


def team_state(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    e = require_event(host, event_id)
    empty: Entity = {"mine": None, "invitation": None, "maxFriends": 0, "reason": ""}
    if actor is None:
        return {**empty, "reason": "Войдите, чтобы записать друзей"}
    list_ = [t for t in teams(host.db) if t["eventId"] == e["id"]]
    own = [t for t in list_ if t["captainId"] == actor["id"] and t["status"] == "active"]
    mine = own[-1] if own else None
    invited = next(
        (
            t
            for t in list_
            if t["status"] == "active"
            and any(m["userId"] == actor["id"] and m["status"] in WAITING for m in t["members"])
        ),
        None,
    )
    state: Entity = {
        **empty,
        "mine": view(host, mine) if mine is not None else None,
        "invitation": {
            **view(host, invited),
            "myStatus": next(m for m in invited["members"] if m["userId"] == actor["id"])["status"],
        }
        if invited is not None
        else None,
    }
    if (e.get("family") or {}).get("kind") == "kids":
        return {**state, "reason": "На детское занятие записывают детей"}
    check = host.can_join(actor, e)
    if not check["ok"]:
        return {**state, "reason": check["reason"]}
    spots = spots_left(host, e)
    max_ = MAX_FRIENDS if spots is None else min(MAX_FRIENDS, spots - 1)
    if max_ < 1:
        return {**state, "reason": "Свободных мест меньше двух"}
    return {**state, "maxFriends": max_}


def event_teams(host: ParticipationHost, actor: Actor, event_id: ID) -> list[Entity]:
    """Все команды события — для организатора."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    e = require_event(host, event_id)
    if not host.is_organizer(user, e) and user["role"] != "admin":
        fail("forbidden", "Команды видит организатор события")
    return [view(host, t) for t in teams(host.db) if t["eventId"] == e["id"]]


def create_team(host: ParticipationHost, actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    """«Записать нас»: запись себя и придержанные места для друзей."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы записать друзей")
    e = require_event(host, event_id)
    expire_teams(host)
    if (e.get("family") or {}).get("kind") == "kids":
        fail("bad_state", "На детское занятие записывают детей, а не команду")
    check = host.can_join(user, e)
    if not check["ok"]:
        fail(check.get("code") or "bad_state", check["reason"])
    raw = input_.get("userIds")
    items = raw if isinstance(raw, list) else []
    if not all(isinstance(x, str) for x in items):
        fail("validation", "Такого человека нет на платформе", {"people": "Выберите людей из подсказок"})
    ids = [id_ for id_ in dict.fromkeys(items) if id_ != user["id"]]
    if len(ids) < 1 or len(ids) > MAX_FRIENDS:
        fail(
            "validation", f"Добавьте от 1 до {MAX_FRIENDS} человек", {"people": "Выберите людей из подсказок"}
        )
    # Имя того, кого организатор не пускает, капитану не раскрываем.
    now = clock.now()
    if any(is_stop_listed(host.db, id_, e, now) for id_ in ids):
        fail("organizer_blocked", "Кто-то из команды не может записаться на встречи этого организатора")
    busy = {
        m["userId"]
        for t in teams(host.db)
        if t["eventId"] == e["id"] and t["status"] == "active"
        for m in t["members"]
        if m["status"] in WAITING
    }

    def person(id_: ID) -> Entity:
        u = host.user(id_)
        if u is None or u["role"] != "user":
            return fail("validation", "Такого человека нет на платформе", {"people": id_})

        def why(text: str) -> NoReturn:
            fail("validation", f"{u['name']}: {text}", {"people": text})

        if host.is_organizer(u, e):
            why("это организатор встречи")
        p = my_participation(host.db, u["id"], e["id"])
        if p is not None and p["status"] in ACTIVE_PARTICIPATION:
            why("уже записан")
        if (p or {}).get("status") == "rejected":
            why("организатор уже отклонял заявку")
        if u["id"] in busy:
            why("его уже записали в другую команду")
        composition = composition_block(u, e)
        if composition is not None:
            why(
                "не указал пол, а встреча с ограничением по составу"
                if composition["code"] == "gender_required"
                else composition["reason"].lower()
            )
        return u

    people = [person(id_) for id_ in ids]
    seats = 1 + len(people)
    spots = spots_left(host, e)
    if spots is not None and spots < seats:
        fail(
            "full",
            "Мест не осталось"
            if spots <= 0
            else f"Свободно {count(spots, PLACES)}, а нужно {seats}. Уберите кого-нибудь из списка",
        )

    note = input_text(input_.get("note")).strip()[:300]
    host.join(user, e["id"], {"note": note} if note else {})
    mine = my_participation(host.db, user["id"], e["id"])
    if mine["status"] not in ("confirmed", "pending"):
        fail("full", "Мест на всю команду уже нет")
    now = clock.now()
    team: Entity = {
        "id": host.next_id("team"),
        "eventId": e["id"],
        "captainId": user["id"],
        "members": [{"userId": u["id"], "status": "invited", "decidedAt": None} for u in people],
        "until": clock.iso(now + hold_period(host.db)),
        "needsApproval": mine["status"] == "pending",
        "accepted": False,
        "status": "active",
        "createdAt": clock.iso(now),
    }
    mine["teamId"] = team["id"]
    teams(host.db).append(team)
    if is_invite_only(e) and e.get("inviteCode"):
        grants = host.db.invite_grants
        for u in people:
            grants.append(
                {"eventId": e["id"], "userId": u["id"], "code": e["inviteCode"], "at": clock.iso(now)}
            )
    deadline = deadline_text(team["until"], now)
    host.notify(
        [u["id"] for u in people],
        "invite",
        f"{user['name']} записывает вас на «{e['title']}»",
        f"{date_token(e['startsAt'])}. Встреча по заявке: организатор рассмотрит всю команду сразу. Ответьте {deadline}, пойдёте ли вы."
        if team["needsApproval"]
        else f"{date_token(e['startsAt'])}. Место держим за вами {deadline}. Подтвердите его в карточке или откажитесь.",
        f"/events/{e['id']}#team",
    )
    host.commit(["events", "participations", "notifications", "messages"], [e["id"]])
    return team_state(host, user, e["id"])


def find_invitation(
    host: ParticipationHost, user: Entity, e: Entity
) -> tuple[Entity | None, Entity | None, list[Entity]]:
    list_ = [t for t in teams(host.db) if t["eventId"] == e["id"]]
    team = next(
        (
            t
            for t in list_
            if t["status"] == "active"
            and any(m["userId"] == user["id"] and m["status"] in WAITING for m in t["members"])
        ),
        None,
    )
    member = (
        next((m for m in team["members"] if m["userId"] == user["id"]), None) if team is not None else None
    )
    return team, member, list_


def seat(
    host: ParticipationHost,
    e: Entity,
    user: Entity,
    team: Entity,
    member: Entity,
    recount: bool = True,
) -> None:
    """Место за участником команды: обычная запись в составе, без очереди и рассмотрения.

    `recount=False` — порог сбора пересчитает тот, кто вызывал (решение по заявке).
    """
    at = clock.iso(clock.now())
    before = host.confirmed_count(e)
    member["status"] = "joined"
    member["decidedAt"] = at
    fields = {
        "status": "confirmed",
        "prevStatus": None,
        "note": "",
        "rejectReason": "",
        "createdAt": at,
        "decidedAt": at,
        "offer": None,
        "leftBecause": None,
        "teamId": team["id"],
    }
    p = my_participation(host.db, user["id"], e["id"])
    if p is not None:
        p.update(fields)
        p.pop("children", None)
        p.pop("adultSeat", None)
    else:
        host.db.participations.append(
            {
                "id": host.next_id("p"),
                "eventId": e["id"],
                "userId": user["id"],
                "source": "self",
                **fields,
            }
        )
    if recount:
        host.after_count_change(e, before)


def confirm_team_place(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Подтверждаю место» — участник команды."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы подтвердить место")
    e = require_event(host, event_id)
    expire_teams(host)
    team, member, all_ = find_invitation(host, user, e)
    if team is None or member is None:
        mine = [m for t in all_ for m in t["members"] if m["userId"] == user["id"]]
        last = mine[-1] if mine else None
        status = (last or {}).get("status")
        if status == "joined":
            return team_state(host, user, e["id"])
        fail(
            "no_offer",
            "Время подтверждения вышло, и место освободилось. Если ещё хотите пойти, запишитесь сами"
            if status == "expired"
            else "Вы уже отказались от этого места"
            if status == "declined"
            else "Для вас нет придержанного места в команде",
        )
    if host.event_state(e) != "upcoming":
        fail("event_inactive", "Событие больше не принимает записи")
    check = host.can_join(user, e)
    if not check["ok"]:
        fail(check.get("code") or "bad_state", check["reason"])
    captain = host.user(team["captainId"])
    if team["needsApproval"] and not team["accepted"]:
        member["status"] = "agreed"
        member["decidedAt"] = clock.iso(clock.now())
        host.notify(
            [team["captainId"]],
            "team",
            f"{first_name(user)} пойдёт с вами",
            f"{user['name']} подтвердил, что пойдёт на «{e['title']}». Ждём решения организатора по заявке команды.",
            f"/events/{e['id']}#team",
        )
    else:
        seat(host, e, user, team, member)
        captain_name = captain["name"] if captain is not None else ""
        host.notify(
            host.organizer_user_ids(e),
            "joined",
            "Участник команды подтвердил место",
            f"{user['name']} идёт на «{e['title']}» в команде {captain_name}.".replace(" .", ".", 1),
            f"/events/{e['id']}/manage?tab=participants",
        )
        host.notify(
            [team["captainId"]],
            "team",
            f"{first_name(user)} подтвердил место",
            f"{user['name']} идёт с вами на «{e['title']}», {date_token(e['startsAt'])}.",
            f"/events/{e['id']}#team",
        )
    host.commit(["events", "participations", "notifications", "messages"], [e["id"]])
    return team_state(host, user, e["id"])


def decline_team_place(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Не смогу»: место освобождается, при очереди уходит следующему."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы ответить")
    e = require_event(host, event_id)
    expire_teams(host)
    team, member, _ = find_invitation(host, user, e)
    if team is None or member is None:
        fail("no_offer", "Для вас нет придержанного места в команде")
    held = holds_count(team) and member["status"] == "invited"
    member["status"] = "declined"
    member["decidedAt"] = clock.iso(clock.now())
    host.notify(
        [team["captainId"]],
        "team",
        f"{first_name(user)} не сможет",
        f"{user['name']} отказался от места на «{e['title']}». Место освободилось.",
        f"/events/{e['id']}#team",
    )
    if held:
        host.promote_waitlist(e)
    host.commit(["events", "participations", "notifications"], [e["id"]])
    return team_state(host, user, e["id"])


def on_team_decided(host: ParticipationHost, p: Entity, decision: str) -> None:
    """Организатор решил по заявке команды: принял — места держатся, отклонил — команда распадается."""
    if not p.get("teamId"):
        return
    team = next((t for t in teams(host.db) if t["id"] == p["teamId"]), None)
    e = host.event(p["eventId"])
    if (
        team is None
        or e is None
        or team["status"] != "active"
        or not team["needsApproval"]
        or team["accepted"]
    ):
        return
    waiting = [m for m in team["members"] if m["status"] in WAITING]
    if decision == "reject":
        team["status"] = "closed"
        host.notify(
            [m["userId"] for m in waiting],
            "rejected",
            "Заявку команды не приняли",
            f"Организатор «{e['title']}» не принял заявку команды. Место за вами больше не держим.",
            f"/events/{e['id']}",
        )
        return
    team["accepted"] = True
    now = clock.now()
    # После решения организатора у друзей остаётся хотя бы половина срока
    half = hold_period(host.db) / 2
    until = clock.parse(team["until"])
    if until is None or until - now < half:
        team["until"] = clock.iso(now + half)
    for m in waiting:
        u = host.user(m["userId"])
        if u is None:
            continue
        if m["status"] == "agreed":
            seat(host, e, u, team, m, False)
            host.notify(
                [u["id"]],
                "accepted",
                "Команду приняли",
                f"Вас ждут на «{e['title']}», {date_token(e['startsAt'])}. Адрес и контакты открыты в карточке.",
                f"/events/{e['id']}",
            )
        else:
            host.notify(
                [u["id"]],
                "invite",
                "Команду приняли: подтвердите место",
                f"Организатор «{e['title']}» принял команду. Место держим за вами {deadline_text(team['until'], now)}.",
                f"/events/{e['id']}#team",
            )


def expire_teams(host: ParticipationHost) -> list[ID]:
    """Истёкшие места: кто не ответил вовремя, место освобождает, при очереди оно уходит дальше.

    Команда отозванной или отклонённой заявки, прошедшей или отменённой встречи закрывается.
    """
    now = clock.now()
    touched: dict[ID, None] = {}
    for t in host.db.event_teams:
        if t["status"] != "active":
            continue
        e = host.event(t["eventId"])
        if e is None:
            t["status"] = "closed"
            touched[t["eventId"]] = None
            continue
        waiting = [m for m in t["members"] if m["status"] in WAITING]
        if t["needsApproval"] and not t["accepted"]:
            captain = my_participation(host.db, t["captainId"], e["id"])
            if captain is None or captain["status"] not in ("pending", "confirmed"):
                t["status"] = "closed"
                if waiting:
                    host.notify(
                        [m["userId"] for m in waiting],
                        "team",
                        "Заявку команды отозвали",
                        f"Заявка команды на «{e['title']}» больше не действует. Если хотите пойти, запишитесь сами.",
                        f"/events/{e['id']}",
                    )
                touched[e["id"]] = None
                continue
        upcoming = host.event_state(e) == "upcoming"
        until = clock.parse(t["until"])
        if not waiting or (until is not None and until > now):
            if not upcoming:
                t["status"] = "closed"
                touched[e["id"]] = None
            continue
        at = clock.iso(now)
        for m in waiting:
            m["status"] = "expired"
            m["decidedAt"] = at
        host.notify(
            [m["userId"] for m in waiting],
            "offer_expired",
            "Место в команде освободилось",
            f"Вы не подтвердили место на «{e['title']}» вовремя. Если ещё хотите пойти, запишитесь сами.",
            f"/events/{e['id']}",
        )
        names = ", ".join(first_name(host.user(m["userId"])) for m in waiting)
        many = len(waiting) > 1
        host.notify(
            [t["captainId"]],
            "team",
            "Не все подтвердили места",
            f"{names}: {'не ответили' if many else 'не ответил'} вовремя, "
            f"{'места освободились' if many else 'место освободилось'} («{e['title']}»).",
            f"/events/{e['id']}#team",
        )
        if holds_count(t) and upcoming:
            host.promote_waitlist(e)
        if not upcoming:
            t["status"] = "closed"
        touched[e["id"]] = None
    return list(touched)


def team_tick(host: ParticipationHost) -> bool:
    """Проверка сроков по времени."""
    ids = expire_teams(host)
    if not ids:
        return False
    host.commit(["events", "participations", "notifications"], ids)
    return True


def team_routes(host: Callable[[], ParticipationHost], actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/events/([^/]+)/team$", lambda p, _b, _q: team_state(host(), actor(), p[0])),
        route("post", r"^/events/([^/]+)/team$", lambda p, b, _q: create_team(host(), actor(), p[0], b)),
        route(
            "post",
            r"^/events/([^/]+)/team/confirm$",
            lambda p, _b, _q: confirm_team_place(host(), actor(), p[0]),
        ),
        route(
            "post",
            r"^/events/([^/]+)/team/decline$",
            lambda p, _b, _q: decline_team_place(host(), actor(), p[0]),
        ),
        route("get", r"^/events/([^/]+)/teams$", lambda p, _b, _q: event_teams(host(), actor(), p[0])),
    ]
