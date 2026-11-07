"""Telegram Bot API через httpx: long polling, текст, фото, точка на карте, кнопки и меню."""

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

import httpx

from bots.core import texts
from bots.core.render import Incoming, Message, Unreachable

if TYPE_CHECKING:
    from bots.core.engine import Bot

log = logging.getLogger(__name__)

API = "https://api.telegram.org"
CAPTION_LIMIT = 1024
TEXT_LIMIT = 4096
LOCATION_LABEL = "📍 Отправить местоположение"


class TelegramError(Exception):
    def __init__(self, method: str, code: int, description: str) -> None:
        super().__init__(f"{method}: {code} {description}")
        self.code = code
        self.description = description


class TelegramMessenger:
    platform = "telegram"
    can_request_location = True

    def __init__(
        self, token: str, *, proxy: str | None = None, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.base = f"{API}/bot{token}"
        self.file_base = f"{API}/file/bot{token}"
        self.http = httpx.AsyncClient(
            proxy=proxy or None, transport=transport, timeout=httpx.Timeout(70.0, connect=15.0)
        )

    async def close(self) -> None:
        await self.http.aclose()

    async def call(
        self, method: str, data: dict[str, Any] | None = None, files: dict[str, Any] | None = None
    ) -> Any:
        for attempt in range(2):
            try:
                if files:
                    form = {
                        k: v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
                        for k, v in (data or {}).items()
                    }
                    r = await self.http.post(f"{self.base}/{method}", data=form, files=files)
                else:
                    r = await self.http.post(f"{self.base}/{method}", json=data or {})
            except httpx.HTTPError as exc:
                # В адресе запроса ключ бота: в текст ошибки адрес не попадает.
                raise TelegramError(method, 0, type(exc).__name__) from None
            try:
                body = r.json()
            except ValueError:
                raise TelegramError(method, r.status_code, "не JSON") from None
            if body.get("ok"):
                return body.get("result")
            code = int(body.get("error_code") or r.status_code)
            description = str(body.get("description") or "")
            if code == 429 and attempt == 0:
                await asyncio.sleep(float((body.get("parameters") or {}).get("retry_after") or 1))
                continue
            if code == 403:
                raise Unreachable(description)
            raise TelegramError(method, code, description)
        raise TelegramError(method, 429, "слишком много запросов")

    # ---------- Клавиатуры ----------

    @staticmethod
    def markup(msg: Message) -> dict[str, Any] | None:
        if msg.request_location:
            return {
                "keyboard": [
                    [{"text": LOCATION_LABEL, "request_location": True}],
                    [{"text": texts.B_CANCEL}],
                ],
                "resize_keyboard": True,
                "one_time_keyboard": True,
            }
        if msg.menu:
            return {
                "keyboard": [[{"text": t} for t in row] for row in msg.menu],
                "resize_keyboard": True,
                "is_persistent": True,
            }
        if msg.buttons:
            return {
                "inline_keyboard": [
                    [
                        {"text": b.label, "url": b.url}
                        if b.url
                        else {"text": b.label, "callback_data": f"b:{b.data}"}
                        for b in row
                    ]
                    for row in msg.buttons
                    if row
                ]
            }
        return None

    # ---------- Отправка ----------

    async def _photo(
        self, chat_id: str, msg: Message, caption: str | None, markup: dict[str, Any] | None
    ) -> Any:
        data: dict[str, Any] = {"chat_id": chat_id}
        if caption:
            data["caption"] = caption
        if markup:
            data["reply_markup"] = markup
        if msg.photo_bytes:
            return await self.call(
                "sendPhoto", data, files={"photo": ("cover.jpg", msg.photo_bytes, "image/jpeg")}
            )
        return await self.call("sendPhoto", {**data, "photo": msg.photo_url})

    async def send(self, chat_id: str, msg: Message) -> str | None:
        markup = self.markup(msg)
        text = msg.text[:TEXT_LIMIT]
        ref = None
        text_sent = False
        if msg.photo_bytes or msg.photo_url:
            fits = len(text) <= CAPTION_LIMIT
            try:
                res = await self._photo(chat_id, msg, text if fits else None, markup if fits else None)
                if fits:
                    ref, text_sent = res.get("message_id"), True
            except TelegramError as exc:
                log.warning("фото не отправлено: %s", exc.code)
        if not text_sent:
            data: dict[str, Any] = {
                "chat_id": chat_id,
                "text": text,
                "link_preview_options": {"is_disabled": True},
            }
            if markup:
                data["reply_markup"] = markup
            res = await self.call("sendMessage", data)
            ref = res.get("message_id")
        if msg.location:
            loc = msg.location
            await self.call(
                "sendVenue",
                {
                    "chat_id": chat_id,
                    "latitude": loc.lat,
                    "longitude": loc.lng,
                    "title": loc.title or "Место встречи",
                    "address": loc.address or " ",
                },
            )
        return str(ref) if ref is not None else None

    async def edit(self, chat_id: str, ref: str, msg: Message) -> None:
        markup = self.markup(msg) or {"inline_keyboard": []}
        data = {"chat_id": chat_id, "message_id": int(ref), "reply_markup": markup}
        try:
            await self.call("editMessageText", {**data, "text": msg.text[:TEXT_LIMIT]})
        except TelegramError as exc:
            if "not modified" in exc.description:
                return
            if "no text" in exc.description:
                await self.call("editMessageCaption", {**data, "caption": msg.text[:CAPTION_LIMIT]})
                return
            raise

    async def answer(self, callback: Any, text: str | None = None) -> None:
        if callback:
            await self.call(
                "answerCallbackQuery", {"callback_query_id": callback, **({"text": text} if text else {})}
            )

    async def typing(self, chat_id: str) -> None:
        await self.call("sendChatAction", {"chat_id": chat_id, "action": "typing"})

    async def download(self, photo: Any) -> bytes:
        info = await self.call("getFile", {"file_id": photo})
        try:
            r = await self.http.get(f"{self.file_base}/{info['file_path']}")
        except httpx.HTTPError:
            raise TelegramError("getFile", 0, "не скачалось") from None
        r.raise_for_status()
        return r.content

    async def set_commands(self) -> None:
        await self.call(
            "setMyCommands", {"commands": [{"command": c, "description": d} for c, d in texts.COMMANDS]}
        )

    # ---------- Приём ----------

    @staticmethod
    def parse(update: dict[str, Any]) -> Incoming | None:
        cb = update.get("callback_query")
        if cb:
            message = cb.get("message") or {}
            chat = message.get("chat") or {}
            data = str(cb.get("data") or "")
            if not data.startswith("b:") or chat.get("type") != "private":
                return None
            return Incoming(
                chat_id=str(chat["id"]),
                user_id=str((cb.get("from") or {}).get("id") or chat["id"]),
                name=display_name(cb.get("from") or {}),
                kind="button",
                data=data[2:],
                callback=cb.get("id"),
                message=str(message.get("message_id")) if message.get("message_id") else None,
            )
        message = update.get("message")
        if not message:
            return None
        chat = message.get("chat") or {}
        if chat.get("type") != "private":
            return None
        base = {
            "chat_id": str(chat["id"]),
            "user_id": str((message.get("from") or {}).get("id") or chat["id"]),
            "name": display_name(message.get("from") or {}),
        }
        if message.get("location"):
            loc = message["location"]
            return Incoming(**base, kind="location", lat=loc["latitude"], lng=loc["longitude"])
        if message.get("photo"):
            return Incoming(**base, kind="photo", photo=message["photo"][-1]["file_id"])
        doc = message.get("document") or {}
        if str(doc.get("mime_type") or "").startswith("image/"):
            return Incoming(**base, kind="photo", photo=doc["file_id"])
        text = message.get("text")
        if text:
            if text == LOCATION_LABEL:
                return None
            return Incoming(**base, kind="text", text=text)
        return None

    async def run(self, bot: "Bot") -> None:
        offset = 0
        delay = 1.0
        while True:
            try:
                updates = await self.call(
                    "getUpdates",
                    {"offset": offset, "timeout": 50, "allowed_updates": ["message", "callback_query"]},
                )
                delay = 1.0
            except (TelegramError, Unreachable) as exc:
                log.warning("Telegram недоступен (%s), повтор через %.0f с", type(exc).__name__, delay)
                await asyncio.sleep(delay)
                delay = min(60.0, delay * 2)
                continue
            for update in updates or []:
                offset = max(offset, int(update["update_id"]) + 1)
                inc = self.parse(update)
                if inc is not None:
                    bot.spawn(bot.handle(inc))


def display_name(user: dict[str, Any]) -> str:
    if user.get("username"):
        return f"@{user['username']}"
    return " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x) or "Telegram"
