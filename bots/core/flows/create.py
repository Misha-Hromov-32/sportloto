"""Создать встречу: одной фразой (черновик помощника сайта) или по шагам, с фото обложки,
предпросмотром и публикацией с ключом идемпотентности."""

import re
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from bots.core import fmt, images, texts
from bots.core.context import Ctx, action, command, on_location, on_photo, on_text
from bots.core.render import Button, Message
from bots.core.site_client import SiteError

STEPS = ("sport", "date", "time", "place", "capacity", "price", "joinMode", "photo")
FLOW = "create"


# ---------- Каталог направлений ----------


async def sports(ctx: Ctx) -> list[dict[str, Any]]:
    cache = getattr(ctx.bot, "_sports", None)
    if cache and time.monotonic() - cache[0] < 600:
        return cache[1]
    res = await ctx.api("GET", "/sports", query={"pagination": {"mode": "off"}})
    rows = (res or {}).get("data") or []
    ctx.bot._sports = (time.monotonic(), rows)  # noqa: SLF001  кэш каталога на 10 минут
    return rows


def find_by_name(items: list[dict[str, Any]], name: str | None) -> dict[str, Any] | None:
    if not name:
        return None
    n = fmt.normalize(name)
    if not n:
        return None
    checks = (
        lambda s: fmt.normalize(s["name"]) == n,
        lambda s: any(fmt.normalize(x) == n for x in s.get("synonyms") or []),
        lambda s: fmt.normalize(s["name"]).startswith(n) or n.startswith(fmt.normalize(s["name"])),
        lambda s: n in fmt.normalize(s["name"]) or fmt.normalize(s["name"]) in n,
    )
    for check in checks:
        found = next((s for s in items if check(s)), None)
        if found:
            return found
    return None


# ---------- Разбор ответов ----------

MONTH_STEMS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
WEEKDAY_STEMS = ["понед", "вторн", "сред", "четв", "пятн", "суббот", "воскр"]


def local_now(ctx: Ctx) -> datetime:
    return datetime.fromtimestamp(ctx.now(), fmt.zone(ctx.city))


def parse_date(text: str, now: datetime) -> date | None:
    t = fmt.normalize(text)
    today = now.date()
    if "сегодня" in t:
        return today
    if "послезавтра" in t:
        return today + timedelta(days=2)
    if "завтра" in t:
        return today + timedelta(days=1)
    for i, stem in enumerate(WEEKDAY_STEMS):
        if stem in t:
            return today + timedelta(days=(i - today.weekday()) % 7)
    found = re.search(r"(\d{1,2})[.\s/-](\d{1,2})(?:[.\s/-](\d{2,4}))?", text)
    day = month = year = None
    if found:
        day, month = int(found.group(1)), int(found.group(2))
        year = int(found.group(3)) if found.group(3) else None
    else:
        named = re.search(r"(\d{1,2})\s+([а-яё]+)", text.lower())
        if named:
            stem = next((i for i, s in enumerate(MONTH_STEMS) if named.group(2).startswith(s)), None)
            if stem is not None:
                day, month = int(named.group(1)), stem + 1
    if day is None or month is None:
        return None
    if year is not None and year < 100:
        year += 2000
    try:
        value = date(year or today.year, month, day)
    except ValueError:
        return None
    if year is None and value < today:
        value = value.replace(year=today.year + 1)
    return value


def parse_time(text: str) -> str | None:
    found = re.search(r"(\d{1,2})(?:[:.\s-](\d{2}))?", text)
    if not found:
        return None
    h, m = int(found.group(1)), int(found.group(2) or 0)
    if h > 23 or m > 59:
        return None
    return f"{h:02d}:{m:02d}"


def parse_int(text: str) -> int | None:
    found = re.search(r"\d+", text.replace(" ", ""))
    return int(found.group(0)) if found else None


# ---------- Черновик ----------


def missing_step(data: dict[str, Any]) -> str | None:
    d = data["d"]
    checks = {
        "sport": bool(d.get("sportId") or d.get("newSportName")),
        "date": bool(d.get("date")),
        "time": bool(d.get("time")),
        "place": bool(d.get("address")),
        "capacity": "capacity" in d,
        "price": bool(d.get("price")),
        "joinMode": bool(d.get("joinMode")),
        "photo": bool(data.get("photoDone")),
    }
    return next((s for s in STEPS if not checks[s]), None)


def new_data(source: str) -> dict[str, Any]:
    return {"key": uuid.uuid4().hex, "d": {}, "source": source, "editing": False, "step": None}


def starts_at(ctx: Ctx, d: dict[str, Any]) -> datetime | None:
    if not d.get("date") or not d.get("time"):
        return None
    day = date.fromisoformat(d["date"])
    h, m = (int(x) for x in d["time"].split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=fmt.zone(ctx.city))


def default_title(d: dict[str, Any]) -> str:
    sport = d.get("sportName") or d.get("newSportName") or "Встреча"
    if d.get("date"):
        day = date.fromisoformat(d["date"])
        return f"{sport}, {day.day} {fmt.MONTHS[day.month - 1]}"
    return sport


def event_input(ctx: Ctx, data: dict[str, Any]) -> dict[str, Any]:
    d = data["d"]
    start = starts_at(ctx, d)
    place: dict[str, Any] = {"address": d.get("address", "")}
    for k in ("districtId", "lat", "lng"):
        if d.get(k) is not None:
            place[k] = d[k]
    body: dict[str, Any] = {
        "title": d.get("title") or default_title(d),
        "description": d.get("description") or "",
        "startsAt": fmt.to_iso(start) if start else "",
        "durationMin": d.get("durationMin") or 90,
        "place": place,
        "level": d.get("level") or "any",
        "beginnersWelcome": d.get("beginnersWelcome", True),
        "firstStep": d.get("firstStep") or {},
        "price": d.get("price") or {"kind": "free"},
        "cancelPolicy": {"kind": "anytime"},
        "joinMode": d.get("joinMode") or "open",
        "capacity": d.get("capacity"),
        "minParticipants": d.get("minParticipants"),
        "discussion": "everyone",
        "coverUrl": d.get("cover"),
        "createdWithAssistant": data.get("source") != "steps",
        "idempotencyKey": data["key"],
    }
    if d.get("sportId"):
        body["sportId"] = d["sportId"]
    else:
        body["newSportName"] = d.get("newSportName", "")
        if d.get("confirmNew"):
            body["confirmNew"] = True
    return body


def summary(ctx: Ctx, d: dict[str, Any]) -> str:
    parts = []
    if d.get("sportName") or d.get("newSportName"):
        parts.append(str(d.get("sportName") or d.get("newSportName")).lower())
    start = starts_at(ctx, d)
    if start:
        parts.append(fmt.short_when(fmt.to_iso(start), ctx.city))
    elif d.get("date"):
        day = date.fromisoformat(d["date"])
        parts.append(fmt.day_label(datetime(day.year, day.month, day.day, tzinfo=fmt.zone(ctx.city))))
    if d.get("address"):
        parts.append(d["address"])
    if d.get("capacity"):
        parts.append(f"{d['capacity']} {fmt.plural(d['capacity'], ('место', 'места', 'мест'))}")
    if d.get("price"):
        parts.append(fmt.price({"price": d["price"]}))
    return ", ".join(parts)


# ---------- Шаги ----------


async def ask_step(ctx: Ctx, data: dict[str, Any], step: str | None = None) -> None:
    step = step or missing_step(data)
    if step is None:
        await preview(ctx, data)
        return
    data["step"] = step
    ctx.set_state(FLOW, **data)
    cancel = [ctx.btn(texts.B_CANCEL, "ccancel")]
    if step in {"sport", "sport_text"}:
        if step == "sport_text":
            await ctx.say(texts.ASK_SPORT_TEXT, [cancel])
            return
        popular = [s for s in await sports(ctx) if s.get("popular") and not s.get("mergedInto")][:8]
        rows = [
            [ctx.btn(s["name"][:40], "csport", id=s["id"], n=s["name"]) for s in popular[i : i + 2]]
            for i in range(0, len(popular), 2)
        ]
        rows.append([ctx.btn(texts.B_OTHER, "cstep", s="sport_text"), *cancel])
        await ctx.say(texts.ASK_SPORT, rows)
    elif step in {"date", "date_text"}:
        if step == "date_text":
            await ctx.say(texts.ASK_DATE_TEXT, [cancel])
            return
        now = local_now(ctx).date()
        sat = now + timedelta(days=(5 - now.weekday()) % 7)
        options = [("Сегодня", now), ("Завтра", now + timedelta(days=1))]
        options += [(f"Сб {sat.day:02d}.{sat.month:02d}", sat)]
        sun = sat + timedelta(days=1)
        options += [(f"Вс {sun.day:02d}.{sun.month:02d}", sun)]
        rows = [[ctx.btn(label, "cset", f="date", v=d.isoformat()) for label, d in options[:2]]]
        rows.append([ctx.btn(label, "cset", f="date", v=d.isoformat()) for label, d in options[2:]])
        rows.append([ctx.btn(texts.B_OTHER_DATE, "cstep", s="date_text"), *cancel])
        await ctx.say(texts.ASK_DATE, rows)
    elif step == "time":
        rows = [[ctx.btn(t, "cset", f="time", v=t) for t in ("10:00", "12:00", "18:00", "19:00")], cancel]
        await ctx.say(texts.ASK_TIME, rows)
    elif step == "place":
        prompt = texts.ASK_PLACE_GEO if ctx.bot.messenger.can_request_location else texts.ASK_PLACE
        await ctx.send(Message(text=prompt, buttons=[cancel]))
    elif step == "capacity":
        rows = [
            [ctx.btn(str(n), "cset", f="capacity", v=n) for n in (6, 10, 12, 20)],
            [ctx.btn(texts.B_NO_LIMIT, "cset", f="capacity", v=None)],
            cancel,
        ]
        await ctx.say(texts.ASK_CAPACITY, rows)
    elif step == "price":
        await ctx.say(
            texts.ASK_PRICE, [[ctx.btn(texts.B_FREE, "cset", f="price", v={"kind": "free"})], cancel]
        )
    elif step == "joinMode":
        rows = [
            [
                ctx.btn(texts.B_OPEN, "cset", f="joinMode", v="open"),
                ctx.btn(texts.B_APPROVAL, "cset", f="joinMode", v="approval"),
            ],
            cancel,
        ]
        await ctx.say(texts.ASK_JOIN_MODE, rows)
    elif step == "photo":
        await ctx.say(texts.ASK_PHOTO, [[ctx.btn(texts.B_SKIP, "cset", f="photo", v=None)], cancel])
    elif step == "title":
        await ctx.say(texts.ASK_TITLE, [cancel])


async def after_answer(ctx: Ctx, data: dict[str, Any]) -> None:
    if data.get("editing") and missing_step(data) is None:
        await preview(ctx, data)
    else:
        await ask_step(ctx, data)


def current(ctx: Ctx) -> dict[str, Any] | None:
    flow, data = ctx.state()
    return data if flow == FLOW else None


async def apply(ctx: Ctx, data: dict[str, Any], field: str, value: Any) -> bool:
    """Проверяет и записывает ответ. False — ответ не подошёл, шаг повторяется."""
    d = data["d"]
    if field == "date":
        d["date"] = value
        start = starts_at(ctx, d)
        if start and start.timestamp() <= ctx.now():
            d.pop("time", None)
    elif field == "time":
        probe = {**d, "time": value}
        start = starts_at(ctx, probe)
        if start and start.timestamp() <= ctx.now():
            await ctx.say(texts.PAST_TIME)
            return False
        d["time"] = value
    elif field == "photo":
        data["photoDone"] = True
        if value:
            d["cover"] = value
    else:
        d[field] = value
    return True


@command("create")
async def create(ctx: Ctx, args: str = "") -> None:
    if not await ctx.need_account("создать встречу"):
        return
    if args:
        await from_phrase(ctx, args)
        return
    await ctx.say(
        texts.CREATE_HOW,
        [
            [ctx.btn(texts.B_PHRASE, "cmode", m="phrase"), ctx.btn(texts.B_STEPS, "cmode", m="steps")],
            [ctx.btn(texts.B_CANCEL, "no")],
        ],
    )


@action("cmode")
async def mode(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("создать встречу"):
        return
    if p["m"] == "phrase":
        ctx.set_state("create_phrase")
        await ctx.say(texts.CREATE_PHRASE, [[ctx.btn(texts.B_CANCEL, "no")]])
        return
    await ask_step(ctx, new_data("steps"))


@on_text("create_phrase")
async def phrase_text(ctx: Ctx, text: str, _data: dict[str, Any]) -> None:
    await from_phrase(ctx, text)


async def from_phrase(ctx: Ctx, text: str) -> None:
    data = new_data("phrase")
    try:
        async with ctx.typing():
            res = await ctx.assistant("/assistant/draft", {"kind": "event", "text": text})
    except SiteError as exc:
        if exc.code not in {"assistant_unavailable", "rate_limit"}:
            raise
        await ctx.say(texts.DRAFT_FAILED)
        await ask_step(ctx, data)
        return
    await fill_from_draft(ctx, data, res or {})
    noted = summary(ctx, data["d"])
    if noted:
        await ctx.say(texts.NOTED.format(what=noted))
    await ask_step(ctx, data)


async def fill_from_draft(ctx: Ctx, data: dict[str, Any], res: dict[str, Any]) -> None:
    draft = res.get("draft") or {}
    d = data["d"]
    missing = {m.get("field") for m in res.get("missing") or []}
    if draft.get("sportId"):
        d["sportId"] = draft["sportId"]
        sport = next((s for s in await sports(ctx) if s["id"] == draft["sportId"]), None)
        d["sportName"] = sport["name"] if sport else ""
    elif draft.get("newSportName"):
        d["newSportName"] = draft["newSportName"]
    if draft.get("startsAt") and "date" not in missing:
        start = fmt.local(draft["startsAt"], ctx.city)
        d["date"] = start.date().isoformat()
        if "time" not in missing:
            d["time"] = start.strftime("%H:%M")
    place = draft.get("place") or {}
    if place.get("address"):
        d["address"] = place["address"]
        for k in ("districtId", "lat", "lng"):
            if place.get(k) is not None:
                d[k] = place[k]
    for k in (
        "capacity",
        "minParticipants",
        "joinMode",
        "level",
        "beginnersWelcome",
        "firstStep",
        "price",
        "durationMin",
    ):
        if draft.get(k) is not None:
            d[k] = draft[k]
    if draft.get("title"):
        d["title"] = draft["title"]
    if draft.get("description"):
        d["description"] = draft["description"]


async def fill_from_action(ctx: Ctx, params: dict[str, Any]) -> dict[str, Any]:
    """Действие помощника «create_event» → черновик бота."""
    data = new_data("assistant")
    d = data["d"]
    sport = find_by_name(await sports(ctx), params.get("sport"))
    if sport:
        d["sportId"], d["sportName"] = sport["id"], sport["name"]
    elif params.get("sport"):
        d["newSportName"], d["confirmNew"] = params["sport"], True
    if params.get("date"):
        d["date"] = params["date"]
    if params.get("time"):
        d["time"] = params["time"]
    if params.get("address"):
        d["address"] = params["address"]
    d["capacity"] = params["capacity"] if (params.get("capacity") or 0) >= 2 else 12
    if params.get("price") is not None:
        d["price"] = {"kind": "fixed", "amount": params["price"]} if params["price"] > 0 else {"kind": "free"}
    d["joinMode"] = params.get("joinMode") or "open"
    if params.get("level"):
        d["level"] = params["level"]
        d["beginnersWelcome"] = params["level"] in {"any", "beginner"}
    for k in ("title", "description", "durationMin"):
        if params.get(k):
            d[k] = params[k]
    if d.get("title") and len(d["title"]) < 5:
        d.pop("title")
    data["photoDone"] = True
    return data


@action("csport")
async def pick_sport(ctx: Ctx, p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    data["d"].update({"sportId": p["id"], "sportName": p["n"]})
    data["d"].pop("newSportName", None)
    await after_answer(ctx, data)


@action("cstep")
async def go_step(ctx: Ctx, p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    await ask_step(ctx, data, p["s"])


@action("cset")
async def set_field(ctx: Ctx, p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    if await apply(ctx, data, p["f"], p.get("v")):
        await after_answer(ctx, data)
    else:
        await ask_step(ctx, data, p["f"])


@action("ccancel")
async def cancel(ctx: Ctx, _p: dict[str, Any]) -> None:
    ctx.clear_state()
    await ctx.say(texts.CANCELLED)


@on_text(FLOW)
async def step_text(ctx: Ctx, text: str, data: dict[str, Any]) -> None:
    step = data.get("step")
    d = data["d"]
    if step in {"sport", "sport_text"}:
        sport = find_by_name(await sports(ctx), text)
        if sport and fmt.normalize(sport["name"]) == fmt.normalize(text):
            d.update({"sportId": sport["id"], "sportName": sport["name"]})
            d.pop("newSportName", None)
        else:
            d.pop("sportId", None)
            d.pop("sportName", None)
            d["newSportName"] = text.strip()[:60]
    elif step in {"date", "date_text"}:
        value = parse_date(text, local_now(ctx))
        if value is None or value < local_now(ctx).date():
            await ctx.say(texts.BAD_DATE)
            return
        await apply(ctx, data, "date", value.isoformat())
    elif step == "time":
        value = parse_time(text)
        if value is None:
            await ctx.say(texts.BAD_TIME)
            return
        if not await apply(ctx, data, "time", value):
            return
    elif step == "place":
        d["address"] = text.strip()[:200]
    elif step == "capacity":
        n = parse_int(text)
        if n is None or n < 2:
            await ctx.say(texts.BAD_NUMBER)
            return
        d["capacity"] = min(n, 1000)
    elif step == "price":
        if "бесплат" in text.lower():
            d["price"] = {"kind": "free"}
        else:
            n = parse_int(text)
            if n is None:
                await ctx.say(texts.BAD_PRICE)
                return
            d["price"] = {"kind": "fixed", "amount": n} if n > 0 else {"kind": "free"}
    elif step == "joinMode":
        d["joinMode"] = "approval" if "заявк" in text.lower() else "open"
    elif step == "title":
        if len(text.strip()) < 5:
            await ctx.say(texts.SHORT_TITLE)
            return
        d["title"] = text.strip()[:120]
    elif step == "photo":
        await ctx.say(texts.ASK_PHOTO, [[ctx.btn(texts.B_SKIP, "cset", f="photo", v=None)]])
        return
    else:
        await ask_step(ctx, data)
        return
    await after_answer(ctx, data)


@on_location(FLOW)
async def step_location(ctx: Ctx, lat: float, lng: float, data: dict[str, Any]) -> None:
    if data.get("step") != "place":
        await ask_step(ctx, data, data.get("step"))
        return
    data["d"].update({"lat": lat, "lng": lng})
    ctx.set_state(FLOW, **data)
    await ctx.say(texts.ASK_PLACE_AFTER_GEO)


@on_photo(FLOW)
async def step_photo(ctx: Ctx, photo: Any, data: dict[str, Any]) -> None:
    if data.get("step") != "photo" and not data.get("editing"):
        await ctx.say("Фото поставлю обложкой на последнем шаге. Сейчас ответьте на вопрос выше.")
        return
    try:
        raw = await ctx.bot.messenger.download(photo)
        url = images.to_data_url(raw)
    except Exception:
        await ctx.say(texts.PHOTO_BAD, [[ctx.btn(texts.B_SKIP, "cset", f="photo", v=None)]])
        return
    await apply(ctx, data, "photo", url)
    await ctx.say(texts.PHOTO_OK)
    await after_answer(ctx, data)


# ---------- Предпросмотр и публикация ----------


def preview_event(ctx: Ctx, data: dict[str, Any]) -> dict[str, Any]:
    body = event_input(ctx, data)
    return {
        **body,
        "sport": {"name": data["d"].get("sportName") or data["d"].get("newSportName") or ""},
        "counts": {"confirmed": 0, "spotsLeft": body["capacity"]},
        "organizerView": {"name": ctx.chat.user_name or ""},
    }


async def preview(ctx: Ctx, data: dict[str, Any]) -> None:
    data["editing"] = True
    data["step"] = "preview"
    ctx.set_state(FLOW, **data)
    e = preview_event(ctx, data)
    text = f"{texts.PREVIEW}\n\n{fmt.card_text(e, ctx.city)}"
    if e.get("description"):
        text += f"\n\n{str(e['description'])[:500]}"
    msg = Message(
        text=text,
        buttons=[
            [ctx.btn(texts.B_PUBLISH, "cpublish", k=data["key"])],
            [ctx.btn(texts.B_EDIT, "cedit"), ctx.btn(texts.B_CANCEL, "ccancel")],
        ],
    )
    cover = data["d"].get("cover")
    if cover:
        msg.photo_bytes = images.data_url_bytes(cover)
    await ctx.send(msg)


def edit_buttons(ctx: Ctx) -> list[list[Button]]:
    fields = list(texts.FIELD_LABELS.items())
    rows = [
        [ctx.btn(label, "cfield", f=f) for f, label in fields[i : i + 3]] for i in range(0, len(fields), 3)
    ]
    rows.append([ctx.btn(texts.B_BACK, "cfield", f="preview")])
    return rows


@action("cedit")
async def edit_menu(ctx: Ctx, _p: dict[str, Any]) -> None:
    if current(ctx) is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    await ctx.say(texts.EDIT_WHAT, edit_buttons(ctx))


@action("cfield")
async def edit_field(ctx: Ctx, p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    field = p["f"]
    if field == "preview":
        await preview(ctx, data)
        return
    data["editing"] = True
    await ask_step(ctx, data, field)


@action("cpublish")
async def publish(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("создать встречу"):
        return
    flow, data = ctx.state()
    if flow == "created" and data.get("key") == p.get("k"):
        await ctx.say(texts.ALREADY_PUBLISHED, [[ctx.link(texts.B_ON_SITE, f"/events/{data['id']}")]])
        return
    if flow != FLOW or data.get("key") != p.get("k"):
        await ctx.say(texts.DRAFT_GONE)
        return
    await submit(ctx, data)


async def submit(ctx: Ctx, data: dict[str, Any]) -> None:
    body = event_input(ctx, data)
    try:
        e = await ctx.api("POST", "/events", body=body)
    except SiteError as exc:
        if exc.code == "sport_similar":
            rows = [
                [ctx.btn(s["name"][:40], "csimilar", id=s["id"], n=s["name"])]
                for s in (exc.body.get("similar") or [])[:4]
            ]
            name = data["d"].get("newSportName", "")
            rows.append([ctx.btn(texts.B_NEW_SPORT.format(name=name)[:40], "cconfirmnew")])
            await ctx.say(exc.message, rows)
            return
        if exc.code == "validation":
            errors = "; ".join(str(v) for v in (exc.body.get("errors") or {}).values() if v)
            await ctx.say(texts.CHECK_FIELDS.format(errors=errors or exc.message), edit_buttons(ctx))
            return
        raise
    ctx.set_state("created", key=data["key"], id=e["id"])
    await ctx.send(
        Message(
            text=texts.PUBLISHED.format(title=e.get("title", "")),
            buttons=[
                [ctx.link(texts.B_ON_SITE, f"/events/{e['id']}"), ctx.btn("Мои встречи", "cmd", c="myevents")]
            ],
        )
    )


@action("csimilar")
async def pick_similar(ctx: Ctx, p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    data["d"].update({"sportId": p["id"], "sportName": p["n"]})
    data["d"].pop("newSportName", None)
    ctx.set_state(FLOW, **data)
    await submit(ctx, data)


@action("cconfirmnew")
async def confirm_new(ctx: Ctx, _p: dict[str, Any]) -> None:
    data = current(ctx)
    if data is None:
        await ctx.say(texts.DRAFT_GONE)
        return
    data["d"]["confirmNew"] = True
    ctx.set_state(FLOW, **data)
    await submit(ctx, data)
