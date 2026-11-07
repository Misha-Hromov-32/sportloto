"""Запись на встречу со всеми ветками, отмена, избранное, мои записи и вопрос организатору."""

import uuid
from typing import Any

from bots.core import fmt, texts
from bots.core.context import Ctx, action, command, on_text
from bots.core.flows.search import ACTIVE, card_message, get_event, remember, send_cards
from bots.core.render import Button
from bots.core.site_client import SiteError, flt


@action("no")
async def no(ctx: Ctx, _p: dict[str, Any]) -> None:
    ctx.clear_state()
    await ctx.say(texts.CANCELLED)


@action("join")
async def join(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("записаться"):
        return
    e = await get_event(ctx, p["e"])
    my = e.get("my") or {}
    if my.get("status") in ACTIVE:
        await ctx.say(texts.ALREADY_IN)
        return
    can = e.get("can") or {}
    if not can.get("join"):
        await ctx.say(texts.CANT_JOIN.format(reason=can.get("joinReason") or "запись закрыта"))
        return
    eid = e["id"]
    when = fmt.short_when(e["startsAt"], ctx.city)
    if (e.get("counts") or {}).get("spotsLeft") == 0:
        await ctx.say(
            texts.JOIN_FULL,
            [[ctx.btn(texts.B_WAITLIST, "join_do", e=eid), ctx.btn(texts.B_NO, "no")]],
        )
        return
    if e.get("joinMode") == "approval":
        ctx.set_state("join_note", e=eid)
        await ctx.say(
            texts.JOIN_NOTE,
            [[ctx.btn(texts.B_NO_NOTE, "join_do", e=eid), ctx.btn(texts.B_CANCEL, "no")]],
        )
        return
    await ctx.say(
        texts.JOIN_CONFIRM.format(title=e.get("title", ""), when=when),
        [[ctx.btn(texts.B_YES, "join_do", e=eid), ctx.btn(texts.B_NO, "no")]],
    )


@on_text("join_note")
async def join_note(ctx: Ctx, text: str, data: dict[str, Any]) -> None:
    ctx.clear_state()
    await join_do(ctx, {"e": data["e"], "note": text[:500]})


@action("join_do")
async def join_do(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("записаться"):
        return
    ctx.clear_state()
    body: dict[str, Any] = {}
    if p.get("note"):
        body["note"] = p["note"]
    if not p.get("force"):
        body["checkConflicts"] = True
    try:
        e = await ctx.api("POST", f"/events/{p['e']}/join", body=body)
    except SiteError as exc:
        if exc.code != "time_conflict":
            raise
        items = "\n".join(
            f"• «{c.get('title', '')}», {fmt.short_when(c['startsAt'], ctx.city)}"
            for c in exc.body.get("conflicts") or []
            if c.get("startsAt")
        )
        await ctx.say(
            texts.JOIN_CONFLICT.format(items=items or exc.message),
            [
                [ctx.btn(texts.B_ANYWAY, "join_do", e=p["e"], note=p.get("note") or "", force=True)],
                [ctx.btn(texts.B_CANCEL, "no")],
            ],
        )
        return
    await joined_message(ctx, e)


async def joined_message(ctx: Ctx, e: dict[str, Any]) -> None:
    my = e.get("my") or {}
    status = my.get("status")
    title = e.get("title", "")
    when = fmt.short_when(e["startsAt"], ctx.city)
    site = ctx.link(texts.B_ON_SITE, f"/events/{e['id']}")
    if status == "pending":
        await ctx.say(texts.JOINED_PENDING.format(title=title), [[site]])
    elif status == "waitlist":
        pos = my.get("waitlistPosition")
        await ctx.say(texts.JOINED_WAITLIST.format(place=f", место {pos}" if pos else ""), [[site]])
    else:
        await ctx.say(
            texts.JOINED.format(title=title, when=when),
            [[ctx.btn(texts.B_ROUTE, "route", e=e["id"]), site]],
        )


@action("leave")
async def leave(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("отменить запись"):
        return
    e = await get_event(ctx, p["e"])
    await ctx.say(
        texts.LEAVE_CONFIRM.format(title=e.get("title", ""), when=fmt.short_when(e["startsAt"], ctx.city)),
        [[ctx.btn("Да, отменить", "leave_do", e=e["id"]), ctx.btn(texts.B_NO, "no")]],
    )


@action("leave_do")
async def leave_do(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("отменить запись"):
        return
    res = await ctx.api("POST", f"/events/{p['e']}/leave")
    await ctx.say(texts.LEFT_LATE if (res or {}).get("lateCancel") else texts.LEFT)


@action("fav")
async def fav(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("сохранять встречи в избранное"):
        return
    on = bool(p.get("on", True))
    await ctx.api("PUT" if on else "DELETE", f"/events/{p['e']}/favorite")
    await ctx.say(texts.FAV_ADDED if on else texts.FAV_REMOVED)


@action("offer")
async def offer(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("подтвердить место"):
        return
    ok = bool(p.get("ok", True))
    await ctx.api("POST", f"/events/{p['e']}/offer/{'accept' if ok else 'decline'}")
    await ctx.say(texts.SEAT_TAKEN if ok else texts.SEAT_DECLINED)


@action("ask")
async def ask(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("задать вопрос организатору"):
        return
    ctx.set_state("question", e=p["e"], key=uuid.uuid4().hex)
    await ctx.say(texts.ASK_PROMPT, [[ctx.btn(texts.B_CANCEL, "no")]])


@on_text("question")
async def question(ctx: Ctx, text: str, data: dict[str, Any]) -> None:
    await ctx.api(
        "POST",
        "/messages",
        body={"eventId": data["e"], "text": text[:2000], "idempotencyKey": data.get("key")},
    )
    ctx.clear_state()
    await ctx.say(texts.ASK_SENT)


async def my_events(ctx: Ctx) -> list[dict[str, Any]]:
    res = await ctx.api(
        "GET",
        "/events",
        query={
            "filters": [flt("scope", "participating")],
            "sorters": [{"field": "startsAt", "order": "asc"}],
            "pagination": {"mode": "off"},
        },
    )
    return [
        e
        for e in (res or {}).get("data") or []
        if e.get("state") in {"upcoming", "live"} and (e.get("my") or {}).get("status") in ACTIVE
    ]


@command("my")
async def my(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("видеть свои записи"):
        return
    rows = await my_events(ctx)
    if not rows:
        await ctx.say(texts.MY_EMPTY, [[ctx.btn(texts.M_FIND, "cmd", c="find")]])
        return
    await ctx.say(texts.MY_TITLE)
    for e in rows[:5]:
        msg = card_message(ctx, e)
        buttons: list[list[Button]] = []
        my_ = e.get("my") or {}
        if my_.get("offerUntil"):
            buttons.append(
                [
                    ctx.btn(texts.B_TAKE_SEAT, "offer", e=e["id"], ok=True),
                    ctx.btn(texts.B_DECLINE_SEAT, "offer", e=e["id"], ok=False),
                ]
            )
        row = [ctx.btn(texts.B_ROUTE, "route", e=e["id"])]
        if (e.get("can") or {}).get("leave"):
            row.append(ctx.btn("Отменить", "leave", e=e["id"]))
        buttons.append(row)
        buttons.append(
            [ctx.btn(texts.B_ASK, "ask", e=e["id"]), ctx.link(texts.B_ON_SITE, f"/events/{e['id']}")]
        )
        msg.buttons = buttons
        msg.photo_bytes = msg.photo_url = None
        await ctx.send(msg)
    remember(ctx, rows[:5])
    if len(rows) > 5:
        await ctx.say(f"Всего записей: {len(rows)}.", [[ctx.link("Все записи на сайте", "/me")]])


@command("saved")
async def saved(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("смотреть избранное"):
        return
    res = await ctx.api("GET", "/me/favorites")
    rows = [e for e in (res or {}).get("events") or [] if e.get("state") in {"upcoming", "live"}]
    if not rows:
        await ctx.say(texts.SAVED_EMPTY)
        return
    await ctx.say(texts.SAVED_TITLE)
    await send_cards(ctx, [(e, None) for e in rows[:5]])
    if len(rows) > 5:
        await ctx.say(
            f"Всего в избранном: {len(rows)}.", [[ctx.link("Избранное на сайте", "/me?tab=favorites")]]
        )
