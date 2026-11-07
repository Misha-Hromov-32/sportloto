from bots.core.flows import start

from .conftest import SECRET, TOKEN, Harness, event


async def test_start_with_code_links_account(h: Harness):
    await h.text("/start 123456")

    call = h.site.find("POST", "/api/bots/link")[0]
    assert call.headers["X-Bot-Secret"] == SECRET
    assert call.body == {
        "code": "123456",
        "platform": "telegram",
        "externalId": "100",
        "displayName": "@anna",
    }
    chat = h.bot.store.get_chat("telegram:100")
    assert chat.token == TOKEN
    assert chat.user_name == "Анна Соколова"
    assert any("Готово, Анна. Аккаунт подключён." in t for t in h.msg.texts())
    menu = next(m for _, m, _ in h.msg.sent if m.menu)
    assert ["Найти встречу", "На выходные"] in menu.menu


async def test_start_with_bad_code_shows_site_text(h: Harness):
    h.site.on(
        "POST",
        r"/api/bots/link",
        (410, {"code": "code_expired", "message": "Код устарел. Получите новый в боте"}),
    )
    await h.text("/start 999999")
    assert h.msg.last().text == "Код устарел. Получите новый в боте"
    assert h.bot.store.get_chat("telegram:100").token is None


async def test_reverse_code_links_when_entered_on_site(h: Harness):
    await h.text("/login")
    assert "123 456" in h.msg.last().text
    assert h.site.find("POST", "/api/bots/pending")[0].headers["X-Bot-Secret"] == SECRET

    h.site.on("GET", r"/api/bots/pending/123456", (200, {"status": "waiting"}))
    await start._watch_once(h.bot)
    assert h.bot.store.get_chat("telegram:100").token is None

    h.site.on(
        "GET",
        r"/api/bots/pending/123456",
        (200, {"status": "linked", "token": TOKEN, "user": {"id": "u-anna", "name": "Анна Соколова"}}),
    )
    await start._watch_once(h.bot)
    assert h.bot.store.get_chat("telegram:100").token == TOKEN
    assert any(t.startswith("Готово, Анна") for t in h.msg.texts())
    assert h.bot.store.codes() == []


async def test_guest_gets_connect_account_buttons(h: Harness):
    h.site.events["e-volley"] = event()
    await h.text("/event e-volley")
    await h.press("Записаться")

    msg = h.msg.last()
    assert msg.text.startswith("Чтобы записаться, подключите аккаунт сайта.")
    urls = [b.url for row in msg.buttons for b in row]
    assert urls == [
        "https://site.test/bots/link?platform=telegram",
        "https://site.test/bots/link?platform=telegram&signup=1",
    ]
    assert not h.site.find("POST", r"/api/events/.+/join")
    assert not h.site.find("POST", "/api/bots/pending")


async def test_six_digit_code_from_site_links_account(h: Harness):
    await h.text("123 456")
    call = h.site.find("POST", "/api/bots/link")[0]
    assert call.body["code"] == "123456"
    assert h.bot.store.get_chat("telegram:100").linked


async def test_six_digits_after_linking_go_to_assistant(h: Harness):
    h.link()
    await h.text("123456")
    assert not h.site.find("POST", "/api/bots/link")
    assert h.site.find("POST", "/api/assistant/chat")


async def test_logout_unlinks_both_sides(h: Harness):
    h.link()
    await h.text("/logout")
    call = h.site.find("POST", "/api/bots/unlink")[0]
    assert call.headers["Authorization"] == f"Bearer {TOKEN}"
    assert h.bot.store.get_chat("telegram:100").token is None
    assert "Аккаунт отключён" in h.msg.last().text


async def test_revoked_key_is_forgotten(h: Harness):
    h.link()
    h.site.on("GET", r"/api/events", (401, {"code": "auth_required", "message": "Войдите"}))
    await h.text("/today")
    assert h.bot.store.get_chat("telegram:100").token is None
    assert "Аккаунт отключён на сайте" in h.msg.last().text


async def test_site_down_message(h: Harness):
    h.site.on("GET", r"/api/events", (502, None))
    await h.text("/today")
    assert h.msg.last().text == "Сайт сейчас недоступен, попробуйте через минуту."
