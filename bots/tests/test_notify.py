from datetime import UTC, datetime

from bots.core import notify

from .conftest import Harness


def note(nid: str, kind: str = "accepted", title: str = "Вас приняли") -> dict:
    return {
        "id": nid,
        "type": kind,
        "title": title,
        "text": "Волейбол в зале, Чт 19:30",
        "link": "/events/e-volley",
        "read": False,
        "createdAt": f"2030-10-20T10:00:0{nid[-1]}.000Z",
    }


def at_krasnoyarsk(hour: int) -> float:
    """Красноярск живёт на семь часов впереди UTC."""
    return datetime(2030, 10, 20, (hour - 7) % 24, 0, tzinfo=UTC).timestamp()


async def test_new_notifications_come_once_with_buttons(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.notifications = [note("n1"), note("n2", "application", "Новая заявка")]
    await notify.tick(h.bot)
    await notify.tick(h.bot)

    sent = [m for _, m, _ in h.msg.sent]
    assert [m.text.splitlines()[0] for m in sent] == ["🔔 Вас приняли", "🔔 Новая заявка"]
    assert [b.label for b in sent[0].buttons[0]] == ["Как добраться", "Отменить запись"]
    assert [b.label for b in sent[1].buttons[0]] == ["Разобрать"]
    call = h.site.find("GET", "/api/notifications")[0]
    assert call.query["filters"] == [{"field": "unread", "operator": "eq", "value": True}]
    assert not h.site.find("POST", r"/api/notifications.*")


async def test_buttons_by_type(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.notifications = [
        note("n1", "waitlist_offer", "Освободилось место"),
        note("n2", "reminder", "Напоминание"),
        note("n3", "changed", "Встреча изменилась"),
    ]
    await notify.tick(h.bot)
    labels = [[b.label for row in m.buttons for b in row] for _, m, _ in h.msg.sent]
    assert labels == [
        ["Подтвердить место", "Отказаться"],
        ["Как добраться", "Не смогу прийти"],
        ["Открыть"],
    ]
    await h.press("Подтвердить место")
    assert h.site.find("POST", "/api/events/e-volley/offer/accept")


async def test_important_only_mode(h: Harness):
    h.link()
    h.bot.store.update_chat("telegram:100", notify_mode="important")
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.notifications = [
        note("n1", "question", "Новый вопрос"),
        note("n2", "cancelled", "Встреча отменена"),
    ]
    await notify.tick(h.bot)
    assert [m.text.splitlines()[0] for _, m, _ in h.msg.sent] == ["🔔 Встреча отменена"]


async def test_quiet_hours_then_morning_summary(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(23)
    h.site.notifications = [note("n1"), note("n2", "application", "Новая заявка")]
    await notify.tick(h.bot)
    assert h.msg.sent == []

    h.bot.clock = lambda: at_krasnoyarsk(8)
    await notify.tick(h.bot)
    await notify.tick(h.bot)
    assert len(h.msg.sent) == 1
    summary = h.msg.last()
    assert summary.text.startswith("Пока были тихие часы, пришло уведомлений: 2.")
    assert "• Новая заявка" in summary.text
    assert [b.label for row in summary.buttons for b in row] == ["Разобрать", "Все уведомления"]


async def test_site_switch_off_wins(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.on("GET", r"/api/delivery/settings", (200, {"email": True, "browser": True, "messengers": "off"}))
    h.site.notifications = [note("n1"), note("n2", "cancelled", "Встреча отменена")]
    await notify.tick(h.bot)
    assert h.msg.sent == []
    assert h.site.find("GET", "/api/delivery/settings")[0].headers["Authorization"].startswith("Bearer stb_")


async def test_site_important_is_stricter_than_bot_all(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.on("GET", r"/api/delivery/settings", (200, {"messengers": "important"}))
    h.site.notifications = [note("n1", "question", "Новый вопрос"), note("n2", "accepted")]
    await notify.tick(h.bot)
    assert [m.text.splitlines()[0] for _, m, _ in h.msg.sent] == ["🔔 Вас приняли"]


async def test_many_new_become_one_summary(h: Harness):
    h.link()
    h.bot.clock = lambda: at_krasnoyarsk(12)
    h.site.notifications = [note(f"n{i}") for i in range(5)]
    await notify.tick(h.bot)
    assert len(h.msg.sent) == 1
    assert h.msg.last().text.startswith("Новых уведомлений: 5.")


async def test_old_unread_are_not_resent_after_linking(h: Harness):
    h.site.notifications = [note("n1"), note("n2")]
    await h.text("/start 123456")
    assert any(t.startswith("Непрочитанных уведомлений на сайте: 2") for t in h.msg.texts())
    before = len(h.msg.sent)
    await notify.tick(h.bot)
    assert len(h.msg.sent) == before


def test_strictest():
    assert notify.strictest("all", "important") == "important"
    assert notify.strictest("off", "all") == "off"
    assert notify.strictest("all", "что-то") == "all"
