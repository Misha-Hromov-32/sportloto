"""Приветствие, главное меню, помощь и подключение аккаунта (ссылка с сайта или код из бота)."""

import asyncio
import contextlib
import logging
import re
import time
from typing import TYPE_CHECKING, Any

from bots.core import fmt, texts
from bots.core.context import COMMANDS, Ctx, action, command
from bots.core.render import Message
from bots.core.site_client import SiteError, SiteUnavailable, flt

if TYPE_CHECKING:
    from bots.core.engine import Bot

log = logging.getLogger(__name__)

# Пауза между проверками разных кодов: лимит сайта на проверку общий для адреса бота.
CODE_PAUSE = 1.1


async def pending_count(ctx: Ctx) -> int:
    if not ctx.linked:
        return 0
    try:
        res = await ctx.api(
            "GET",
            "/participations",
            query={"filters": [flt("scope", "organizer_pending")], "pagination": {"mode": "off"}},
        )
    except (SiteError, SiteUnavailable):
        return 0
    return int((res or {}).get("total") or len((res or {}).get("data") or []))


async def menu(ctx: Ctx) -> list[list[str]]:
    rows = [[texts.M_FIND, texts.M_WEEKEND], [texts.M_MY, texts.M_CREATE]]
    n = await pending_count(ctx)
    rows.append([f"{texts.M_REQUESTS} ({n})", texts.M_HELP] if n else [texts.M_HELP])
    return rows


async def show_menu(ctx: Ctx, text: str) -> None:
    await ctx.send(Message(text=text, menu=await menu(ctx)))


async def sync_city(ctx: Ctx) -> None:
    """Город профиля на сайте становится городом чата."""
    with contextlib.suppress(SiteError, SiteUnavailable):
        me = await ctx.api("GET", "/me")
        city = fmt.city_by_name((me or {}).get("city"))
        if city:
            ctx.bot.store.update_chat(ctx.key, city=city)
            ctx.chat.city = city


async def linked(ctx: Ctx, token: str, user: dict[str, Any]) -> None:
    ctx.bot.store.set_link(ctx.key, token, str(user.get("id") or ""), str(user.get("name") or ""))
    ctx.bot.store.drop_code(ctx.key)
    ctx.chat.token = token
    ctx.chat.user_id = str(user.get("id") or "")
    ctx.chat.user_name = str(user.get("name") or "")
    await sync_city(ctx)
    name = (ctx.chat.user_name or "").split(" ")[0] or ctx.chat.user_name or ""
    await show_menu(ctx, texts.LINKED.format(name=name))
    from bots.core import notify  # noqa: PLC0415  уведомления импортируют меню отсюда

    await notify.baseline(ctx)


@command("start")
async def start(ctx: Ctx, args: str) -> None:
    code = re.sub(r"[\s-]", "", args)
    if code:
        try:
            res = await ctx.bot.site.link(code, ctx.platform, ctx.chat.chat_id, ctx.chat.display_name)
        except SiteError as exc:
            await ctx.say(exc.message, [[ctx.btn("Подключить заново", "cmd", c="login")]])
            return
        await linked(ctx, str(res["token"]), res.get("user") or {})
        return
    ctx.clear_state()
    text = texts.GREETING + "\n\n" + texts.CITY_LINE.format(city=fmt.city(ctx.city)["name"])
    if not ctx.linked:
        text += texts.GREETING_GUEST
    await show_menu(ctx, text)


@command("help")
async def help_(ctx: Ctx, _args: str = "") -> None:
    await ctx.say(texts.HELP)


@command("cancel")
async def cancel(ctx: Ctx, _args: str = "") -> None:
    ctx.clear_state()
    await show_menu(ctx, texts.CANCELLED)


@command("login")
async def login(ctx: Ctx, _args: str = "") -> None:
    if ctx.linked:
        await ctx.say(texts.ALREADY_LINKED.format(name=ctx.chat.user_name or ""))
        return
    try:
        code = await ctx.link_code()
    except (SiteError, SiteUnavailable):
        code = None
    if not code:
        await ctx.say(texts.NEED_ACCOUNT_HINT, ctx.login_buttons())
        return
    pretty = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    await ctx.say(texts.LINK_CODE.format(code=pretty), ctx.login_buttons())


@command("logout")
async def logout(ctx: Ctx, _args: str = "") -> None:
    if not ctx.linked:
        await ctx.say(texts.NOT_LINKED)
        return
    token = ctx.chat.token or ""
    note = ""
    try:
        await ctx.bot.site.unlink(token)
    except SiteError as exc:
        if exc.code != "auth_required":
            note = "\nЕсли бот остался в списке на сайте, отключите его в «Настройки → Мессенджеры»."
    except SiteUnavailable:
        note = (
            "\nСайт сейчас недоступен: отключите бота и в «Настройки → Мессенджеры», когда сайт заработает."
        )
    ctx.bot.store.set_link(ctx.key, None, None, None)
    ctx.bot.store.clear_history(ctx.key)
    ctx.chat.token = None
    await show_menu(ctx, texts.LOGGED_OUT + note)


@action("cmd")
async def run_command(ctx: Ctx, p: dict[str, Any]) -> None:
    """Кнопка, которая делает то же, что команда: «Мои записи», «Найти встречу», «Подключить заново»."""
    ctx.clear_state()
    await COMMANDS[p["c"]](ctx, p.get("args", ""))


async def _watch_once(bot: "Bot") -> None:
    now = time.time()
    for key, code, expires in bot.store.codes():
        if not key.startswith(f"{bot.platform}:"):
            continue
        if expires < now:
            bot.store.drop_code(key)
            continue
        chat = bot.store.get_chat(key)
        if chat is None or chat.linked:
            bot.store.drop_code(key)
            continue
        try:
            res = await bot.site.pending_status(code, chat.platform, chat.chat_id)
        except SiteError as exc:
            if exc.code in {"rate_limited", "rate_limit"}:
                # Сайт пускает не больше 60 проверок в минуту: ждём, сколько он попросил.
                await asyncio.sleep(min(60.0, float(exc.body.get("retryAfter") or 5)))
                return
            if exc.status in {404, 410} or exc.code in {"code_expired", "code_invalid"}:
                bot.store.drop_code(key)
            continue
        except SiteUnavailable:
            return
        if (res or {}).get("status") == "linked" and res.get("token"):
            async with bot.lock(key):
                ctx = Ctx(bot, bot.store.get_chat(key) or chat)
                await bot.guard(ctx, linked(ctx, str(res["token"]), res.get("user") or {}))
        await asyncio.sleep(CODE_PAUSE)


async def watch_codes(bot: "Bot", interval: float = 3.0) -> None:
    """Код из бота введён на сайте → бот получает ключ и сам пишет человеку «Готово»."""
    while True:
        try:
            await _watch_once(bot)
        except Exception:
            log.exception("проверка кодов привязки")
        await asyncio.sleep(interval)
