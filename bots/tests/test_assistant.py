from .conftest import SECRET, Harness, event


def chat_reply(**kw):
    reply = {
        "text": "Нашёл волейбол в субботу. Записать вас на первую?",
        "links": [{"label": "Все встречи", "to": "/events"}],
        "search": "волейбол в субботу",
        "action": None,
        "question": None,
        "options": ["Да, запиши", "Покажи ещё"],
        "match": {"items": [{"event": event(), "why": ["Любите волейбол"]}], "total": 1, "filters": {}},
        "engine": "bridge",
        "ms": 9000,
    }
    reply.update(kw)
    return reply


async def test_free_text_goes_to_assistant_with_history(h: Harness):
    h.site.on("POST", r"/api/assistant/chat", (200, chat_reply()))
    await h.text("хочу поиграть в волейбол в субботу")

    call = h.site.find("POST", "/api/assistant/chat")[0]
    assert call.body == {
        "messages": [{"role": "user", "text": "хочу поиграть в волейбол в субботу"}],
        "cityId": "krasnoyarsk",
        "page": "bot",
    }
    assert call.headers["X-Bot-Secret"] == SECRET
    assert call.headers["X-Bot-Chat"] == "telegram:100"
    answer = h.msg.sent[0][1]
    assert answer.text.startswith("Нашёл волейбол")
    labels = [b.label for row in answer.buttons for b in row]
    assert labels == ["Все встречи", "Да, запиши", "Покажи ещё"]
    assert answer.buttons[0][0].url == "https://site.test/events"
    assert h.msg.last().text.startswith("🏐 Волейбол в зале")

    h.site.on("POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[])))
    await h.press("Да, запиши")
    history = h.site.find("POST", "/api/assistant/chat")[-1].body["messages"]
    assert [m["role"] for m in history] == ["user", "assistant", "assistant", "user"]
    assert "[Показаны встречи: 1) id=e-volley «Волейбол в зале»]" in history[2]["text"]
    assert history[-1]["text"] == "Да, запиши"


async def test_history_keeps_last_twelve(h: Harness):
    h.site.on("POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[])))
    for i in range(10):
        await h.text(f"вопрос {i}")
    sent = h.site.find("POST", "/api/assistant/chat")[-1].body["messages"]
    assert len(sent) == 12
    assert sent[-1] == {"role": "user", "text": "вопрос 9"}


async def test_action_join_needs_confirmation(h: Harness):
    h.link()
    h.site.events["e-volley"] = event()
    action = {
        "type": "join_event",
        "summary": "Записаться на «Волейбол в зале»",
        "params": {"eventId": "e-volley"},
    }
    h.site.on(
        "POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[], action=action))
    )
    await h.text("запиши меня на волейбол")
    assert h.msg.last().text.startswith("Записаться на «Волейбол в зале»")
    assert not h.site.find("POST", r"/api/events/.+/join")

    await h.press("Подтвердить")
    call = h.site.find("POST", "/api/events/e-volley/join")[0]
    assert call.headers["Authorization"].startswith("Bearer stb_")
    assert h.msg.last().text.startswith("Вы записаны")


async def test_action_cancel_does_nothing(h: Harness):
    h.link()
    action = {"type": "leave_event", "summary": "Отменить запись", "params": {"eventId": "e-volley"}}
    h.site.on(
        "POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[], action=action))
    )
    await h.text("отмени запись")
    await h.press("Отмена")
    assert not h.site.find("POST", r"/api/events/.+/leave")
    assert h.msg.last().text == "Хорошо, не делаю."


async def test_guest_action_asks_to_connect(h: Harness):
    action = {"type": "favorite_event", "summary": "В избранное", "params": {"eventId": "e-volley"}}
    h.site.on(
        "POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[], action=action))
    )
    await h.text("сохрани встречу")
    assert "подключите аккаунт" in h.msg.last().text


async def test_action_create_event_publishes(h: Harness):
    h.link()
    action = {
        "type": "create_event",
        "summary": "Создать встречу «Футбол»",
        "params": {
            "sport": "футбол",
            "date": "2030-10-26",
            "time": "11:00",
            "address": "Стадион Енисей",
            "capacity": 10,
            "price": 0,
        },
    }
    h.site.on(
        "POST", r"/api/assistant/chat", (200, chat_reply(match=None, options=[], links=[], action=action))
    )
    await h.text("создай футбол в субботу в 11 на Енисее")
    assert "Вид спорта: футбол" in h.msg.last().text
    await h.press("Подтвердить")
    body = h.site.find("POST", "/api/events")[0].body
    assert body["sportId"] == "s-football"
    assert body["startsAt"] == "2030-10-26T04:00:00.000Z"
    assert body["capacity"] == 10
    assert body["idempotencyKey"]


async def test_without_model_bot_searches_itself(h: Harness):
    h.site.on(
        "POST",
        r"/api/assistant/match",
        (200, {"items": [{"event": event(), "why": []}], "total": 1, "reply": ""}),
    )
    await h.text("волейбол в субботу вечером")
    assert h.site.find("POST", "/api/assistant/chat")
    assert h.site.find("POST", "/api/assistant/match")[0].body["text"] == "волейбол в субботу вечером"
    assert h.msg.last().text.startswith("🏐 Волейбол в зале")


async def test_without_model_join_first_card(h: Harness):
    h.link()
    h.site.events["e-volley"] = event()
    h.site.on(
        "POST",
        r"/api/assistant/match",
        (200, {"items": [{"event": event(), "why": []}], "total": 1, "reply": ""}),
    )
    await h.text("волейбол в субботу")
    await h.text("запиши на первую")
    assert h.msg.last().text.startswith("Записать вас на «Волейбол в зале»")


async def test_without_model_help_by_keywords(h: Harness):
    await h.text("как отменить запись?")
    assert h.msg.last().text.startswith("Отменить запись: «Мои записи»")
    assert not h.site.find("POST", "/api/assistant/match")


async def test_timeout_falls_back(h: Harness):
    def slow(_c):
        import httpx

        raise httpx.ReadTimeout("долго")

    h.site.on("POST", r"/api/assistant/chat", slow)
    await h.text("как подключить аккаунт?")
    assert "/login" in h.msg.last().text


async def test_rate_limit_text(h: Harness):
    h.site.on(
        "POST",
        r"/api/assistant/chat",
        (429, {"code": "rate_limit", "message": "Слишком много вопросов подряд. Подождите минуту"}),
    )
    await h.text("привет")
    assert h.msg.last().text == "Слишком много вопросов подряд. Подождите минуту"
