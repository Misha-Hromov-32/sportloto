"""VK API сообщества через httpx: Bots Long Poll, сообщения с клавиатурой, callback-кнопки, загрузка фото."""

import asyncio
import hashlib
import json
import logging
import secrets
from typing import TYPE_CHECKING, Any

import httpx

from bots.core.render import Incoming, Message, Unreachable

if TYPE_CHECKING:
    from bots.core.engine import Bot
    from bots.core.store import Store

log = logging.getLogger(__name__)

API = "https://api.vk.com/method"
VERSION = "5.199"
TEXT_LIMIT = 4096
LABEL_LIMIT = 40
INLINE_ROWS, INLINE_BUTTONS = 6, 10
GROUP_CHATS = 2_000_000_000


class VkError(Exception):
    def __init__(self, method: str, code: int, message: str) -> None:
        super().__init__(f"{method}: {code} {message}")
        self.code = code


def _pack_inline(rows: list[list[dict[str, Any]]]) -> list[list[dict[str, Any]]]:
    """У встроенной клавиатуры VK не больше 6 рядов и 10 кнопок: лишнее переукладываем по две в ряд."""
    rows = [r for r in rows if r]
    if len(rows) <= INLINE_ROWS and sum(len(r) for r in rows) <= INLINE_BUTTONS:
        return rows
    flat = [b for r in rows for b in r][:INLINE_BUTTONS]
    return [flat[i : i + 2] for i in range(0, len(flat), 2)][:INLINE_ROWS]


class VkMessenger:
    platform = "vk"
    can_request_location = False

    def __init__(
        self,
        token: str,
        group_id: str,
        *,
        store: "Store | None" = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.token = token
        self.group_id = str(group_id)
        self.store = store
        self.http = httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(40.0, connect=15.0))
        self._names: dict[str, str] = {}

    async def close(self) -> None:
        await self.http.aclose()

    async def call(self, method: str, **params: Any) -> Any:
        data = {
            k: v if isinstance(v, str | int | float) else json.dumps(v, ensure_ascii=False)
            for k, v in params.items()
            if v is not None
        }
        data.update(access_token=self.token, v=VERSION)
        for attempt in range(3):
            try:
                r = await self.http.post(f"{API}/{method}", data=data)
                body = r.json()
            except (httpx.HTTPError, ValueError):
                raise VkError(method, 0, "нет ответа") from None
            error = body.get("error")
            if not error:
                return body.get("response")
            code = int(error.get("error_code") or 0)
            if code in {6, 9, 10} and attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            if code in {900, 901, 902}:
                raise Unreachable(str(code))
            raise VkError(method, code, str(error.get("error_msg") or ""))
        raise VkError(method, 6, "слишком много запросов")

    # ---------- Клавиатуры ----------

    @staticmethod
    def keyboard(msg: Message) -> str | None:
        if msg.menu:
            return json.dumps(
                {
                    "one_time": False,
                    "buttons": [
                        [
                            {
                                "action": {"type": "text", "label": t[:LABEL_LIMIT]},
                                "color": "primary" if i == 0 else "secondary",
                            }
                            for t in row
                        ]
                        for i, row in enumerate(msg.menu)
                    ],
                },
                ensure_ascii=False,
            )
        if msg.buttons:
            rows = [
                [
                    {"action": {"type": "open_link", "link": b.url, "label": b.label[:LABEL_LIMIT]}}
                    if b.url
                    else {
                        "action": {
                            "type": "callback",
                            "label": b.label[:LABEL_LIMIT],
                            "payload": json.dumps({"b": b.data}),
                        }
                    }
                    for b in row
                ]
                for row in msg.buttons
            ]
            return json.dumps({"inline": True, "buttons": _pack_inline(rows)}, ensure_ascii=False)
        return None

    # ---------- Фото ----------

    async def _fetch(self, url: str) -> bytes:
        try:
            r = await self.http.get(url)
            r.raise_for_status()
        except httpx.HTTPError:
            raise VkError("download", 0, "картинка не скачалась") from None
        return r.content

    async def upload_photo(self, peer_id: str, msg: Message) -> str:
        raw = msg.photo_bytes or await self._fetch(msg.photo_url or "")
        digest = hashlib.sha256(raw).hexdigest()
        if self.store:
            cached = self.store.media(digest)
            if cached:
                return cached
        server = await self.call("photos.getMessagesUploadServer", peer_id=peer_id)
        try:
            r = await self.http.post(server["upload_url"], files={"photo": ("cover.jpg", raw, "image/jpeg")})
            up = r.json()
        except (httpx.HTTPError, ValueError):
            raise VkError("upload", 0, "фото не загрузилось") from None
        saved = await self.call(
            "photos.saveMessagesPhoto", server=up["server"], photo=up["photo"], hash=up["hash"]
        )
        p = saved[0]
        attachment = f"photo{p['owner_id']}_{p['id']}" + (
            f"_{p['access_key']}" if p.get("access_key") else ""
        )
        if self.store:
            self.store.put_media(digest, attachment)
        return attachment

    # ---------- Отправка ----------

    async def send(self, chat_id: str, msg: Message) -> str | None:
        params: dict[str, Any] = {
            "peer_ids": chat_id,
            "random_id": secrets.randbelow(2**31),
            "message": msg.text[:TEXT_LIMIT],
            "dont_parse_links": 1,
        }
        kb = self.keyboard(msg)
        if kb:
            params["keyboard"] = kb
        if msg.photo_bytes or msg.photo_url:
            try:
                params["attachment"] = await self.upload_photo(chat_id, msg)
            except VkError as exc:
                log.warning("фото не загружено: %s", exc.code)
        if msg.location:
            params["lat"], params["long"] = msg.location.lat, msg.location.lng
        res = await self.call("messages.send", **params)
        if isinstance(res, list) and res:
            item = res[0]
            if item.get("error"):
                code = int((item["error"] or {}).get("code") or 0)
                if code in {900, 901, 902}:
                    raise Unreachable(str(code))
                raise VkError("messages.send", code, "")
            return str(item.get("conversation_message_id"))
        return None

    async def edit(self, chat_id: str, ref: str, msg: Message) -> None:
        await self.call(
            "messages.edit",
            peer_id=chat_id,
            conversation_message_id=ref,
            message=msg.text[:TEXT_LIMIT],
            keyboard=self.keyboard(msg) or json.dumps({"inline": True, "buttons": []}),
            dont_parse_links=1,
        )

    async def answer(self, callback: Any, text: str | None = None) -> None:
        if not callback:
            return
        params = dict(callback)
        if text:
            params["event_data"] = json.dumps(
                {"type": "show_snackbar", "text": text[:90]}, ensure_ascii=False
            )
        await self.call("messages.sendMessageEventAnswer", **params)

    async def typing(self, chat_id: str) -> None:
        await self.call("messages.setActivity", peer_id=chat_id, type="typing", group_id=self.group_id)

    async def download(self, photo: Any) -> bytes:
        return await self._fetch(str(photo))

    async def name(self, user_id: str) -> str:
        if user_id not in self._names:
            try:
                users = await self.call("users.get", user_ids=user_id)
                u = users[0] if users else {}
                self._names[user_id] = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x)
            except (VkError, Unreachable):
                return ""
        return self._names[user_id]

    # ---------- Приём ----------

    @staticmethod
    def parse(update: dict[str, Any]) -> Incoming | None:
        kind = update.get("type")
        obj = update.get("object") or {}
        if kind == "message_new":
            m = obj.get("message") or {}
            peer = int(m.get("peer_id") or 0)
            if not peer or peer >= GROUP_CHATS or int(m.get("from_id") or 0) <= 0:
                return None
            base = {"chat_id": str(peer), "user_id": str(m.get("from_id")), "name": ""}
            payload: dict[str, Any] = {}
            if m.get("payload"):
                try:
                    payload = json.loads(m["payload"])
                except (TypeError, ValueError):
                    payload = {}
            if m.get("ref"):
                return Incoming(**base, kind="start", ref=str(m["ref"]))
            if isinstance(payload, dict) and payload.get("command") == "start":
                return Incoming(**base, kind="start", ref="")
            geo = (m.get("geo") or {}).get("coordinates")
            if geo:
                return Incoming(**base, kind="location", lat=geo["latitude"], lng=geo["longitude"])
            for att in m.get("attachments") or []:
                if att.get("type") == "photo":
                    sizes = (att.get("photo") or {}).get("sizes") or []
                    if sizes:
                        best = max(sizes, key=lambda s: (s.get("width") or 0) * (s.get("height") or 0))
                        return Incoming(**base, kind="photo", photo=best["url"])
            if m.get("text"):
                return Incoming(**base, kind="text", text=str(m["text"]))
            return None
        if kind == "message_event":
            payload = obj.get("payload") or {}
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except ValueError:
                    payload = {}
            if not isinstance(payload, dict) or not payload.get("b"):
                return None
            peer = str(obj.get("peer_id"))
            return Incoming(
                chat_id=peer,
                user_id=str(obj.get("user_id")),
                name="",
                kind="button",
                data=str(payload["b"]),
                callback={
                    "event_id": obj.get("event_id"),
                    "user_id": obj.get("user_id"),
                    "peer_id": obj.get("peer_id"),
                },
                message=str(obj["conversation_message_id"]) if obj.get("conversation_message_id") else None,
            )
        if kind in {"message_allow", "message_deny"}:
            uid = str(obj.get("user_id") or "")
            if not uid:
                return None
            return Incoming(
                chat_id=uid, user_id=uid, name="", kind="allow" if kind == "message_allow" else "deny"
            )
        return None

    async def _server(self) -> dict[str, Any]:
        return await self.call("groups.getLongPollServer", group_id=self.group_id)

    async def run(self, bot: "Bot") -> None:
        delay = 1.0
        lp: dict[str, Any] | None = None
        while True:
            try:
                if lp is None:
                    lp = await self._server()
                r = await self.http.get(
                    lp["server"], params={"act": "a_check", "key": lp["key"], "ts": lp["ts"], "wait": 25}
                )
                body = r.json()
                delay = 1.0
            except (VkError, Unreachable, httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                log.warning("VK недоступен (%s), повтор через %.0f с", type(exc).__name__, delay)
                lp = None
                await asyncio.sleep(delay)
                delay = min(60.0, delay * 2)
                continue
            failed = body.get("failed")
            if failed == 1:
                lp["ts"] = body.get("ts", lp["ts"])
                continue
            if failed:
                lp = None
                continue
            lp["ts"] = body.get("ts", lp["ts"])
            for update in body.get("updates") or []:
                inc = self.parse(update)
                if inc is None:
                    continue
                if inc.kind not in {"allow", "deny"}:
                    inc.name = await self.name(inc.user_id)
                bot.spawn(bot.handle(inc))
