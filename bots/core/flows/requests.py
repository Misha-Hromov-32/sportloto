"""Заявки на мои встречи по одной: принять, отклонить с причиной, отложить. После решения
несколько секунд можно нажать «Вернуть»: запрос на сайт уходит только по истечении срока."""

import asyncio
import contextlib
from typing import Any

from bots.core import fmt, texts
from bots.core.context import Ctx, action, command, on_text
from bots.core.render import Button
from bots.core.site_client import SiteError, SiteUnavailable, flt


def _skipped(ctx: Ctx) -> set[str]:
    store: dict[str, set[str]] = ctx.bot.__dict__.setdefault("_req_skip", {})
    return store.setdefault(ctx.key, set())


async def pending(ctx: Ctx) -> list[dict[str, Any]]:
    res = await ctx.api(
        "GET",
        "/participations",
        query={"filters": [flt("scope", "organizer_pending")], "pagination": {"mode": "off"}},
    )
    return (res or {}).get("data") or []


def enough_seats(r: dict[str, Any]) -> bool:
    left = (r.get("event") or {}).get("seatsLeft")
    return left is None or left >= (r.get("seats") or 1)


def first_name(r: dict[str, Any]) -> str:
    name = str((r.get("user") or {}).get("name") or "Участник")
    return name.split(" ", 1)[0]


def card(ctx: Ctx, r: dict[str, Any], position: int, total: int) -> tuple[str, list[list[Button]]]:
    user = r.get("user") or {}
    head = str(user.get("name") or "Участник")
    if user.get("age"):
        head += f", {user['age']} {fmt.plural(user['age'], ('год', 'года', 'лет'))}"
    if user.get("level") in fmt.SKILL:
        head += f" · {fmt.SKILL[user['level']]}"
    lines = [head, f"Встреч на платформе: {r.get('attended') or 0}"]
    if r.get("note"):
        lines.append(f"«{r['note']}»")
    if r.get("firstVisit"):
        lines.append("Впервые на такой встрече")
    e = r.get("event") or {}
    left = e.get("seatsLeft")
    seats = "без лимита мест" if left is None else f"свободно {left} из {e.get('capacity')}"
    lines.append(
        f"Заявка {fmt.ago(r['createdAt']) if r.get('createdAt') else ''} · {e.get('title', '')}, "
        f"{fmt.short_when(e['startsAt'], ctx.city) if e.get('startsAt') else ''} · {seats}"
    )
    if (r.get("seats") or 1) > 1:
        lines.append(f"Займёт мест: {r['seats']}")
    if total > 1:
        lines.append(f"Заявка {position} из {total}")
    pid, name = r["id"], first_name(r)
    row = []
    if enough_seats(r):
        row.append(ctx.btn(texts.B_ACCEPT, "racc", p=pid, n=name))
    row += [ctx.btn(texts.B_REJECT, "rrej", p=pid, n=name), ctx.btn(texts.B_LATER, "rlater", p=pid)]
    buttons = [row]
    if not enough_seats(r):
        lines.append(texts.REQ_NO_SEATS)
        buttons.append([ctx.link("Открыть встречу", f"/events/{e.get('id')}/manage")])
    return "\n".join(lines), buttons


async def show_next(ctx: Ctx, ref: str | None = None) -> None:
    rows = await pending(ctx)
    skip = _skipped(ctx)
    fresh = [r for r in rows if r["id"] not in skip]
    if not fresh:
        if rows:
            await ctx.say(texts.REQ_SKIPPED, [[ctx.btn(texts.B_SHOW_AGAIN, "ragain")]])
        else:
            await ctx.say(texts.REQ_EMPTY)
        return
    text, buttons = card(ctx, fresh[0], rows.index(fresh[0]) + 1, len(rows))
    if ref:
        await ctx.edit(ref, text, buttons)
    else:
        await ctx.say(text, buttons)


@command("requests")
async def requests_cmd(ctx: Ctx, _args: str = "") -> None:
    if not await ctx.need_account("разбирать заявки"):
        return
    await show_next(ctx)


@action("rlater")
async def later(ctx: Ctx, p: dict[str, Any]) -> None:
    _skipped(ctx).add(p["p"])
    await show_next(ctx)


@action("ragain")
async def again(ctx: Ctx, _p: dict[str, Any]) -> None:
    _skipped(ctx).clear()
    await show_next(ctx)


@action("racc")
async def accept(ctx: Ctx, p: dict[str, Any]) -> None:
    if not await ctx.need_account("разбирать заявки"):
        return
    await decide(ctx, p["p"], p["n"], "accept", None)


@action("rrej")
async def reject(ctx: Ctx, p: dict[str, Any]) -> None:
    pid, name = p["p"], p["n"]
    rows = [[ctx.btn(t, "rreason", p=pid, n=name, r=t)] for t in texts.REJECT_TEMPLATES]
    rows.append(
        [
            ctx.btn(texts.B_OWN_WORDS, "rown", p=pid, n=name),
            ctx.btn(texts.B_NO_REASON, "rreason", p=pid, n=name, r=""),
        ]
    )
    rows.append([ctx.btn(texts.B_BACK, "rback")])
    await ctx.edit(ctx.inc.message if ctx.inc else None, texts.REJECT_WHY.format(name=name), rows)


@action("rback")
async def back(ctx: Ctx, _p: dict[str, Any]) -> None:
    await show_next(ctx, ctx.inc.message if ctx.inc else None)


@action("rreason")
async def reason(ctx: Ctx, p: dict[str, Any]) -> None:
    await decide(ctx, p["p"], p["n"], "reject", p.get("r") or None)


@action("rown")
async def own_words(ctx: Ctx, p: dict[str, Any]) -> None:
    ctx.set_state("reject_reason", p=p["p"], n=p["n"], ref=ctx.inc.message if ctx.inc else None)
    await ctx.say(texts.REJECT_OWN.format(name=p["n"]), [[ctx.btn(texts.B_CANCEL, "no")]])


@on_text("reject_reason")
async def reason_text(ctx: Ctx, text: str, data: dict[str, Any]) -> None:
    ctx.clear_state()
    await decide(ctx, data["p"], data["n"], "reject", text.strip()[:300], ref=data.get("ref"))


async def decide(
    ctx: Ctx, pid: str, name: str, decision: str, reason_: str | None, *, ref: str | None = None
) -> None:
    ref = ref or (ctx.inc.message if ctx.inc else None)
    done = (texts.ACCEPTED if decision == "accept" else texts.REJECTED).format(name=name)
    if ref is None:
        ref = await ctx.say(done, [[ctx.btn(texts.B_UNDO, "rundo", p=pid)]])
    else:
        await ctx.edit(ref, done, [[ctx.btn(texts.B_UNDO, "rundo", p=pid)]])
    bot = ctx.bot
    task_key = f"{ctx.key}:{pid}"
    old = bot.undo.pop(task_key, None)
    if old:
        old.cancel()

    async def commit() -> None:
        await asyncio.sleep(bot.config.undo_seconds)
        async with bot.lock(ctx.key):
            if bot.undo.pop(task_key, None) is None:
                return
            fresh = Ctx(bot, bot.store.get_chat(ctx.key) or ctx.chat)
            body: dict[str, Any] = {"decision": decision}
            if reason_:
                body["reason"] = reason_
            try:
                await fresh.api("POST", f"/participations/{pid}/decide", body=body)
            except SiteError as exc:
                await fresh.edit(ref, exc.message)
            except SiteUnavailable:
                await fresh.edit(ref, texts.SITE_DOWN)
                return
            else:
                await fresh.edit(ref, done)
            await bot.guard(fresh, show_next(fresh))

    bot.undo[task_key] = bot.spawn(commit())


@action("rundo")
async def undo(ctx: Ctx, p: dict[str, Any]) -> None:
    task = ctx.bot.undo.pop(f"{ctx.key}:{p['p']}", None)
    if task is None or task.done():
        await ctx.say("Решение уже отправлено, вернуть его нельзя.")
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    rows = await pending(ctx)
    found = next((r for r in rows if r["id"] == p["p"]), None)
    ref = ctx.inc.message if ctx.inc else None
    if found is None:
        await ctx.edit(ref, texts.RETURNED)
        return
    text, buttons = card(ctx, found, rows.index(found) + 1, len(rows))
    await ctx.edit(ref, f"{texts.RETURNED}\n\n{text}", buttons)
