import json
from urllib.parse import parse_qs

import httpx

from bots.core.render import Button, Location, Message
from bots.core.store import Store
from bots.telegram.adapter import TelegramMessenger
from bots.vk.adapter import VkMessenger


class Recorder:
    def __init__(self, responses: dict[str, object]) -> None:
        self.responses = responses
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        for key, value in self.responses.items():
            if str(request.url).endswith(key) or key in str(request.url):
                return httpx.Response(200, json=value)
        return httpx.Response(404, json={"ok": False, "error_code": 404, "description": "нет"})

    def method(self, name: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.endswith(f"/{name}")]


# ---------- Telegram ----------


def tg(responses: dict[str, object]) -> tuple[TelegramMessenger, Recorder]:
    rec = Recorder(responses)
    return TelegramMessenger("123:SECRET", transport=httpx.MockTransport(rec)), rec


async def test_telegram_inline_buttons_and_venue():
    bot, rec = tg(
        {"sendMessage": {"ok": True, "result": {"message_id": 5}}, "sendVenue": {"ok": True, "result": {}}}
    )
    msg = Message(
        text="Карточка",
        buttons=[
            [Button("Записаться", data="abcdef123456"), Button("Открыть на сайте", url="https://site.test/e")]
        ],
        location=Location(56.0, 92.8, "Волейбол", "ул. Ленина, 1"),
    )
    ref = await bot.send("42", msg)
    assert ref == "5"
    body = json.loads(rec.method("sendMessage")[0].content)
    keyboard = body["reply_markup"]["inline_keyboard"]
    assert keyboard == [
        [
            {"text": "Записаться", "callback_data": "b:abcdef123456"},
            {"text": "Открыть на сайте", "url": "https://site.test/e"},
        ]
    ]
    assert len(keyboard[0][0]["callback_data"].encode()) <= 64
    venue = json.loads(rec.method("sendVenue")[0].content)
    assert venue["latitude"] == 56.0
    assert venue["address"] == "ул. Ленина, 1"
    assert rec.requests[0].url.path == "/bot123:SECRET/sendMessage"


async def test_telegram_menu_location_and_photo():
    bot, rec = tg(
        {
            "sendMessage": {"ok": True, "result": {"message_id": 1}},
            "sendPhoto": {"ok": True, "result": {"message_id": 2}},
        }
    )
    await bot.send("42", Message(text="Меню", menu=[["Найти встречу", "На выходные"]]))
    menu = json.loads(rec.method("sendMessage")[0].content)["reply_markup"]
    assert menu["keyboard"] == [[{"text": "Найти встречу"}, {"text": "На выходные"}]]
    assert menu["is_persistent"] is True

    await bot.send("42", Message(text="Где вы?", request_location=True))
    loc = json.loads(rec.method("sendMessage")[1].content)["reply_markup"]
    assert loc["keyboard"][0][0]["request_location"] is True

    ref = await bot.send(
        "42", Message(text="С фото", photo_bytes=b"\xff\xd8jpeg", buttons=[[Button("Да", data="x1")]])
    )
    assert ref == "2"
    photo = rec.method("sendPhoto")[0]
    assert photo.headers["content-type"].startswith("multipart/form-data")
    assert b'name="caption"' in photo.content
    assert b"\xff\xd8jpeg" in photo.content
    assert b"b:x1" in photo.content


async def test_telegram_edit_answer_and_commands():
    bot, rec = tg(
        {
            "editMessageText": {"ok": True, "result": True},
            "answerCallbackQuery": {"ok": True, "result": True},
            "setMyCommands": {"ok": True, "result": True},
        }
    )
    await bot.edit("42", "7", Message(text="Анна: заявка принята"))
    edit = json.loads(rec.method("editMessageText")[0].content)
    assert edit == {
        "chat_id": "42",
        "message_id": 7,
        "reply_markup": {"inline_keyboard": []},
        "text": "Анна: заявка принята",
    }
    await bot.answer("cb-1")
    assert json.loads(rec.method("answerCallbackQuery")[0].content) == {"callback_query_id": "cb-1"}
    await bot.set_commands()
    commands = json.loads(rec.method("setMyCommands")[0].content)["commands"]
    assert {"command": "find", "description": "Подобрать встречу по фразе"} in commands


def test_telegram_parse_updates():
    cb = TelegramMessenger.parse(
        {
            "update_id": 1,
            "callback_query": {
                "id": "cb",
                "from": {"id": 42, "username": "anna_run"},
                "data": "b:abc",
                "message": {"message_id": 9, "chat": {"id": 42, "type": "private"}},
            },
        }
    )
    assert (cb.kind, cb.data, cb.callback, cb.message, cb.name) == ("button", "abc", "cb", "9", "@anna_run")
    start = TelegramMessenger.parse(
        {
            "update_id": 2,
            "message": {
                "chat": {"id": 42, "type": "private"},
                "from": {"id": 42, "first_name": "Анна"},
                "text": "/start 123456",
            },
        }
    )
    assert (start.kind, start.text, start.name) == ("text", "/start 123456", "Анна")
    photo = TelegramMessenger.parse(
        {
            "update_id": 3,
            "message": {
                "chat": {"id": 42, "type": "private"},
                "photo": [{"file_id": "small"}, {"file_id": "big"}],
            },
        }
    )
    assert (photo.kind, photo.photo) == ("photo", "big")
    group = TelegramMessenger.parse(
        {"update_id": 4, "message": {"chat": {"id": -1, "type": "group"}, "text": "hi"}}
    )
    assert group is None


async def test_telegram_blocked_user_is_unreachable():
    import pytest

    from bots.core.render import Unreachable

    rec = Recorder({})

    def blocked(request: httpx.Request) -> httpx.Response:
        rec.requests.append(request)
        return httpx.Response(
            403,
            json={"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"},
        )

    bot = TelegramMessenger("123:SECRET", transport=httpx.MockTransport(blocked))
    with pytest.raises(Unreachable):
        await bot.send("42", Message(text="Привет"))


# ---------- VK ----------


def form(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


async def test_vk_send_with_inline_keyboard_and_photo_upload():
    rec = Recorder(
        {
            "photos.getMessagesUploadServer": {"response": {"upload_url": "https://pu.vk.test/upload"}},
            "pu.vk.test/upload": {"server": 1, "photo": "[]", "hash": "h"},
            "photos.saveMessagesPhoto": {"response": [{"id": 77, "owner_id": -242415813, "access_key": "k"}]},
            "messages.send": {"response": [{"peer_id": 42, "message_id": 0, "conversation_message_id": 15}]},
        }
    )
    store = Store(":memory:")
    vk = VkMessenger("VKTOKEN", "242415813", store=store, transport=httpx.MockTransport(rec))
    msg = Message(
        text="Карточка",
        buttons=[[Button("Записаться", data="abc"), Button("Открыть на сайте", url="https://site.test/e")]],
        photo_bytes=b"\xff\xd8jpeg",
        location=Location(56.0, 92.8, "Волейбол", "ул. Ленина, 1"),
    )
    ref = await vk.send("42", msg)
    assert ref == "15"
    send = form(rec.method("messages.send")[0])
    assert send["access_token"] == "VKTOKEN"
    assert send["v"] == "5.199"
    assert send["peer_ids"] == "42"
    assert send["attachment"] == "photo-242415813_77_k"
    assert (send["lat"], send["long"]) == ("56.0", "92.8")
    kb = json.loads(send["keyboard"])
    assert kb["inline"] is True
    assert kb["buttons"][0][0]["action"] == {
        "type": "callback",
        "label": "Записаться",
        "payload": '{"b": "abc"}',
    }
    assert kb["buttons"][0][1]["action"]["type"] == "open_link"
    upload = next(r for r in rec.requests if r.url.host == "pu.vk.test")
    assert b"\xff\xd8jpeg" in upload.content
    assert form(rec.method("photos.saveMessagesPhoto")[0])["hash"] == "h"

    await vk.send("42", msg)
    assert len(rec.method("photos.getMessagesUploadServer")) == 1  # загруженное фото переиспользуется


async def test_vk_menu_answer_edit_and_inline_limits():
    rec = Recorder(
        {
            "messages.send": {"response": [{"peer_id": 42, "conversation_message_id": 3}]},
            "messages.sendMessageEventAnswer": {"response": 1},
            "messages.edit": {"response": 1},
            "messages.setActivity": {"response": 1},
        }
    )
    vk = VkMessenger("VKTOKEN", "242415813", transport=httpx.MockTransport(rec))
    await vk.send("42", Message(text="Меню", menu=[["Найти встречу", "На выходные"], ["Помощь"]]))
    kb = json.loads(form(rec.method("messages.send")[0])["keyboard"])
    assert kb["one_time"] is False
    assert kb["buttons"][1][0]["action"] == {"type": "text", "label": "Помощь"}

    many = [[Button(f"Причина {i}", data=str(i))] for i in range(8)]
    await vk.send("42", Message(text="Почему?", buttons=many))
    kb = json.loads(form(rec.method("messages.send")[1])["keyboard"])
    assert len(kb["buttons"]) <= 6
    assert sum(len(r) for r in kb["buttons"]) <= 10

    await vk.answer({"event_id": "ev", "user_id": 42, "peer_id": 42})
    assert form(rec.method("messages.sendMessageEventAnswer")[0])["event_id"] == "ev"
    await vk.edit("42", "3", Message(text="Анна: заявка принята"))
    edit = form(rec.method("messages.edit")[0])
    assert edit["conversation_message_id"] == "3"
    assert json.loads(edit["keyboard"]) == {"inline": True, "buttons": []}
    await vk.typing("42")
    assert form(rec.method("messages.setActivity")[0])["type"] == "typing"


def test_vk_parse_updates():
    ref = VkMessenger.parse(
        {
            "type": "message_new",
            "object": {"message": {"peer_id": 42, "from_id": 42, "text": "Начать", "ref": "123456"}},
        }
    )
    assert (ref.kind, ref.ref) == ("start", "123456")
    event = VkMessenger.parse(
        {
            "type": "message_event",
            "object": {
                "user_id": 42,
                "peer_id": 42,
                "event_id": "ev",
                "payload": {"b": "abc"},
                "conversation_message_id": 15,
            },
        }
    )
    assert (event.kind, event.data, event.message) == ("button", "abc", "15")
    assert event.callback == {"event_id": "ev", "user_id": 42, "peer_id": 42}
    photo = VkMessenger.parse(
        {
            "type": "message_new",
            "object": {
                "message": {
                    "peer_id": 42,
                    "from_id": 42,
                    "attachments": [
                        {
                            "type": "photo",
                            "photo": {
                                "sizes": [
                                    {"url": "s", "width": 10, "height": 10},
                                    {"url": "b", "width": 900, "height": 600},
                                ]
                            },
                        }
                    ],
                }
            },
        }
    )
    assert (photo.kind, photo.photo) == ("photo", "b")
    allow = VkMessenger.parse({"type": "message_allow", "object": {"user_id": 42}})
    assert allow.kind == "allow"
    chat = VkMessenger.parse(
        {"type": "message_new", "object": {"message": {"peer_id": 2000000001, "from_id": 42, "text": "x"}}}
    )
    assert chat is None


async def test_vk_cannot_write_marks_unreachable():
    import pytest

    from bots.core.render import Unreachable

    rec = Recorder({"messages.send": {"error": {"error_code": 901, "error_msg": "Can't send messages"}}})
    vk = VkMessenger("VKTOKEN", "242415813", transport=httpx.MockTransport(rec))
    with pytest.raises(Unreachable):
        await vk.send("42", Message(text="Привет"))
