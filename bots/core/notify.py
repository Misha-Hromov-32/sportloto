"""Уведомления сайта в мессенджер: раз в NOTIFY_INTERVAL секунд для каждого подключённого человека.

На сайте уведомления остаются непрочитанными — бот только запоминает, что уже прислал. Режим: самый строгий
из настройки бота (/settings) и общего выключателя каналов сайта (`/delivery/settings`, поле `messengers`).
Тихие часы 22:00–08:00 по городу чата: ночью ничего не приходит, утром — одна сводка."""

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from bots.core import fmt, texts
from bots.core.context import Ctx
from bots.core.render import Button, Unreachable
from bots.core.site_client import SiteError, SiteUnavailable, flt

if TYPE_CHECKING:
    from bots.core.engine import Bot

log = logging.getLogger(__name__)

IMPORTANT = {
    "application",
    "accepted",
    "rejected",
    "waitlist_promoted",
    "waitlist_offer",
    "offer_expired",
    "changed",
    "cancelled",
    "removed",
    "restored",
    "deleted",
    "removed_from_event",
    "stop_listed",
    "threshold_reached",
    "threshold_lost",
    # Оплата на сайте: срок оплаты, снятая запись, возвраты, порог складчины, проданная вещь, выплата
    "pay_due",
    "pay_expired",
    "pay_refund",
    "pay_failed",
    "order_paid",
    "payout_failed",
}
STRICTNESS = {"all": 0, "important": 1, "off": 2}
DELIVERY_TTL = 300
QUIET_FROM, QUIET_TO = 22, 8
SUMMARY_LIMIT = 8


def strictest(*modes: str) -> str:
    return max((m if m in STRICTNESS else "all" for m in modes), key=STRICTNESS.__getitem__)


def is_quiet(ctx: Ctx) -> bool:
    if not ctx.chat.quiet:
        return False
    hour = datetime.fromtimestamp(ctx.now(), fmt.zone(ctx.city)).hour
    return hour >= QUIET_FROM or hour < QUIET_TO


async def site_mode(ctx: Ctx) -> str:
    """Общий выключатель каналов на сайте; нет такого раздела или ошибка — «все»."""
    cache: dict[str, tuple[float, str]] = ctx.bot.__dict__.setdefault("_delivery", {})
    hit = cache.get(ctx.key)
    if hit and time.monotonic() - hit[0] < DELIVERY_TTL:
        return hit[1]
    mode = "all"
    try:
        res = await ctx.api("GET", "/delivery/settings")
        value = (res or {}).get("messengers")
        if value in STRICTNESS:
            mode = value
    except (SiteError, SiteUnavailable):
        mode = "all"
    cache[ctx.key] = (time.monotonic(), mode)
    return mode


async def unread(ctx: Ctx) -> list[dict[str, Any]]:
    res = await ctx.api(
        "GET", "/notifications", query={"filters": [flt("unread", True)], "pagination": {"mode": "off"}}
    )
    return sorted((res or {}).get("data") or [], key=lambda n: n.get("createdAt") or "")


def buttons_for(ctx: Ctx, n: dict[str, Any]) -> list[list[Button]]:
    kind = n.get("type")
    link = n.get("link") or ""
    eid = fmt.event_id_from_link(link)
    open_ = [ctx.link(texts.B_OPEN, link)] if link.startswith("/") else []
    if kind == "application":
        return [[ctx.btn(texts.B_REVIEW, "cmd", c="requests")]]
    if kind in {"accepted", "waitlist_promoted"} and eid:
        return [[ctx.btn(texts.B_ROUTE, "route", e=eid), ctx.btn(texts.B_LEAVE, "leave", e=eid)]]
    if kind == "waitlist_offer" and eid:
        return [
            [
                ctx.btn(texts.B_TAKE_SEAT, "offer", e=eid, ok=True),
                ctx.btn(texts.B_DECLINE_SEAT, "offer", e=eid, ok=False),
            ]
        ]
    if kind == "reminder" and eid:
        return [[ctx.btn(texts.B_ROUTE, "route", e=eid), ctx.btn(texts.B_CANT_COME, "leave", e=eid)]]
    return [open_] if open_ else []


def note_text(n: dict[str, Any]) -> str:
    title = str(n.get("title") or "")
    body = str(n.get("text") or "")
    return f"🔔 {title}\n{body}".strip() if body else f"🔔 {title}"


async def send_summary(ctx: Ctx, items: list[dict[str, Any]], *, quiet: bool) -> None:
    head = (texts.SUMMARY_QUIET if quiet else texts.SUMMARY_MANY).format(n=len(items))
    lines = [head, ""]
    lines += [f"• {n.get('title', '')}" for n in items[:SUMMARY_LIMIT]]
    if len(items) > SUMMARY_LIMIT:
        lines.append(texts.AND_MORE.format(n=len(items) - SUMMARY_LIMIT))
    buttons = [[ctx.link(texts.B_ALL_NOTIF, "/notifications")]]
    if any(n.get("type") == "application" for n in items):
        buttons.insert(0, [ctx.btn(texts.B_REVIEW, "cmd", c="requests")])
    await ctx.say("\n".join(lines), buttons)


async def deliver(ctx: Ctx) -> None:
    key = ctx.key
    store = ctx.bot.store
    mode = strictest(ctx.chat.notify_mode, await site_mode(ctx))
    rows = await unread(ctx)
    fresh = [n for n in rows if store.sent_status(key, str(n["id"])) is None]
    if mode == "off":
        for n in fresh:
            store.mark_sent(key, str(n["id"]), "skipped")
        for h in store.held(key):
            store.mark_sent(key, h["id"], "skipped")
        return
    if mode == "important":
        for n in [n for n in fresh if n.get("type") not in IMPORTANT]:
            store.mark_sent(key, str(n["id"]), "skipped")
        fresh = [n for n in fresh if n.get("type") in IMPORTANT]
    if is_quiet(ctx):
        for n in fresh:
            store.mark_sent(
                key,
                str(n["id"]),
                "held",
                {k: n.get(k) for k in ("title", "text", "link", "type")},
            )
        return
    held = store.held(key)
    if held:
        await send_summary(ctx, held + fresh, quiet=True)
        for n in held + fresh:
            store.mark_sent(key, str(n["id"]), "sent")
        return
    if len(fresh) > 3:
        await send_summary(ctx, fresh, quiet=False)
        for n in fresh:
            store.mark_sent(key, str(n["id"]), "sent")
        return
    for n in fresh:
        await ctx.say(note_text(n), buttons_for(ctx, n))
        store.mark_sent(key, str(n["id"]), "sent")


async def baseline(ctx: Ctx) -> None:
    """После подключения старые непрочитанные не присылаем по одному: только подсказка, где их посмотреть."""
    with contextlib.suppress(SiteError, SiteUnavailable):
        rows = await unread(ctx)
        for n in rows:
            ctx.bot.store.mark_sent(ctx.key, str(n["id"]), "baseline")
        if rows and ctx.chat.notify_mode != "off":
            await ctx.say(texts.BASELINE.format(n=len(rows)))


async def tick(bot: "Bot") -> None:
    for chat in bot.store.linked_chats(bot.platform):
        if not chat.reachable:
            continue
        async with bot.lock(chat.key):
            current = bot.store.get_chat(chat.key)
            if current is None or not current.linked:
                continue
            ctx = Ctx(bot, current)
            try:
                await deliver(ctx)
            except Unreachable:
                bot.store.update_chat(chat.key, reachable=False)
            except SiteError as exc:
                if exc.code == "auth_required":
                    bot.store.set_link(chat.key, None, None, None)
                    with contextlib.suppress(Exception):
                        await ctx.say(texts.TOKEN_REVOKED)
                else:
                    log.warning("уведомления: ошибка сайта %s", exc.code)
            except SiteUnavailable:
                log.warning("уведомления: сайт недоступен")
                return
            except Exception:
                log.exception("уведомления: сбой отправки")


async def loop(bot: "Bot") -> None:
    last_cleanup = 0.0
    while True:
        started = time.monotonic()
        try:
            await tick(bot)
            if started - last_cleanup > 3600:
                bot.store.cleanup(datetime.now(UTC).timestamp())
                last_cleanup = started
        except Exception:
            log.exception("уведомления: сбой цикла")
        await asyncio.sleep(max(1.0, bot.config.notify_interval - (time.monotonic() - started)))
