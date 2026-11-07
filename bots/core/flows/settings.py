"""Настройки чата: город, какие уведомления присылать, тихие часы; список новых уведомлений."""

from typing import Any

from bots.core import fmt, texts
from bots.core.context import Ctx, action, command
from bots.core.site_client import flt


async def show(ctx: Ctx) -> None:
    c = ctx.chat
    account = c.user_name or "подключён" if c.linked else "не подключён"
    text = texts.SETTINGS.format(
        city=fmt.city(c.city)["name"],
        mode=texts.MODE_LABELS.get(c.notify_mode, c.notify_mode),
        quiet="включены" if c.quiet else "выключены",
        account=account,
    )
    rows = [
        [ctx.btn(texts.B_CITY.format(city=fmt.city(c.city)["name"]), "scity")],
        [ctx.btn(texts.B_MODE.format(mode=texts.MODE_LABELS.get(c.notify_mode, "")), "smode")],
        [
            ctx.btn(
                texts.B_QUIET.format(state="выключить" if c.quiet else "включить"), "squiet", on=not c.quiet
            )
        ],
    ]
    rows.append(
        [ctx.btn(texts.B_LOGOUT, "cmd", c="logout")]
        if c.linked
        else [ctx.btn("Подключить аккаунт", "cmd", c="login")]
    )
    await ctx.say(text, rows)


@command("settings")
async def settings(ctx: Ctx, _args: str = "") -> None:
    await show(ctx)


@command("city")
async def city_cmd(ctx: Ctx, _args: str = "") -> None:
    await ask_city(ctx, {})


@action("scity")
async def ask_city(ctx: Ctx, _p: dict[str, Any]) -> None:
    await ctx.say(texts.CITY_ASK, [[ctx.btn(c["name"], "scity_set", c=cid)] for cid, c in fmt.CITIES.items()])


@action("scity_set")
async def set_city(ctx: Ctx, p: dict[str, Any]) -> None:
    if p["c"] not in fmt.CITIES:
        return
    ctx.bot.store.update_chat(ctx.key, city=p["c"])
    ctx.chat.city = p["c"]
    await ctx.say(texts.CITY_SET.format(city=fmt.city(p["c"])["name"]))


@action("smode")
async def ask_mode(ctx: Ctx, _p: dict[str, Any]) -> None:
    await ctx.say(
        texts.MODE_ASK,
        [
            [ctx.btn(texts.B_MODE_ALL, "smode_set", m="all")],
            [ctx.btn(texts.B_MODE_IMPORTANT, "smode_set", m="important")],
            [ctx.btn(texts.B_MODE_OFF, "smode_set", m="off")],
        ],
    )


@action("smode_set")
async def set_mode(ctx: Ctx, p: dict[str, Any]) -> None:
    if p["m"] not in texts.MODE_LABELS:
        return
    ctx.bot.store.update_chat(ctx.key, notify_mode=p["m"])
    ctx.chat.notify_mode = p["m"]
    await ctx.say(texts.MODE_SET.format(mode=texts.MODE_LABELS[p["m"]]))


@action("squiet")
async def set_quiet(ctx: Ctx, p: dict[str, Any]) -> None:
    on = bool(p.get("on"))
    ctx.bot.store.update_chat(ctx.key, quiet=on)
    ctx.chat.quiet = on
    await ctx.say(texts.QUIET_ON if on else texts.QUIET_OFF)


@command("notifications")
async def notifications(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("видеть уведомления"):
        return
    res = await ctx.api(
        "GET", "/notifications", query={"filters": [flt("unread", True)], "pagination": {"mode": "off"}}
    )
    rows = sorted((res or {}).get("data") or [], key=lambda n: n.get("createdAt") or "", reverse=True)
    if not rows:
        await ctx.say(texts.NOTIF_EMPTY)
        return
    lines = [texts.NOTIF_TITLE]
    lines += [f"• {n.get('title', '')}" + (f" — {n['text']}" if n.get("text") else "") for n in rows[:10]]
    if len(rows) > 10:
        lines.append(texts.AND_MORE.format(n=len(rows) - 10))
    await ctx.say("\n".join(lines), [[ctx.link(texts.B_ALL_NOTIF, "/notifications")]])
