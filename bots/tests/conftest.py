"""Подменённый сайт (httpx.MockTransport) и мессенджер для проверки сценариев бота."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from bots.core.config import Config
from bots.core.engine import Bot
from bots.core.flows import start
from bots.core.render import Button, Incoming, Message
from bots.core.site_client import SiteClient
from bots.core.store import Store

SITE = "https://site.test"
SECRET = "bot-secret-123456"
TOKEN = "stb_test_token_abcdef"


def event(eid: str = "e-volley", **kw: Any) -> dict[str, Any]:
    e = {
        "id": eid,
        "title": kw.pop("title", "Волейбол в зале"),
        "sport": {"id": "s-volley", "name": "Волейбол"},
        "startsAt": kw.pop("startsAt", "2030-10-24T12:30:00.000Z"),
        "durationMin": 90,
        "place": {"address": "ул. Лады Кецховели, 22", "lat": 56.01, "lng": 92.85, "landmark": ""},
        "capacity": 12,
        "counts": {"confirmed": 7, "pending": 0, "waitlist": 0, "spotsLeft": 5, "toThreshold": None},
        "joinMode": "open",
        "price": {"kind": "fixed", "amount": 300},
        "level": "amateur",
        "organizerView": {"name": "Дмитрий Орлов"},
        "matchReasons": [],
        "state": "upcoming",
        "my": None,
        "isOrganizer": False,
        "can": {"join": True, "joinReason": "", "leave": False, "ask": True},
        "coverUrl": None,
        "favorite": False,
        "firstStep": {"bring": "Сменная обувь", "howToFind": "Вход со двора"},
        "description": "Играем смешанными командами.",
    }
    e.update(kw)
    return e


@dataclass
class Call:
    method: str
    path: str
    query: dict[str, Any]
    body: Any
    headers: httpx.Headers


Responder = Callable[[Call], tuple[int, Any]]


@dataclass
class FakeSite:
    events: dict[str, dict[str, Any]] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)
    routes: list[tuple[str, re.Pattern[str], Responder]] = field(default_factory=list)
    notifications: list[dict[str, Any]] = field(default_factory=list)
    pending: list[dict[str, Any]] = field(default_factory=list)
    sports: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"id": "s-football", "name": "Футбол", "popular": True, "synonyms": []},
            {"id": "s-volley", "name": "Волейбол", "popular": True, "synonyms": []},
            {"id": "s-run", "name": "Бег", "popular": True, "synonyms": ["пробежка"]},
        ]
    )

    def on(self, method: str, pattern: str, responder: Responder | tuple[int, Any]) -> None:
        fn = responder if callable(responder) else (lambda _c, r=responder: r)
        self.routes.insert(0, (method, re.compile(f"^{pattern}$"), fn))

    def find(self, method: str, path: str) -> list[Call]:
        return [c for c in self.calls if c.method == method and re.fullmatch(path, c.path)]

    def defaults(self) -> None:
        def events_list(c: Call) -> tuple[int, Any]:
            filters = c.query.get("filters") or []
            scope = next((f["value"] for f in filters if f["field"] == "scope"), "feed")
            rows = list(self.events.values())
            if scope == "participating":
                rows = [e for e in rows if e.get("my")]
            elif scope == "organizing":
                rows = [e for e in rows if e.get("isOrganizer")]
            return 200, {"data": rows, "total": len(rows)}

        def get_event(c: Call) -> tuple[int, Any]:
            eid = c.path.split("/")[3]
            if eid in self.events:
                return 200, self.events[eid]
            return 404, {"code": "not_found", "message": "Встреча не найдена"}

        def join(c: Call) -> tuple[int, Any]:
            e = dict(self.events[c.path.split("/")[3]])
            status = "pending" if e["joinMode"] == "approval" else "confirmed"
            pos = None
            if e["counts"].get("spotsLeft") == 0:
                status, pos = "waitlist", 2
            e["my"] = {"id": "p-1", "status": status, "waitlistPosition": pos}
            return 200, e

        def participations(c: Call) -> tuple[int, Any]:
            return 200, {"data": self.pending, "total": len(self.pending)}

        def notifications(c: Call) -> tuple[int, Any]:
            return 200, {"data": self.notifications, "total": len(self.notifications)}

        self.on("GET", r"/api/events", events_list)
        self.on("GET", r"/api/events/[^/]+", get_event)
        self.on("POST", r"/api/events/[^/]+/join", join)
        self.on("POST", r"/api/events/[^/]+/leave", (200, {"lateCancel": False}))
        self.on("PUT", r"/api/events/[^/]+/favorite", (200, {"ok": True}))
        self.on("GET", r"/api/participations", participations)
        self.on("POST", r"/api/participations/[^/]+/decide", (200, {"ok": True}))
        self.on("GET", r"/api/notifications", notifications)
        self.on("GET", r"/api/delivery/settings", (404, None))
        self.on("GET", r"/api/sports", lambda _c: (200, {"data": self.sports, "total": len(self.sports)}))
        self.on("GET", r"/api/me", (200, {"id": "u-anna", "name": "Анна Соколова", "city": "Красноярск"}))
        self.on(
            "POST",
            r"/api/bots/link",
            (200, {"token": TOKEN, "user": {"id": "u-anna", "name": "Анна Соколова"}}),
        )
        self.on("POST", r"/api/bots/pending", (200, {"code": "123456", "expiresAt": "2099-01-01T00:00:00Z"}))
        self.on("POST", r"/api/bots/unlink", (204, None))
        self.on(
            "POST", r"/api/assistant/chat", (503, {"code": "assistant_unavailable", "message": "Нет модели"})
        )
        self.on(
            "POST",
            r"/api/assistant/search",
            lambda c: (200, {"filters": {}, "chips": [], "rest": c.body.get("text", "")}),
        )
        self.on(
            "POST",
            r"/api/events",
            lambda c: (200, {**event("e-new", title=c.body.get("title", "")), "isOrganizer": True}),
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        for k in ("filters", "sorters", "pagination"):
            if k in query:
                query[k] = json.loads(query[k])
        body = json.loads(request.content) if request.content else None
        call = Call(request.method, url.path, query, body, request.headers)
        self.calls.append(call)
        for method, pattern, fn in self.routes:
            if method == request.method and pattern.match(url.path):
                status, payload = fn(call)
                if payload is None:
                    return httpx.Response(status)
                return httpx.Response(status, json=payload)
        return httpx.Response(404, json={"code": "not_found", "message": "Нет такого адреса"})


class FakeMessenger:
    can_request_location = True

    def __init__(self, platform: str = "telegram") -> None:
        self.platform = platform
        self.sent: list[tuple[str, Message, str]] = []
        self.edits: list[tuple[str, str, Message]] = []
        self.answers: list[Any] = []
        self.typings = 0
        self.photos: dict[str, bytes] = {}
        self._n = 0

    async def send(self, chat_id: str, msg: Message) -> str | None:
        self._n += 1
        self.sent.append((chat_id, msg, str(self._n)))
        return str(self._n)

    async def edit(self, chat_id: str, ref: str, msg: Message) -> None:
        self.edits.append((chat_id, ref, msg))

    async def answer(self, callback: Any, text: str | None = None) -> None:
        self.answers.append(callback)

    async def typing(self, chat_id: str) -> None:
        self.typings += 1

    async def download(self, photo: Any) -> bytes:
        return self.photos[str(photo)]

    # ---------- Помощники тестов ----------

    def texts(self) -> list[str]:
        return [m.text for _, m, _ in self.sent]

    def last(self) -> Message:
        return self.sent[-1][1]

    def find_button(self, label: str) -> tuple[Button, str]:
        for _, msg, ref in reversed(self.sent):
            for row in msg.buttons:
                for b in row:
                    if b.label == label:
                        return b, ref
        for _, ref, msg in reversed(self.edits):
            for row in msg.buttons:
                for b in row:
                    if b.label == label:
                        return b, ref
        raise AssertionError(f"нет кнопки «{label}»")


class Harness:
    def __init__(self, bot: Bot, site: FakeSite, tg: FakeMessenger) -> None:
        self.bot, self.site, self.msg = bot, site, tg
        self.chat = "100"

    async def text(self, text: str) -> None:
        await self.bot.handle(
            Incoming(chat_id=self.chat, user_id=self.chat, name="@anna", kind="text", text=text)
        )

    async def press(self, label: str) -> None:
        button, ref = self.msg.find_button(label)
        assert button.data, f"«{label}» — ссылка, а не кнопка"
        await self.bot.handle(
            Incoming(
                chat_id=self.chat,
                user_id=self.chat,
                name="@anna",
                kind="button",
                data=button.data,
                callback="cb",
                message=ref,
            )
        )

    async def photo(self, raw: bytes) -> None:
        self.msg.photos["ph"] = raw
        await self.bot.handle(
            Incoming(chat_id=self.chat, user_id=self.chat, name="@anna", kind="photo", photo="ph")
        )

    def link(self) -> None:
        chat = self.bot.store.chat("telegram", self.chat, "@anna")
        self.bot.store.set_link(chat.key, TOKEN, "u-anna", "Анна Соколова")


@pytest.fixture
def site() -> FakeSite:
    s = FakeSite()
    s.defaults()
    return s


@pytest.fixture
async def h(site: FakeSite) -> Harness:
    cfg = Config(
        platform="telegram", site_url=SITE, public_site_url=SITE, bot_secret=SECRET, undo_seconds=0.05
    )
    client = SiteClient(SITE, SECRET, transport=httpx.MockTransport(site.handler))
    messenger = FakeMessenger()
    bot = Bot(cfg, messenger, Store(":memory:"), client)
    start.CODE_PAUSE = 0
    yield Harness(bot, site, messenger)
    await client.close()
