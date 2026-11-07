"""«Подборка дня».

Раз в день, в выбранный час по поясу города человека, приходит уведомление с тремя встречами:
сначала из «Для вас», затем, если не хватило, ближайшие открытые по интересам. Только предстоящие
в ближайшие 7 дней, куда можно записаться и которых не было в прошлых подборках. Пустую подборку
не присылаем. «Прислать сейчас» работает в любой момент и тоже считается подборкой этого дня.

Письмо: тик и «Прислать сейчас» только ставят его в очередь (`mail: "queued"`), отправляет
асинхронный слой сервера (app/services/digest_mail.py) через `claim_mail` и `finish_mail`.
"""

import secrets
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features.kit import commit, db, notify, require_user
from app.domain.lib.cities import city_by_name, city_of_place, default_city
from app.domain.lib.dates import format_event_date
from app.domain.lib.plural import WORDS, count
from app.domain.routing import Route, route
from app.domain.schema import COLLECTIONS
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

HOURS = (8, 12, 18)
DEFAULT_HOUR = 8
SIZE = 3
WINDOW = timedelta(days=7)
# У демо-аккаунтов почта ненастоящая: письма туда не уходят.
DEMO_MAIL_DOMAIN = "@vmeste.demo"
# Письмо «зависло» при отправке (сервер перезапустили): через столько минут пробуем снова.
RETRY_SENDING = timedelta(minutes=10)

NO_EMAIL = "В профиле нет почты. Подборка будет приходить на сайт"
DEMO_EMAIL = "У демо-аккаунта нет настоящей почты. Письма получают те, кто вошёл со своей почтой"
NOT_VERIFIED = "Сначала подтвердите почту: ссылка в письме, которое пришло после регистрации"
NOTHING_NEW = "Новых подходящих встреч на ближайшую неделю пока нет. Загляните завтра"

# Сервер подставляет проверку подтверждения почты (таблица email_status); без проверки почта считается подтверждённой.
_email_checks: list[Callable[[ID], bool]] = []


def use_email_check(check: Callable[[ID], bool]) -> None:
    _email_checks[:] = [check]


def _email_verified(user_id: ID) -> bool:
    return all(check(user_id) for check in _email_checks)


def _new_token() -> str:
    return secrets.token_hex(16)


# ---------- Город, пояс, почта ----------


def user_city(user: Entity) -> dict[str, Any]:
    name = user.get("city")
    return city_by_name(name) or default_city()


def _local_day(moment: datetime, user: Entity) -> str:
    """Местная дата («2026-10-19») в поясе города человека."""
    return f"{clock.local(moment, user_city(user)['timeZone']):%Y-%m-%d}"


def email_state(user: Entity) -> dict[str, Any]:
    address = (user.get("email") or "").strip()
    if not address:
        return {"address": None, "allowed": False, "reason": NO_EMAIL}
    if address.lower().endswith(DEMO_MAIL_DOMAIN):
        return {"address": address, "allowed": False, "reason": DEMO_EMAIL}
    if not _email_verified(user["id"]):
        return {"address": address, "allowed": False, "reason": NOT_VERIFIED}
    return {"address": address, "allowed": True, "reason": None}


# ---------- Настройки ----------


def prefs_of(user_id: ID) -> Entity | None:
    return next((p for p in db().digest_prefs if p["userId"] == user_id), None)


def _ensure_prefs(user: Entity) -> Entity:
    found = prefs_of(user["id"])
    if found is not None:
        return found
    row = {
        "userId": user["id"],
        "on": False,
        "hour": DEFAULT_HOUR,
        "email": False,
        "lastDay": None,
        "token": None,
        "updatedAt": clock.iso(clock.now()),
    }
    db().digest_prefs.append(row)
    return row


def _require_person(actor: Actor) -> Entity:
    user = require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "Подборка встреч приходит участникам и организаторам, не администратору")
    return user


def _digests_of(user_id: ID) -> list[Entity]:
    # Новые — первыми; при одинаковом времени позже добавленная впереди.
    rows = [g for g in reversed(db().digests) if g["userId"] == user_id]
    return sorted(rows, key=lambda g: g["createdAt"], reverse=True)


def settings_view(actor: Actor) -> Entity:
    user = _require_person(actor)
    prefs = prefs_of(user["id"])
    mail = email_state(user)
    city = user_city(user)
    last = next(iter(_digests_of(user["id"])), None)
    return {
        "on": prefs is not None and bool(prefs["on"]),
        "hour": prefs["hour"] if prefs is not None else DEFAULT_HOUR,
        "hours": list(HOURS),
        "email": prefs is not None and bool(prefs["email"]) and mail["allowed"],
        "emailAllowed": mail["allowed"],
        "emailReason": mail["reason"],
        "emailAddress": mail["address"],
        "cityName": city["name"],
        "timeZone": city["timeZone"],
        "last": {"id": last["id"], "createdAt": last["createdAt"], "count": len(last["items"])}
        if last is not None
        else None,
    }


def update_settings(actor: Actor, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    on, hour, email = input_.get("on"), input_.get("hour"), input_.get("email")
    if on is not None and not isinstance(on, bool):
        fail("validation", "Не получилось сохранить настройку подборки", {"on": "Включите или выключите"})
    if hour is not None and (isinstance(hour, bool) or hour not in HOURS):
        fail("validation", "Выберите время: 8:00, 12:00 или 18:00", {"hour": "8:00, 12:00 или 18:00"})
    if email is not None and not isinstance(email, bool):
        fail("validation", "Не получилось сохранить настройку почты", {"email": "Включите или выключите"})
    if email:
        mail = email_state(user)
        if not mail["allowed"]:
            fail("validation", mail["reason"], {"email": mail["reason"]})
    prefs = _ensure_prefs(user)
    if on is not None:
        prefs["on"] = on
    if hour is not None:
        prefs["hour"] = int(hour)
    if email is not None:
        prefs["email"] = email
    prefs["updatedAt"] = clock.iso(clock.now())
    commit(["users"], [user["id"]])
    return settings_view(user)


# ---------- Сбор подборки ----------


def _event(event_id: ID) -> Entity | None:
    return db().record("events", event_id)


def _fits(v: Entity, now: datetime, city_id: str, skip: set[ID]) -> bool:
    start = clock.parse(v["startsAt"])
    return (
        v["id"] not in skip
        and v["state"] == "upcoming"
        and start is not None
        and now < start <= now + WINDOW
        and bool(v["can"]["join"])
        and v["counts"].get("spotsLeft") != 0
        and city_of_place(v["place"])["id"] == city_id
    )


def pick_events(d: "Domain", user: Entity) -> list[Entity]:
    """До трёх встреч: «Для вас», затем ближайшие открытые по интересам. Прошлые подборки не повторяются."""
    now = clock.now()
    city_id = user_city(user)["id"]
    skip = {item["eventId"] for g in _digests_of(user["id"]) for item in g["items"]}
    end = now + WINDOW
    table = COLLECTIONS["events"].table

    def candidate(event: Entity) -> bool:
        start = clock.parse(event["startsAt"])
        return (
            event["id"] not in skip
            and start is not None
            and now < start <= end
            and city_of_place(event["place"])["id"] == city_id
        )

    # В БД читаем только ближайшую неделю; город и уже отправленные встречи отсеиваем
    # до расчёта карточек. Не ограничиваем число кандидатов: «Для вас» ранжирует всю
    # подходящую группу, иначе лучшая встреча могла бы остаться за случайной страницей.
    candidates = db().records(
        "events", table.c.starts_at > now, table.c.starts_at <= end, predicate=candidate
    )
    if not candidates:
        return []
    picked: list[Entity] = []
    for v in d.list_events(user, {"scope": "feed", "forYou": True}, candidates=candidates):
        if len(picked) >= SIZE:
            break
        if _fits(v, now, city_id, skip):
            picked.append({"eventId": v["id"], "reasons": list(v["matchReasons"][:3])})
            skip.add(v["id"])
    if len(picked) < SIZE:
        interests = user.get("interests") or []
        for v in d.list_events(user, {"scope": "feed"}, candidates=candidates):
            if len(picked) >= SIZE:
                break
            if v["sportId"] in interests and _fits(v, now, city_id, skip):
                reasons = list(v["matchReasons"][:3]) or [
                    f"Вы отметили в интересах: {v['sport']['name'].lower()}"
                ]
                picked.append({"eventId": v["id"], "reasons": reasons})
                skip.add(v["id"])
    return picked


def _titles(items: list[Entity]) -> str:
    names = [f"«{e['title']}»" for i in items if (e := _event(i["eventId"])) is not None]
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} и {names[-1]}"


def _create(d: "Domain", user: Entity, prefs: Entity, trigger: str, day: str) -> Entity | None:
    items = pick_events(d, user)
    if not items:
        return None
    at = clock.iso(clock.now())
    queued = bool(prefs["email"]) and email_state(user)["allowed"]
    if queued and not prefs.get("token"):
        prefs["token"] = _new_token()
    digest = {
        "id": store.next_id("dg"),
        "userId": user["id"],
        "items": items,
        "createdAt": at,
        "day": day,
        "trigger": trigger,
        "mail": "queued" if queued else None,
        "mailAt": at if queued else None,
        "intro": None,
    }
    db().digests.append(digest)
    notify(
        d,
        [user["id"]],
        "digest",
        f"Подборка дня: {count(len(items), WORDS['meeting'])} для вас",
        f"{_titles(items)}. Нажмите, чтобы посмотреть, чем они вам подходят.",
        f"/digest/{digest['id']}",
    )
    return digest


def digest_view(d: "Domain", actor: Actor, digest: Entity) -> Entity:
    items = []
    for item in digest["items"]:
        e = _event(item["eventId"])
        if e is None or e["status"] == "deleted":
            continue
        items.append({"event": d.event_view(actor, e), "reasons": item["reasons"]})
    return {
        "id": digest["id"],
        "createdAt": digest["createdAt"],
        "trigger": digest["trigger"],
        "mail": digest["mail"],
        "items": items,
    }


def send_now(d: "Domain", actor: Actor) -> Entity:
    user = _require_person(actor)
    prefs = _ensure_prefs(user)
    day = _local_day(clock.now(), user)
    digest = _create(d, user, prefs, "manual", day)
    if digest is None:
        commit(["users"], [user["id"]])
        return {"sent": False, "message": NOTHING_NEW, "digest": None}
    prefs["lastDay"] = day
    commit(["notifications", "users"], [user["id"]])
    tail = " Копия придёт на почту." if digest["mail"] == "queued" else ""
    return {
        "sent": True,
        "message": f"Подборка пришла в уведомления.{tail}",
        "digest": digest_view(d, user, digest),
    }


def get_digest(d: "Domain", actor: Actor, digest_id: ID) -> Entity:
    user = require_user(actor)
    digest = next((g for g in db().digests if g["id"] == digest_id and g["userId"] == user["id"]), None)
    if digest is None:
        fail("not_found", "Подборка не найдена. Возможно, ссылка устарела")
    return digest_view(d, user, digest)


def unsubscribe(input_: dict[str, Any]) -> Entity:
    """Отписка по ссылке из письма, без входа: подборка выключается целиком."""
    token = input_.get("token")
    prefs = (
        next((p for p in db().digest_prefs if p.get("token") == token), None)
        if isinstance(token, str) and token
        else None
    )
    if prefs is None:
        fail("not_found", "Ссылка для отписки не работает. Выключить подборку можно в настройках")
    was_on = bool(prefs["on"])
    prefs["on"] = False
    prefs["updatedAt"] = clock.iso(clock.now())
    commit(["users"], [prefs["userId"]])
    return {"ok": True, "wasOn": was_on}


def digest_tick(d: "Domain") -> None:
    """Проверка по времени: наступил выбранный час, а сегодня подборки ещё не было.

    Попытка — одна в день: пустая подборка не приходит, а встречи заново не перебираются.
    """
    rows = db().digest_prefs
    if not rows:
        return
    now = clock.now()
    changed = False
    for prefs in rows:
        if not prefs["on"]:
            continue
        user = d.user(prefs["userId"])
        if user is None or user["role"] == "admin":
            continue
        local = clock.local(now, user_city(user)["timeZone"])
        day = f"{local:%Y-%m-%d}"
        if day == prefs.get("lastDay") or local.hour < prefs["hour"]:
            continue
        prefs["lastDay"] = day
        _create(d, user, prefs, "schedule", day)
        changed = True
    if changed:
        commit(["notifications", "users"])


# ---------- Письма (только сервер) ----------


def claim_mail() -> list[Entity]:
    """Письма в очереди: отметить «отправляется» и отдать готовые строки для шаблона."""
    from app.domain.core import domain as d  # noqa: PLC0415

    now = clock.now()
    out: list[Entity] = []
    for digest in db().digests:
        sending_since = clock.parse(digest.get("mailAt"))
        stale = digest["mail"] == "sending" and (sending_since is None or sending_since < now - RETRY_SENDING)
        if digest["mail"] != "queued" and not stale:
            continue
        user = d.user(digest["userId"])
        prefs = prefs_of(digest["userId"])
        mail = email_state(user) if user is not None else {"allowed": False}
        if (
            user is None
            or prefs is None
            or not prefs["email"]
            or not mail["allowed"]
            or not prefs.get("token")
        ):
            digest["mail"] = "skipped"
            digest["mailAt"] = clock.iso(now)
            continue
        digest["mail"] = "sending"
        digest["mailAt"] = clock.iso(now)
        zone = user_city(user)["timeZone"]
        items = []
        with clock.zone(zone):
            for item in digest["items"]:
                e = _event(item["eventId"])
                if e is None or e["status"] in {"deleted", "removed", "cancelled"}:
                    continue
                district = next((x for x in db().districts if x["id"] == e["place"].get("districtId")), None)
                where = e["place"].get("address") or ""
                if district is not None and district["name"] not in where:
                    where = f"{where}, {district['name']}" if where else district["name"]
                items.append(
                    {
                        "title": e["title"],
                        "when": format_event_date(e["startsAt"], now),
                        "where": where,
                        "reasons": list(item["reasons"]),
                        "path": f"/events/{e['id']}",
                    }
                )
        if not items:
            digest["mail"] = "skipped"
            continue
        out.append(
            {
                "digestId": digest["id"],
                "to": mail["address"],
                "name": user["name"],
                "token": prefs["token"],
                "items": items,
            }
        )
    return out


def finish_mail(digest_id: ID, status: str, intro: str | None = None) -> None:
    digest = next((g for g in db().digests if g["id"] == digest_id), None)
    if digest is None:
        return
    digest["mail"] = status
    digest["mailAt"] = clock.iso(clock.now())
    if intro:
        digest["intro"] = intro


# ---------- Демо-данные ----------


def seed_digest_prefs(users: list[Entity], now: datetime) -> list[Entity]:
    """Демо-аккаунты: подборка включена на 8:00, на сайте. Сегодняшняя уже «была» — первая придёт завтра."""
    at = clock.iso(now)
    return [
        {
            "userId": u["id"],
            "on": True,
            "hour": DEFAULT_HOUR,
            "email": False,
            "lastDay": _local_day(now, u),
            "token": None,
            "updatedAt": at,
        }
        for u in users
        if u.get("demo") is not None and u["role"] != "admin"
    ]


# ---------- Маршруты ----------


def digest_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/me/digest$", lambda _p, _b, _q: settings_view(actor())),
        route("put", r"^/me/digest$", lambda _p, b, _q: update_settings(actor(), b)),
        route("post", r"^/me/digest/send-now$", lambda _p, _b, _q: send_now(d, actor())),
        route("post", r"^/digest/unsubscribe$", lambda _p, b, _q: unsubscribe(b)),
        route("get", r"^/digests/([^/]+)$", lambda p, _b, _q: get_digest(d, actor(), p[0])),
    ]
