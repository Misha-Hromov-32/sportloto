"""Ядро бота: принимает сообщения от адаптера мессенджера и раздаёт их командам, кнопкам и шагам сценариев."""

import asyncio
import contextlib
import logging
import re
import time
from collections import defaultdict, deque
from collections.abc import Callable, Coroutine
from typing import Any

from bots.core import texts
from bots.core.config import Config
from bots.core.context import ACTIONS, COMMANDS, LOCATION_STEPS, PHOTO_STEPS, TEXT_STEPS, Ctx
from bots.core.render import Incoming, Messenger, Unreachable
from bots.core.site_client import SiteClient, SiteError, SiteUnavailable
from bots.core.store import Store

# Команды и сценарии регистрируются при импорте модулей.
from bots.core.flows import (  # noqa: F401  # isort: skip
    assistant,
    create,
    join,
    organizer,
    requests,
    search,
    settings,
    start,
)

log = logging.getLogger(__name__)

MENU = {
    texts.M_FIND.lower(): "find",
    texts.M_WEEKEND.lower(): "weekend",
    texts.M_MY.lower(): "my",
    texts.M_CREATE.lower(): "create",
    texts.M_HELP.lower(): "help",
    "начать": "start",
    "меню": "start",
    "отмена": "cancel",
}
_REQUESTS_LABEL = re.compile(r"^заявки( \(\d+\))?$")
_LINK_CODE = re.compile(r"^\d{3}[ -]?\d{3}$")
_COMMAND = re.compile(r"^/([a-z_]+)(?:@\S+)?(?:\s+(.*))?$", re.DOTALL | re.IGNORECASE)


class Bot:
    def __init__(
        self,
        config: Config,
        messenger: Messenger,
        store: Store,
        site: SiteClient,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.config = config
        self.messenger = messenger
        self.store = store
        self.site = site
        self.clock = clock
        self.heavy = asyncio.Semaphore(4)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._rate: dict[str, deque[float]] = defaultdict(deque)
        self._warned: dict[str, float] = {}
        self.undo: dict[str, asyncio.Task[None]] = {}
        self._tasks: set[asyncio.Task[Any]] = set()

    @property
    def platform(self) -> str:
        return self.messenger.platform

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def lock(self, key: str) -> asyncio.Lock:
        return self._locks[key]

    def ctx_for(self, key: str) -> Ctx | None:
        chat = self.store.get_chat(key)
        return Ctx(self, chat) if chat else None

    def _allowed(self, key: str) -> bool:
        now = time.monotonic()
        calls = self._rate[key]
        while calls and now - calls[0] > 60:
            calls.popleft()
        if len(calls) >= self.config.messages_per_minute:
            return False
        calls.append(now)
        return True

    async def handle(self, inc: Incoming) -> None:
        chat = self.store.chat(self.platform, inc.chat_id, inc.name)
        if inc.kind in {"allow", "deny"}:
            self.store.update_chat(chat.key, reachable=inc.kind == "allow")
            return
        if not chat.reachable:
            self.store.update_chat(chat.key, reachable=True)
        if not self._allowed(chat.key):
            if inc.kind == "button":
                with contextlib.suppress(Exception):
                    await self.messenger.answer(inc.callback)
            if time.monotonic() - self._warned.get(chat.key, -999) > 60:
                self._warned[chat.key] = time.monotonic()
                with contextlib.suppress(Exception):
                    await Ctx(self, chat, inc).say(texts.TOO_FAST)
            return
        async with self.lock(chat.key):
            chat = self.store.get_chat(chat.key) or chat
            ctx = Ctx(self, chat, inc)
            await self.guard(ctx, self._route(ctx))

    async def guard(self, ctx: Ctx, work: Coroutine[Any, Any, Any]) -> None:
        """Ошибка сайта — его же понятный текст, сбой сети — «сайт недоступен», остальное — в журнал."""
        try:
            await work
        except SiteUnavailable as exc:
            log.warning("сайт недоступен: %s", exc)
            with contextlib.suppress(Exception):
                await ctx.say(texts.SITE_DOWN)
        except SiteError as exc:
            if exc.code == "auth_required" and ctx.chat.token:
                self.store.set_link(ctx.key, None, None, None)
                ctx.chat.token = None
                with contextlib.suppress(Exception):
                    await ctx.say(texts.TOKEN_REVOKED)
                return
            with contextlib.suppress(Exception):
                await ctx.say(exc.message or texts.SOMETHING_WRONG)
        except Unreachable:
            self.store.update_chat(ctx.key, reachable=False)
        except Exception:
            log.exception("ошибка обработки сообщения (%s)", self.platform)
            with contextlib.suppress(Exception):
                await ctx.say(texts.SOMETHING_WRONG)

    async def _route(self, ctx: Ctx) -> None:
        inc = ctx.inc
        assert inc is not None  # noqa: S101  входящее сообщение есть всегда, когда маршрутизируем
        if inc.kind == "button":
            with contextlib.suppress(Exception):
                await self.messenger.answer(inc.callback)
            payload = self.store.button(ctx.key, inc.data)
            if payload is None or payload.get("a") not in ACTIONS:
                await ctx.say(texts.STALE_BUTTON)
                return
            await ACTIONS[payload["a"]](ctx, payload)
            return
        if inc.kind == "start":
            await COMMANDS["start"](ctx, inc.ref or "")
            return
        flow, data = ctx.state()
        if inc.kind == "photo":
            if flow in PHOTO_STEPS:
                await PHOTO_STEPS[flow](ctx, inc.photo, data)
            else:
                await ctx.say(
                    "Фото можно поставить обложкой при создании встречи (/create) или добавить к прошедшей встрече (/photos)."
                )
            return
        if inc.kind == "location":
            if flow in LOCATION_STEPS:
                await LOCATION_STEPS[flow](ctx, inc.lat, inc.lng, data)
            else:
                await search.near_point(ctx, inc.lat or 0.0, inc.lng or 0.0)
            return
        text = (inc.text or "").strip()
        if not text:
            return
        found = _COMMAND.match(text)
        if found:
            name, args = found.group(1).lower(), (found.group(2) or "").strip()
            handler = COMMANDS.get(name)
            if handler is None:
                await ctx.say("Такой команды нет. Все команды — /help")
                return
            if name != "start" or not args:
                ctx.clear_state()
            await handler(ctx, args)
            return
        if not ctx.linked and _LINK_CODE.match(text):
            # Код со страницы сайта «отправьте боту этот код».
            await COMMANDS["start"](ctx, text)
            return
        label = text.lower()
        if label in MENU or _REQUESTS_LABEL.match(label):
            ctx.clear_state()
            await COMMANDS[MENU.get(label, "requests")](ctx, "")
            return
        if flow in TEXT_STEPS:
            await TEXT_STEPS[flow](ctx, text, data)
            return
        await assistant.ask(ctx, text)

    async def background(self) -> None:
        from bots.core import notify  # noqa: PLC0415  опрос уведомлений использует ядро

        await asyncio.gather(notify.loop(self), start.watch_codes(self))
