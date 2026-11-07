"""С4. Лист ожидания с предложением места.

Освободилось место — первый в очереди не попадает в состав молча, а получает резерв: место держится
за ним до срока, он отвечает «Иду» или «Отказаться». Отказ, выход из очереди или истёкший срок
передают место следующему. Срок проверяется фоновой проверкой по времени и перед каждым
изменением данных.
"""

from datetime import datetime, timedelta

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features import stop_list
from app.domain.features.participation_host import (
    ParticipationHost,
    date_token,
    my_participation,
)
from app.domain.lib.dates import day_month, format_time, moment
from app.domain.types import ID, Actor, Entity

RESERVE_HOURS = 3
SHORT_RESERVE_MINUTES = 2


def reserve_period(db: store.Database) -> timedelta:
    if db.settings.get("shortReserve"):
        return timedelta(minutes=SHORT_RESERVE_MINUTES)
    return timedelta(hours=RESERVE_HOURS)


def has_active_offer(p: Entity, now: datetime) -> bool:
    offer = p.get("offer")
    if p["status"] != "waitlist" or offer is None:
        return False
    until = clock.parse(offer["until"])
    return until is not None and until > now


def held_seats(db: store.Database, event_id: ID, now: datetime) -> int:
    """Сколько мест придержано за людьми из листа ожидания. Эти места нельзя занять записью."""
    return sum(1 for p in db.participations if p["eventId"] == event_id and has_active_offer(p, now))


def offer_until_of(p: Entity | None, now: datetime) -> str | None:
    return p["offer"]["until"] if p is not None and has_active_offer(p, now) else None


def deadline_text(until_iso: str, now: datetime) -> str:
    """«до 18:40» или «до завтра, 09:10» — в часовом поясе того, кто читает."""
    until = moment(until_iso)
    today = moment(now).date()
    if until.date() == today:
        return f"до {format_time(until)}"
    if until.date() == today + timedelta(days=1):
        return f"до завтра, {format_time(until)}"
    return f"до {day_month(until)}, {format_time(until)}"


def give_offer(host: ParticipationHost, e: Entity, p: Entity) -> None:
    """Придержать место за человеком из очереди и сообщить ему."""
    now = clock.now()
    until = clock.iso(now + reserve_period(host.db))
    p["offer"] = {"until": until, "at": clock.iso(now)}
    deadline = deadline_text(until, now)
    host.notify(
        [p["userId"]],
        "waitlist_offer",
        f"Освободилось место: подтвердите {deadline}",
        f"«{e['title']}», {date_token(e['startsAt'])}. Место держим за вами {deadline}. "
        "Ответьте в карточке: «Иду» или «Отказаться».",
        f"/events/{e['id']}#join",
    )


def require_offer(host: ParticipationHost, actor: Actor, event_id: ID) -> tuple[Entity, Entity, Entity, bool]:
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    expire_offers(host)
    mine = my_participation(host.db, user["id"], event_id)
    if mine is None or mine["status"] != "waitlist" or mine.get("offer") is None:
        if (mine or {}).get("status") == "confirmed":
            return user, e, mine, True
        fail(
            "no_offer",
            "Время подтверждения вышло, и место перешло следующему в очереди"
            if (mine or {}).get("status") == "cancelled"
            else "Для вас сейчас нет придержанного места",
        )
    if host.event_state(e) != "upcoming":
        fail("event_inactive", "Событие больше не принимает записи")
    return user, e, mine, False


def accept_offer(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Иду»: человек занимает придержанное место."""
    user, e, mine, done = require_offer(host, actor, event_id)
    if done:
        return host.event_details(user, event_id)
    # Место придержали до того, как организатор добавил человека в стоп-лист.
    stop = stop_list.stop_block(host.db, user, e, None, clock.now())
    if stop is not None:
        fail(stop["code"], stop["reason"])  # type: ignore[arg-type]
    before = host.confirmed_count(e)
    mine["status"] = "confirmed"
    mine["offer"] = None
    mine["decidedAt"] = clock.iso(clock.now())
    host.notify(
        host.organizer_user_ids(e),
        "joined",
        "Место из листа ожидания занято",
        f"{user['name']} подтвердил место на «{e['title']}».",
        f"/events/{e['id']}/manage",
    )
    host.after_count_change(e, before)
    host.commit(["events", "participations", "notifications", "messages"], [e["id"]])
    return host.event_details(user, event_id)


def decline_offer(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Отказаться»: человек уходит из очереди, место предлагается следующему."""
    user, e, mine, done = require_offer(host, actor, event_id)
    if done:
        fail("bad_state", "Вы уже подтвердили место. Чтобы не идти, отмените запись")
    mine["status"] = "cancelled"
    mine["offer"] = None
    mine["decidedAt"] = clock.iso(clock.now())
    host.promote_waitlist(e)
    host.commit(["events", "participations", "notifications"], [e["id"]])
    return host.event_details(user, event_id)


def expire_offers(host: ParticipationHost) -> list[ID]:
    """Истёкшие резервы: человек выбывает из очереди (записаться снова можно), место уходит дальше.

    Резервы на отменённых, снятых и начавшихся встречах просто гаснут.
    """
    now = clock.now()
    touched: dict[ID, None] = {}
    for p in host.db.participations:
        if p.get("offer") is None:
            continue
        e = host.event(p["eventId"])
        if e is None or p["status"] != "waitlist" or host.event_state(e) != "upcoming":
            p["offer"] = None
            touched[p["eventId"]] = None
            continue
        until = clock.parse(p["offer"]["until"])
        if until is not None and until > now:
            continue
        p["offer"] = None
        p["status"] = "cancelled"
        p["decidedAt"] = clock.iso(now)
        host.notify(
            [p["userId"]],
            "offer_expired",
            "Место перешло следующему",
            f"Вы не подтвердили место на «{e['title']}» вовремя. "
            "Если ещё хотите пойти, запишитесь снова в карточке.",
            f"/events/{e['id']}",
        )
        touched[e["id"]] = None
        host.promote_waitlist(e)
    return list(touched)


def participation_demo_state(db: store.Database) -> Entity:
    short = bool(db.settings.get("shortReserve"))
    return {"shortReserve": short, "reserveMinutes": SHORT_RESERVE_MINUTES if short else RESERVE_HOURS * 60}


def set_short_reserve(host: ParticipationHost, on: bool) -> Entity:
    host.db.settings["shortReserve"] = on
    host.commit(["demo"], [])
    return participation_demo_state(host.db)


def seed_offer(participations: list[Entity], now: datetime) -> None:
    """Демо: у Анны уже есть придержанное место на бадминтоне — Артём отказался от участия."""
    artem = next(
        (p for p in participations if p["eventId"] == "e-badminton" and p["userId"] == "u-artem"), None
    )
    anna = next(
        (p for p in participations if p["eventId"] == "e-badminton" and p["userId"] == "u-anna"), None
    )
    if artem is None or anna is None:
        return
    declined_at = now - timedelta(minutes=20)
    artem["status"] = "cancelled"
    artem["decidedAt"] = clock.iso(declined_at)
    anna["offer"] = {
        "at": artem["decidedAt"],
        "until": clock.iso(declined_at + timedelta(hours=RESERVE_HOURS)),
    }
