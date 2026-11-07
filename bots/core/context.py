"""Контекст одного входящего сообщения и реестр команд, кнопок и шагов сценариев."""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING, Any

from bots.core import fmt, texts
from bots.core.render import Button, Incoming, Message
from bots.core.store import Chat

if TYPE_CHECKING:
    from bots.core.engine import Bot

Handler = Callable[..., Awaitable[None]]

COMMANDS: dict[str, Handler] = {}
ACTIONS: dict[str, Handler] = {}
TEXT_STEPS: dict[str, Handler] = {}
PHOTO_STEPS: dict[str, Handler] = {}
LOCATION_STEPS: dict[str, Handler] = {}

# Куда ведут кнопки «Войти через сайт» и «Зарегистрироваться»: после входа сайт выдаёт ссылку-привязку
# обратно в бота (t.me/<бот>?start=<код>, vk.me/club…?ref=<код>) и код, который можно прислать боту.
LINK_PAGE = "/bots/link?platform={platform}"


def command(*names: str) -> Callable[[Handler], Handler]:
    def wrap(fn: Handler) -> Handler:
        for n in names:
            COMMANDS[n] = fn
        return fn

    return wrap


def action(name: str) -> Callable[[Handler], Handler]:
    def wrap(fn: Handler) -> Handler:
        ACTIONS[name] = fn
        return fn

    return wrap


def on_text(flow: str) -> Callable[[Handler], Handler]:
    def wrap(fn: Handler) -> Handler:
        TEXT_STEPS[flow] = fn
        return fn

    return wrap


def on_photo(flow: str) -> Callable[[Handler], Handler]:
    def wrap(fn: Handler) -> Handler:
        PHOTO_STEPS[flow] = fn
        return fn

    return wrap


def on_location(flow: str) -> Callable[[Handler], Handler]:
    def wrap(fn: Handler) -> Handler:
        LOCATION_STEPS[flow] = fn
        return fn

    return wrap


class Ctx:
    def __init__(self, bot: "Bot", chat: Chat, inc: Incoming | None = None) -> None:
        self.bot = bot
        self.chat = chat
        self.inc = inc

    # ---------- Кто и где ----------

    @property
    def key(self) -> str:
        return self.chat.key

    @property
    def city(self) -> str:
        return self.chat.city

    @property
    def linked(self) -> bool:
        return self.chat.linked

    @property
    def platform(self) -> str:
        return self.chat.platform

    def now(self) -> float:
        return self.bot.clock()

    # ---------- Сайт ----------

    async def api(self, method: str, path: str, **kw: Any) -> Any:
        return await self.bot.site.request(
            method, path, token=self.chat.token, city=self.chat.city, chat=self.key, **kw
        )

    async def assistant(self, path: str, body: dict[str, Any], timeout: float | None = None) -> Any:
        """Запросы к помощнику подписаны секретом бота: сайт считает лимит по чату, а не по адресу бота."""
        async with self.bot.heavy:
            return await self.bot.site.request(
                "POST",
                path,
                token=self.chat.token,
                city=self.chat.city,
                chat=self.key,
                body=body,
                signed=True,
                timeout=timeout,
            )

    # ---------- Ответы ----------

    def url(self, path: str) -> str:
        return path if path.startswith("http") else f"{self.bot.config.public_site_url}{path}"

    def btn(self, label: str, name: str, **args: Any) -> Button:
        return Button(label=label, data=self.bot.store.put_button(self.key, {"a": name, **args}))

    def link(self, label: str, path: str) -> Button:
        return Button(label=label, url=self.url(path))

    async def send(self, msg: Message) -> str | None:
        return await self.bot.messenger.send(self.chat.chat_id, msg)

    async def say(self, text: str, buttons: list[list[Button]] | None = None, **kw: Any) -> str | None:
        return await self.send(Message(text=text, buttons=buttons or [], **kw))

    async def edit(self, ref: str | None, text: str, buttons: list[list[Button]] | None = None) -> None:
        if ref:
            await self.bot.messenger.edit(self.chat.chat_id, ref, Message(text=text, buttons=buttons or []))
        else:
            await self.say(text, buttons)

    @contextlib.asynccontextmanager
    async def typing(self) -> AsyncIterator[None]:
        """«Печатает…», пока бот ждёт ответ: индикатор гаснет через несколько секунд, повторяем каждые 4 с."""

        async def loop() -> None:
            while True:
                with contextlib.suppress(Exception):
                    await self.bot.messenger.typing(self.chat.chat_id)
                await asyncio.sleep(4)

        task = asyncio.create_task(loop())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    # ---------- Шаги сценария ----------

    def state(self) -> tuple[str | None, dict[str, Any]]:
        return self.bot.store.state(self.key)

    def set_state(self, flow: str, **data: Any) -> None:
        self.bot.store.set_state(self.key, flow, data)

    def clear_state(self) -> None:
        self.bot.store.clear_state(self.key)

    # ---------- Вход ----------

    async def link_code(self) -> str | None:
        """Код привязки из бота: действующий или новый с сайта."""
        for chat, code, expires in self.bot.store.codes():
            if chat == self.key and expires > time.time() + 60:
                return code
        res = await self.bot.site.pending(self.platform, self.chat.chat_id, self.chat.display_name)
        code = str(res.get("code") or "")
        if not code:
            return None
        expires = time.time() + 600
        if res.get("expiresAt"):
            with contextlib.suppress(ValueError):
                expires = fmt.parse_iso(res["expiresAt"]).timestamp()
        self.bot.store.put_code(self.key, code, expires)
        return code

    def login_buttons(self) -> list[list[Button]]:
        page = LINK_PAGE.format(platform=self.platform)
        return [
            [self.link(texts.B_LOGIN_SITE, page)],
            [self.link(texts.B_REGISTER, f"{page}&signup=1")],
        ]

    async def need_account(self, what: str) -> bool:
        """True — аккаунт подключён. Иначе объясняет, как подключить, и возвращает False."""
        if self.linked:
            return True
        await self.say(
            f"{texts.NEED_ACCOUNT.format(what=what)} {texts.NEED_ACCOUNT_HINT}", self.login_buttons()
        )
        return False
