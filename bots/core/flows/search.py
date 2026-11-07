"""Поиск встреч: подбор по фразе, списки на сегодня, завтра, выходные, рядом; карточка и «Подробнее»."""

import re
from typing import Any

from bots.core import fmt, images, texts
from bots.core.context import Ctx, action, command, on_location, on_text
from bots.core.render import Button, Location, Message
from bots.core.site_client import SiteError, SiteUnavailable, flt

PAGE = 3
ACTIVE = {"confirmed", "pending", "waitlist"}


# ---------- Карточка ----------


def can_join_button(ctx: Ctx, e: dict[str, Any]) -> bool:
    if e.get("state") != "upcoming" or e.get("isOrganizer"):
        return False
    my = e.get("my") or {}
    if my.get("status") in ACTIVE:
        return False
    if not ctx.linked:
        return True
    return bool((e.get("can") or {}).get("join"))


def card_buttons(ctx: Ctx, e: dict[str, Any], *, details: bool = True) -> list[list[Button]]:
    eid = e["id"]
    first: list[Button] = []
    my = e.get("my") or {}
    if can_join_button(ctx, e):
        first.append(ctx.btn(texts.B_JOIN, "join", e=eid))
    elif my.get("offerUntil"):
        first.append(ctx.btn(texts.B_TAKE_SEAT, "offer", e=eid, ok=True))
    elif my.get("status") in ACTIVE and (e.get("can") or {}).get("leave"):
        first.append(ctx.btn(texts.B_LEAVE, "leave", e=eid))
    fav = bool(e.get("favorite"))
    first.append(ctx.btn(texts.B_FAV_ON if fav else texts.B_FAV, "fav", e=eid, on=not fav))
    second = []
    if details:
        second.append(ctx.btn(texts.B_DETAILS, "details", e=eid))
    second.append(ctx.link(texts.B_ON_SITE, f"/events/{eid}"))
    return [first, second]


def cover(msg: Message, e: dict[str, Any]) -> Message:
    url = e.get("coverUrl")
    if isinstance(url, str) and url:
        raw = images.data_url_bytes(url)
        if raw:
            msg.photo_bytes = raw
        elif url.startswith("https://"):
            msg.photo_url = url
    return msg


def card_message(ctx: Ctx, e: dict[str, Any], why: list[str] | None = None) -> Message:
    text = fmt.card_text(e, ctx.city, why)
    can = e.get("can") or {}
    if (
        ctx.linked
        and e.get("state") == "upcoming"
        and not can.get("join")
        and not (e.get("my") or {}).get("status")
        and not e.get("isOrganizer")
        and can.get("joinReason")
    ):
        text += "\n" + texts.CANT_JOIN.format(reason=can["joinReason"])
    return cover(Message(text=text, buttons=card_buttons(ctx, e)), e)


async def send_cards(ctx: Ctx, items: list[tuple[dict[str, Any], list[str] | None]]) -> None:
    for e, why in items:
        await ctx.send(card_message(ctx, e, why))
    remember(ctx, [e for e, _ in items])


def remember(ctx: Ctx, events: list[dict[str, Any]]) -> None:
    """Показанные встречи попадают в историю чата: «запиши на первую» понимают и помощник, и бот без него."""
    if not events:
        return
    shown = "; ".join(f"{i + 1}) id={e['id']} «{e.get('title', '')}»" for i, e in enumerate(events))
    ctx.bot.store.add_history(ctx.key, "assistant", f"[Показаны встречи: {shown}]")


SHOWN = re.compile(r"id=(\S+) «([^»]*)»")


def last_cards(ctx: Ctx) -> list[dict[str, str]]:
    for m in reversed(ctx.bot.store.history(ctx.key)):
        if m["role"] == "assistant" and "[Показаны встречи:" in m["text"]:
            return [{"id": i, "title": t} for i, t in SHOWN.findall(m["text"])]
    return []


async def get_event(ctx: Ctx, eid: str) -> dict[str, Any]:
    return await ctx.api("GET", f"/events/{eid}")


# ---------- Списки ----------


async def list_events(ctx: Ctx, filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    res = await ctx.api(
        "GET",
        "/events",
        query={
            "filters": fmt.city_filters(ctx.city) + filters,
            "sorters": [{"field": "startsAt", "order": "asc"}],
            "pagination": {"mode": "off"},
        },
    )
    return [e for e in (res or {}).get("data") or [] if e.get("state") in {"upcoming", "live"}]


def when_buttons(ctx: Ctx) -> list[list[Button]]:
    return [
        [
            ctx.btn("Сегодня", "cmd", c="today"),
            ctx.btn("Завтра", "cmd", c="tomorrow"),
            ctx.btn(texts.M_WEEKEND, "cmd", c="weekend"),
        ]
    ]


async def show_list(
    ctx: Ctx,
    filters: list[dict[str, Any]],
    offset: int = 0,
    skip: list[str] | None = None,
    title: str | None = None,
) -> None:
    rows = [e for e in await list_events(ctx, filters) if e["id"] not in (skip or [])]
    page = rows[offset : offset + PAGE]
    if not page:
        await ctx.say(texts.NOTHING_FOUND if not offset else "Больше встреч нет.", when_buttons(ctx))
        return
    if title and not offset:
        await ctx.say(title)
    await send_cards(ctx, [(e, None) for e in page])
    left = len(rows) - offset - len(page)
    if left > 0:
        await ctx.say(
            f"Ещё встреч: {left}.",
            [[ctx.btn(texts.MORE, "more", f=filters, o=offset + PAGE, s=skip or [])]],
        )


@action("more")
async def more(ctx: Ctx, p: dict[str, Any]) -> None:
    await show_list(ctx, p.get("f") or [], int(p.get("o") or 0), p.get("s") or [])


def match_filters(filters: dict[str, Any]) -> list[dict[str, Any]]:
    return [flt(k, v) for k, v in (filters or {}).items() if v is not None and k != "aroundDistrictId"]


async def find(ctx: Ctx, text: str, steps: list[dict[str, Any]] | None = None) -> None:
    """Подбор по фразе системой сайта (`/assistant/match`); без помощника — разбор фразы и обычный поиск."""
    try:
        async with ctx.typing():
            res = await ctx.assistant(
                "/assistant/match", {"text": text, "cityId": ctx.city, "steps": steps or []}
            )
    except SiteError as exc:
        if exc.code not in {"assistant_unavailable", "rate_limit"}:
            raise
        await find_plain(ctx, text, (exc.body.get("fallback") or {}).get("q"))
        return
    items = [(i["event"], i.get("why")) for i in res.get("items") or []]
    reply = res.get("reply") or ""
    if not items:
        buttons = [
            [
                ctx.btn(
                    o["label"][:40], "widen", t=text, s=[*(steps or []), {"id": o["id"], "patch": o["patch"]}]
                )
            ]
            for o in (res.get("widen") or [])[:3]
        ]
        await ctx.say(reply or texts.NOTHING_FOUND, buttons or when_buttons(ctx))
        return
    if reply:
        await ctx.say(reply)
    await send_cards(ctx, items)
    total = int(res.get("total") or len(items))
    if total > len(items):
        await ctx.say(
            texts.FOUND_TOTAL.format(total=total, shown=len(items)),
            [
                [
                    ctx.btn(
                        texts.MORE,
                        "more",
                        f=match_filters(res.get("filters") or {}),
                        o=0,
                        s=[e["id"] for e, _ in items],
                    )
                ]
            ],
        )


@action("widen")
async def widen(ctx: Ctx, p: dict[str, Any]) -> None:
    await find(ctx, p["t"], p.get("s") or [])


async def find_plain(ctx: Ctx, text: str, q: str | None = None) -> None:
    filters: list[dict[str, Any]] = []
    try:
        parsed = await ctx.assistant("/assistant/search", {"text": text})
        filters = match_filters(parsed.get("filters") or {})
        rest = (parsed.get("rest") or "").strip()
        if rest and not any(f["field"] == "q" for f in filters):
            filters.append(flt("q", rest))
    except SiteError:
        filters = [flt("q", q or text)]
    await show_list(ctx, filters)


@command("find")
async def find_cmd(ctx: Ctx, args: str) -> None:
    if not args:
        ctx.set_state("find")
        await ctx.say(texts.FIND_PROMPT, when_buttons(ctx))
        return
    await find(ctx, args)


@on_text("find")
async def find_text(ctx: Ctx, text: str, _data: dict[str, Any]) -> None:
    ctx.clear_state()
    await find(ctx, text)


@command("today")
async def today(ctx: Ctx, _args: str = "") -> None:
    await show_list(ctx, [flt("when", "today")], title="Встречи на сегодня:")


@command("tomorrow")
async def tomorrow(ctx: Ctx, _args: str = "") -> None:
    await show_list(ctx, [flt("when", "tomorrow")], title="Встречи на завтра:")


@command("weekend")
async def weekend(ctx: Ctx, _args: str = "") -> None:
    await show_list(ctx, [flt("when", "weekend")], title="Встречи на выходные:")


@command("near")
async def near(ctx: Ctx, _args: str = "") -> None:
    ctx.set_state("near")
    if ctx.bot.messenger.can_request_location:
        await ctx.send(Message(text=texts.NEAR_PROMPT, request_location=True))
    else:
        await ctx.say(texts.NEAR_PROMPT_TEXT)


@on_location("near")
async def near_location(ctx: Ctx, lat: float, lng: float, _data: dict[str, Any]) -> None:
    ctx.clear_state()
    await near_point(ctx, lat, lng)


async def near_point(ctx: Ctx, lat: float, lng: float) -> None:
    from bots.core.flows.start import show_menu  # noqa: PLC0415  меню возвращается после кнопки геопозиции

    city = fmt.city_of_point(lat, lng)
    if city and city != ctx.city:
        ctx.bot.store.update_chat(ctx.key, city=city)
        ctx.chat.city = city
    await show_menu(ctx, "Встречи рядом с вами, до 5 км:")
    filters = [flt("near", True), flt("radiusKm", 5), flt("point", {"lat": lat, "lng": lng})]
    await show_list(ctx, filters)


@on_text("near")
async def near_text(ctx: Ctx, text: str, _data: dict[str, Any]) -> None:
    ctx.clear_state()
    await find(ctx, text)


# ---------- Одна встреча ----------


@command("event")
async def event_cmd(ctx: Ctx, args: str) -> None:
    eid = args.strip().split(" ")[0] if args.strip() else ""
    if not eid:
        await ctx.say("Напишите номер встречи, например: /event e-volley-hall")
        return
    if eid.isdigit():
        eid = f"e-{eid}"
    e = await get_event(ctx, eid)
    await ctx.send(card_message(ctx, e))
    remember(ctx, [e])


def first_step_text(e: dict[str, Any]) -> list[str]:
    fs = e.get("firstStep") or {}
    lines = []
    for key, label in (
        ("bring", "Что взять"),
        ("howToFind", "Как найти"),
        ("preparation", "Подготовка"),
        ("age", "Возраст"),
        ("firstTimeNote", "Если вы впервые"),
    ):
        if fs.get(key):
            lines.append(f"{label}: {fs[key]}")
    return lines


def cancel_policy(e: dict[str, Any]) -> str:
    cp = e.get("cancelPolicy") or {}
    if cp.get("kind") == "hoursBefore":
        return f"Отменить запись без потерь можно за {cp.get('hours')} ч до начала."
    if cp.get("kind") == "eveBefore":
        return f"Отменить запись без потерь можно накануне до {cp.get('time')}."
    return "Отменить запись можно в любое время."


def location(e: dict[str, Any]) -> Location | None:
    place = e.get("place") or {}
    if isinstance(place.get("lat"), int | float) and isinstance(place.get("lng"), int | float):
        return Location(
            lat=float(place["lat"]),
            lng=float(place["lng"]),
            title=str(e.get("title") or "")[:60],
            address=str(place.get("address") or ""),
        )
    return None


@action("details")
async def details(ctx: Ctx, p: dict[str, Any]) -> None:
    e = await get_event(ctx, p["e"])
    lines = [f"{fmt.icon(e)} {e.get('title', '')}", fmt.when(e["startsAt"], ctx.city)]
    if e.get("durationMin"):
        lines.append(f"Длительность: {fmt.duration(e['durationMin'])}")
    if e.get("description"):
        lines += ["", str(e["description"])[:1500]]
    steps = first_step_text(e)
    if steps:
        lines += ["", "Первый шаг", *steps]
    place = e.get("place") or {}
    lines += ["", f"📍 {place.get('address', '')}"]
    if place.get("landmark"):
        lines.append(f"Ориентир: {place['landmark']}")
    lines.append(cancel_policy(e))
    if e.get("privateInfo"):
        lines.append(f"Для участников: {e['privateInfo']}")
    lines.append(f"Номер встречи: {e['id']}")
    buttons = card_buttons(ctx, e, details=False)
    if ctx.linked and (e.get("can") or {}).get("ask") and not e.get("isOrganizer"):
        buttons.insert(1, [ctx.btn(texts.B_ASK, "ask", e=e["id"])])
    await ctx.send(Message(text="\n".join(lines), buttons=buttons, location=location(e)))


@action("route")
async def route(ctx: Ctx, p: dict[str, Any]) -> None:
    e = await get_event(ctx, p["e"])
    place = e.get("place") or {}
    lines = [
        f"«{e.get('title', '')}», {fmt.short_when(e['startsAt'], ctx.city)}",
        f"📍 {place.get('address', '')}",
    ]
    if place.get("landmark"):
        lines.append(f"Ориентир: {place['landmark']}")
    how = (e.get("firstStep") or {}).get("howToFind")
    if how:
        lines.append(f"Как найти: {how}")
    if e.get("privateInfo"):
        lines.append(f"Для участников: {e['privateInfo']}")
    await ctx.send(
        Message(
            text="\n".join(lines),
            buttons=[[ctx.link(texts.B_ON_SITE, f"/events/{e['id']}")]],
            location=location(e),
        )
    )


async def safe_get_event(ctx: Ctx, eid: str) -> dict[str, Any] | None:
    try:
        return await get_event(ctx, eid)
    except (SiteError, SiteUnavailable):
        return None
