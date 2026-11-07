"""Встречи, которые я провожу: участники, отмена встречи, фото «Как это было»."""

from typing import Any

from bots.core import fmt, images, texts
from bots.core.context import Ctx, action, command, on_photo, on_text
from bots.core.flows.search import get_event
from bots.core.render import Button
from bots.core.site_client import flt


async def organizing(ctx: Ctx) -> list[dict[str, Any]]:
    res = await ctx.api(
        "GET",
        "/events",
        query={
            "filters": [flt("scope", "organizing")],
            "sorters": [{"field": "startsAt", "order": "asc"}],
            "pagination": {"mode": "off"},
        },
    )
    return (res or {}).get("data") or []


@command("myevents")
async def my_events(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("видеть свои встречи"):
        return
    rows = [e for e in await organizing(ctx) if e.get("state") in {"upcoming", "live"}]
    if not rows:
        await ctx.say(texts.MYEVENTS_EMPTY)
        return
    await ctx.say(texts.MYEVENTS_TITLE)
    for e in rows[:6]:
        counts = e.get("counts") or {}
        cap = e.get("capacity")
        people = f"{counts.get('confirmed', 0)} из {cap}" if cap else str(counts.get("confirmed", 0))
        lines = [
            f"{fmt.icon(e)} {e.get('title', '')}",
            fmt.when(e["startsAt"], ctx.city),
            f"Участников: {people}" + (f", заявок: {counts['pending']}" if counts.get("pending") else ""),
        ]
        if e.get("state") == "live":
            lines.append("Идёт сейчас")
        buttons: list[list[Button]] = []
        if counts.get("pending"):
            buttons.append([ctx.btn(texts.B_REQUESTS_N.format(n=counts["pending"]), "cmd", c="requests")])
        row = [ctx.btn(texts.B_PARTICIPANTS, "oparts", e=e["id"])]
        if e.get("state") == "live":
            row.append(ctx.btn(texts.B_ADD_PHOTO, "ophotos", e=e["id"]))
        else:
            row.append(ctx.btn(texts.B_CANCEL_EVENT, "ocancel", e=e["id"]))
        buttons.append(row)
        buttons.append([ctx.link(texts.B_ON_SITE, f"/events/{e['id']}/manage")])
        await ctx.say("\n".join(lines), buttons)
    if len(rows) > 6:
        await ctx.say(f"Всего встреч: {len(rows)}.", [[ctx.link("Все встречи на сайте", "/me")]])


@action("oparts")
async def participants(ctx: Ctx, p: dict[str, Any]) -> None:
    e = await get_event(ctx, p["e"])
    manage = e.get("manage") or {}
    confirmed = manage.get("confirmed") or []
    lines = [f"«{e.get('title', '')}»"]
    if not confirmed:
        lines.append(texts.PARTICIPANTS_EMPTY)
    else:
        lines.append(f"Участники ({len(confirmed)}):")
        lines += [f"{i + 1}. {(x.get('user') or {}).get('name', '')}" for i, x in enumerate(confirmed[:30])]
    waitlist = manage.get("waitlist") or []
    if waitlist:
        lines.append(f"В листе ожидания: {len(waitlist)}")
    pending = manage.get("pending") or []
    buttons = [[ctx.link(texts.B_ON_SITE, f"/events/{e['id']}/manage")]]
    if pending:
        buttons.insert(0, [ctx.btn(texts.B_REQUESTS_N.format(n=len(pending)), "cmd", c="requests")])
    await ctx.say("\n".join(lines), buttons)


@action("ocancel")
async def cancel_event(ctx: Ctx, p: dict[str, Any]) -> None:
    e = await get_event(ctx, p["e"])
    ctx.set_state("cancel_event", e=e["id"])
    await ctx.say(
        texts.CANCEL_EVENT_ASK.format(title=e.get("title", "")),
        [[ctx.btn(texts.B_NO_REASON, "ocancel_do", e=e["id"]), ctx.btn(texts.B_BACK, "no")]],
    )


@on_text("cancel_event")
async def cancel_reason(ctx: Ctx, text: str, data: dict[str, Any]) -> None:
    await cancel_do(ctx, {"e": data["e"], "r": text.strip()[:300]})


@action("ocancel_do")
async def cancel_do(ctx: Ctx, p: dict[str, Any]) -> None:
    ctx.clear_state()
    body = {"reason": p["r"]} if p.get("r") else {}
    await ctx.api("POST", f"/events/{p['e']}/cancel", body=body)
    await ctx.say(texts.EVENT_CANCELLED)


# ---------- Фото «Как это было» ----------


@command("photos")
async def photos_cmd(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("добавлять фото"):
        return
    rows = [e for e in await organizing(ctx) if e.get("state") in {"live", "past"}]
    rows = sorted(rows, key=lambda e: e["startsAt"], reverse=True)[:5]
    if not rows:
        await ctx.say(texts.PHOTOS_EMPTY)
        return
    buttons = [
        [
            ctx.btn(
                f"{e.get('title', '')[:28]}, {fmt.short_when(e['startsAt'], ctx.city)[:10]}",
                "ophotos",
                e=e["id"],
            )
        ]
        for e in rows
    ]
    await ctx.say(texts.PHOTOS_PICK, buttons)


@action("ophotos")
async def photos_start(ctx: Ctx, p: dict[str, Any]) -> None:
    e = await get_event(ctx, p["e"])
    if len(e.get("photos") or []) >= 4:
        await ctx.say(texts.PHOTOS_FULL)
        return
    ctx.set_state("photos", e=e["id"], title=e.get("title", ""))
    await ctx.say(texts.PHOTOS_PROMPT.format(title=e.get("title", "")), [[ctx.btn(texts.B_DONE, "no")]])


@on_photo("photos")
async def photo_in(ctx: Ctx, photo: Any, data: dict[str, Any]) -> None:
    e = await get_event(ctx, data["e"])
    current = [{"url": x["url"], "caption": x.get("caption") or ""} for x in e.get("photos") or []]
    if len(current) >= 4:
        ctx.clear_state()
        await ctx.say(texts.PHOTOS_FULL)
        return
    try:
        url = images.to_data_url(await ctx.bot.messenger.download(photo))
    except Exception:
        await ctx.say(texts.PHOTO_BAD)
        return
    res = await ctx.api(
        "PUT", f"/events/{data['e']}/photos", body={"photos": [*current, {"url": url, "caption": ""}]}
    )
    n = len((res or {}).get("photos") or []) or len(current) + 1
    if n >= 4:
        ctx.clear_state()
    await ctx.say(texts.PHOTOS_ADDED.format(n=n), [[ctx.link(texts.B_ON_SITE, f"/events/{data['e']}")]])


@on_text("photos")
async def photos_text(ctx: Ctx, _text: str, data: dict[str, Any]) -> None:
    await ctx.say(texts.PHOTOS_PROMPT.format(title=data.get("title", "")), [[ctx.btn(texts.B_DONE, "no")]])
