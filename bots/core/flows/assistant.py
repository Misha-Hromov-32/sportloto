"""Свободный текст → помощник сайта (`/assistant/chat`) с последними 12 сообщениями чата.

Подобранные встречи становятся карточками, быстрые ответы — кнопками, действие помощника — подтверждением
[Подтвердить] [Отмена], после которого бот делает обычный запрос сайта. Если помощник недоступен,
бот отвечает сам: подбор встреч, запись, отмена, создание и справка по ключевым словам."""

import re
from typing import Any

from bots.core import fmt, texts
from bots.core.context import Ctx, action, command
from bots.core.flows import create, join, search
from bots.core.render import Button
from bots.core.site_client import SiteError, SiteUnavailable

NEEDS_LOGIN = {
    "create_event",
    "join_event",
    "leave_event",
    "create_companion",
    "favorite_event",
    "update_profile",
}
LEVEL = {"any": "любой уровень", "beginner": "для новичков", "amateur": "любители", "experienced": "опытные"}


@command("ask")
async def ask_cmd(ctx: Ctx, args: str) -> None:
    if not args:
        ctx.set_state("ask")
        await ctx.say("Напишите вопрос, например: «как отменить запись?»")
        return
    await ask(ctx, args)


async def ask(ctx: Ctx, text: str) -> None:
    if ctx.state()[0] == "ask":
        ctx.clear_state()
    history = [*ctx.bot.store.history(ctx.key), {"role": "user", "text": text}][-12:]
    ctx.bot.store.add_history(ctx.key, "user", text)
    try:
        async with ctx.typing():
            reply = await ctx.assistant(
                "/assistant/chat",
                {"messages": history, "cityId": ctx.city, "page": "bot"},
                timeout=ctx.bot.config.assistant_timeout,
            )
    except SiteError as exc:
        if exc.code == "rate_limit":
            await ctx.say(exc.message)
            return
        if exc.code != "assistant_unavailable":
            raise
        await local_reply(ctx, text)
        return
    except SiteUnavailable:
        await local_reply(ctx, text)
        return
    await show_reply(ctx, reply or {})


async def show_reply(ctx: Ctx, reply: dict[str, Any]) -> None:
    text = str(reply.get("text") or "")
    question = reply.get("question")
    if question and question not in text:
        text = f"{text}\n\n{question}".strip()
    buttons: list[list[Button]] = [
        [ctx.link(link["label"][:40], link["to"])] for link in reply.get("links") or []
    ]
    buttons += [[ctx.btn(o[:40], "say", t=o)] for o in (reply.get("options") or [])[:5]]
    if text:
        ctx.bot.store.add_history(ctx.key, "assistant", text)
        await ctx.say(text, buttons)
    match = reply.get("match") or {}
    items = [(i["event"], i.get("why")) for i in match.get("items") or []]
    if items:
        await search.send_cards(ctx, items)
        if (match.get("total") or 0) > len(items):
            await ctx.say(
                texts.FOUND_TOTAL.format(total=match["total"], shown=len(items)),
                [
                    [
                        ctx.btn(
                            texts.MORE,
                            "more",
                            f=search.match_filters(match.get("filters") or {}),
                            o=0,
                            s=[e["id"] for e, _ in items],
                        )
                    ]
                ],
            )
    act = reply.get("action")
    if act:
        await propose(ctx, act)


def action_rows(params: dict[str, Any]) -> str:
    rows = [
        ("Вид спорта", params.get("sport")),
        ("Название", params.get("title")),
        ("Дата", params.get("date")),
        ("Время", params.get("time")),
        ("Длительность", f"{params['durationMin']} мин" if params.get("durationMin") else None),
        ("Адрес", params.get("address")),
        ("Мест", params.get("capacity")),
        (
            "Цена",
            None
            if params.get("price") is None
            else (f"{params['price']} ₽ с человека" if params["price"] > 0 else "бесплатно"),
        ),
        ("Уровень", LEVEL.get(params.get("level") or "")),
        ("Запись", {"open": "свободная", "approval": "по заявке"}.get(params.get("joinMode") or "")),
        ("Когда удобно", params.get("when")),
        ("Район", params.get("district")),
        ("Текст", params.get("text")),
        ("Интересы", ", ".join(params.get("interests") or []) or None),
    ]
    return "".join(f"{k}: {v}\n" for k, v in rows if v not in {None, ""})


async def propose(ctx: Ctx, act: dict[str, Any]) -> None:
    kind = act.get("type")
    params = act.get("params") or {}
    if kind == "navigate":
        path = str(params.get("path") or "")
        if path.startswith("/") and not path.startswith("//"):
            await ctx.say(texts.ACTION_NAVIGATE, [[ctx.link(texts.B_OPEN, path)]])
        return
    if kind in NEEDS_LOGIN and not ctx.linked:
        await ctx.need_account("я сделал это за вас")
        return
    rows = action_rows(params)
    await ctx.say(
        texts.ACTION_ASK.format(summary=act.get("summary") or "", rows=f"{rows}\n" if rows else ""),
        [[ctx.btn(texts.B_CONFIRM, "aconf", act=act), ctx.btn(texts.B_CANCEL, "ano")]],
    )


@action("ano")
async def decline(ctx: Ctx, _p: dict[str, Any]) -> None:
    await ctx.say(texts.ACTION_CANCELLED)


@action("say")
async def say_option(ctx: Ctx, p: dict[str, Any]) -> None:
    await ask(ctx, p["t"])


@action("aconf")
async def confirm(ctx: Ctx, p: dict[str, Any]) -> None:
    act = p.get("act") or {}
    kind = act.get("type")
    params = act.get("params") or {}
    if kind in NEEDS_LOGIN and not await ctx.need_account("я сделал это за вас"):
        return
    eid = params.get("eventId")
    if kind == "join_event" and eid:
        await join.join_do(ctx, {"e": eid})
    elif kind == "leave_event" and eid:
        await join.leave_do(ctx, {"e": eid})
    elif kind == "favorite_event" and eid:
        await join.fav(ctx, {"e": eid, "on": True})
    elif kind == "create_event":
        data = await create.fill_from_action(ctx, params)
        if create.missing_step(data) is None:
            ctx.set_state(create.FLOW, **data)
            await create.submit(ctx, data)
        else:
            await create.ask_step(ctx, data)
    elif kind == "create_companion":
        await create_companion(ctx, params)
    elif kind == "update_profile":
        await update_profile(ctx, params)
    else:
        await ctx.say(texts.ACTION_UNKNOWN)


async def districts(ctx: Ctx) -> list[dict[str, Any]]:
    res = await ctx.api("GET", "/districts", query={"pagination": {"mode": "off"}})
    return (res or {}).get("data") or []


async def create_companion(ctx: Ctx, params: dict[str, Any]) -> None:
    sport = create.find_by_name(await create.sports(ctx), params.get("sport"))
    district = create.find_by_name(await districts(ctx), params.get("district"))
    me = await ctx.api("GET", "/me") or {}
    if not params.get("text") and not sport:
        await ctx.say("Напишите, с кем и чем хотите заниматься.")
        return
    body: dict[str, Any] = {
        **({"sportId": sport["id"]} if sport else {"newSportName": params.get("sport") or ""}),
        "text": params.get("text") or f"Ищу компанию: {sport['name'] if sport else params.get('sport')}",
        "districtId": district["id"] if district else me.get("districtId"),
        "when": params.get("when") or "Когда угодно",
        "level": params["level"] if params.get("level") not in {None, "any"} else "beginner",
        "readiness": "join",
        "createdWithAssistant": True,
    }
    await ctx.api("POST", "/companions", body=body)
    await ctx.say(texts.ACTION_DONE_COMPANION, [[ctx.link("Все объявления", "/companions")]])


async def update_profile(ctx: Ctx, params: dict[str, Any]) -> None:
    me = await ctx.api("GET", "/me") or {}
    catalog = await create.sports(ctx)
    found = [s for s in (create.find_by_name(catalog, n) for n in params.get("interests") or []) if s]
    patch: dict[str, Any] = {}
    if found:
        ids = list(dict.fromkeys([s["id"] for s in me.get("interests") or []] + [s["id"] for s in found]))
        levels = me.get("levels") or {}
        patch["interests"] = ids
        patch["levels"] = {i: levels.get(i, "beginner") for i in ids}
    district = create.find_by_name(await districts(ctx), params.get("district"))
    if district:
        patch["districtId"] = district["id"]
    if not patch:
        await ctx.say(
            "Не нашёл таких видов спорта или района в каталоге.", [[ctx.link("Открыть профиль", "/me")]]
        )
        return
    await ctx.api("PUT", f"/users/{me.get('id')}", body=patch)
    await ctx.say(texts.ACTION_DONE_PROFILE)


# ---------- Ответ без помощника ----------

GREET = re.compile(r"^(привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро)( |$)")
THANKS = re.compile(r"^(спасибо|благодарю|спс)( |$)")
HOW = re.compile(
    r"(^| )(как|где|куда|зачем|почему|что такое|что значит|что делать|можно ли|не могу|не получается|"
    r"не работает|помоги|подскажи|объясни|что будет)( |$)"
)
CREATE_EVENT = re.compile(
    r"(созда(ть|й|м|ю)|организ(овать|ую|уй)|провести|проведу|собрать|соберу|устроить|запусти(ть)?|опубликуй|"
    r"новую|новое) .*(встреч|мероприят|игр|тренировк|событи|матч|турнир|пробежк|прогулк)|"
    r"(встреч|мероприят|событи)\S* .*(созда|организ)"
)
JOIN = re.compile(r"(запиши|записать|запишите|записаться|запишусь|хочу пойти на|пойду на|иду на)")
LEAVE = re.compile(
    r"(отмени|отменить|отписаться|отпиши|выйти из|не смогу прийти|не пойду|убери запись|удали запись)"
)
FAVORITE = re.compile(r"(в избранное|сохрани|добавь в закладки|запомни встреч)")
ORDINALS = [
    (re.compile(r"(^| )(перв\S*|1)( |$)"), 0),
    (re.compile(r"(^| )(втор\S*|2)( |$)"), 1),
    (re.compile(r"(^| )(трет\S*|3)( |$)"), 2),
    (re.compile(r"(^| )(последн\S*)( |$)"), -1),
]


def pick(text: str, cards: list[dict[str, str]]) -> dict[str, str] | None:
    t = fmt.normalize(text)
    for pattern, index in ORDINALS:
        if pattern.search(t) and cards:
            try:
                return cards[index]
            except IndexError:
                return None
    scored = sorted(
        ((sum(1 for w in fmt.normalize(c["title"]).split() if len(w) > 3 and w[:-1] in t), c) for c in cards),
        key=lambda x: -x[0],
    )
    if scored and scored[0][0]:
        return scored[0][1]
    return cards[0] if len(cards) == 1 else None


def find_topic(text: str) -> tuple[str, str, int] | None:
    t = f" {fmt.normalize(text)} "
    best: tuple[str, str, int] | None = None
    for keys, answer, path in texts.HELP_TOPICS:
        score = sum(min(len(k), 12) for k in keys if k in t)
        if score and (best is None or score > best[2]):
            best = (answer, path, score)
    return best


async def reply_local(ctx: Ctx, text: str, buttons: list[list[Button]] | None = None) -> None:
    ctx.bot.store.add_history(ctx.key, "assistant", text)
    await ctx.say(text, buttons)


async def local_reply(ctx: Ctx, text: str) -> None:
    t = fmt.normalize(text)
    if GREET.search(t) and len(t.split()) <= 3:
        await reply_local(
            ctx,
            texts.HELLO,
            [
                [ctx.btn("Подберите мне встречу", "cmd", c="find")],
                [ctx.btn(texts.M_CREATE, "cmd", c="create")],
            ],
        )
        return
    if THANKS.search(t):
        await reply_local(ctx, texts.THANKS)
        return
    if CREATE_EVENT.search(t):
        if await ctx.need_account("создать встречу"):
            await create.from_phrase(ctx, text)
        return
    how = bool(HOW.search(t))
    if LEAVE.search(t) and not how:
        if not await ctx.need_account("отменить запись"):
            return
        mine = [{"id": e["id"], "title": e.get("title", "")} for e in await join.my_events(ctx)]
        if not mine:
            await reply_local(ctx, texts.NO_UPCOMING)
            return
        target = pick(text, mine)
        if target:
            await join.leave(ctx, {"e": target["id"]})
            return
        await ctx.say(texts.WHICH_EVENT, [[ctx.btn(m["title"][:40], "leave", e=m["id"])] for m in mine[:5]])
        return
    cards = search.last_cards(ctx)
    if JOIN.search(t) and not how and cards:
        target = pick(text, cards)
        if target:
            await join.join(ctx, {"e": target["id"]})
            return
        await ctx.say(texts.WHICH_EVENT, [[ctx.btn(c["title"][:40], "join", e=c["id"])] for c in cards[:5]])
        return
    if FAVORITE.search(t) and cards:
        target = pick(text, cards)
        if target:
            await join.fav(ctx, {"e": target["id"], "on": True})
            return
    topic = find_topic(text)
    if topic and (how or topic[2] >= 9):
        await reply_local(ctx, topic[0], [[ctx.link(texts.B_ON_SITE, topic[1])]])
        return
    await search.find(ctx, text)
