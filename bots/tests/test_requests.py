import asyncio

from .conftest import Harness


def application(pid: str = "p-1", seats_left: int | None = 5, **kw):
    return {
        "id": pid,
        "status": "pending",
        "note": "Играю 3 года, могу взять свой мяч",
        "createdAt": "2030-10-20T10:00:00.000Z",
        "user": {"id": "u-2", "name": "Анна Соколова", "age": 34, "level": "amateur"},
        "event": {
            "id": "e-volley",
            "title": "Волейбол в зале",
            "startsAt": "2030-10-22T12:30:00.000Z",
            "capacity": 12,
            "confirmedCount": 7,
            "seatsLeft": seats_left,
            "joinMode": "approval",
            "sport": {"id": "s-volley", "name": "Волейбол"},
            "coverUrl": None,
        },
        "seats": 1,
        "attended": 7,
        "firstVisit": False,
        **kw,
    }


async def wait_undo(h: Harness) -> None:
    await asyncio.sleep(h.bot.config.undo_seconds * 3)


async def test_request_card_and_accept_after_undo_window(h: Harness):
    h.link()
    h.site.pending = [application()]
    await h.text("/requests")
    card = h.msg.last()
    assert card.text.splitlines()[:3] == [
        "Анна Соколова, 34 года · любитель",
        "Встреч на платформе: 7",
        "«Играю 3 года, могу взять свой мяч»",
    ]
    assert "Волейбол в зале" in card.text
    assert "свободно 5 из 12" in card.text
    assert [b.label for b in card.buttons[0]] == ["Принять", "Отклонить", "Позже"]

    await h.press("Принять")
    assert h.msg.edits[-1][2].text == "Анна: заявка принята"
    assert [b.label for b in h.msg.edits[-1][2].buttons[0]] == ["Вернуть"]
    assert not h.site.find("POST", r"/api/participations/p-1/decide")

    h.site.pending = []
    await wait_undo(h)
    call = h.site.find("POST", r"/api/participations/p-1/decide")[0]
    assert call.body == {"decision": "accept"}
    assert h.msg.edits[-1][2].text == "Анна: заявка принята"
    assert h.msg.edits[-1][2].buttons == []
    assert h.msg.last().text == "Новых заявок нет."


async def test_undo_cancels_decision(h: Harness):
    h.link()
    h.site.pending = [application()]
    await h.text("/requests")
    await h.press("Принять")
    await h.press("Вернуть")
    await wait_undo(h)
    assert not h.site.find("POST", r"/api/participations/p-1/decide")
    assert h.msg.edits[-1][2].text.startswith("Решение отменено.")
    assert "Принять" in [b.label for b in h.msg.edits[-1][2].buttons[0]]


async def test_reject_with_template_and_own_words(h: Harness):
    h.link()
    h.site.pending = [application("p-1"), application("p-2")]
    await h.text("/requests")
    await h.press("Отклонить")
    assert h.msg.edits[-1][2].text == "Почему отклоняете? Причину увидит Анна."
    await h.press("Уровень пока не подходит")
    h.site.pending = [application("p-2")]
    await wait_undo(h)
    assert h.site.find("POST", r"/api/participations/p-1/decide")[0].body == {
        "decision": "reject",
        "reason": "Уровень пока не подходит",
    }

    await h.press("Отклонить")
    await h.press("Своими словами")
    await h.text("Набираем только опытных")
    await wait_undo(h)
    assert h.site.find("POST", r"/api/participations/p-2/decide")[0].body == {
        "decision": "reject",
        "reason": "Набираем только опытных",
    }


async def test_full_and_already_decided_show_site_text(h: Harness):
    h.link()
    h.site.pending = [application()]
    h.site.on(
        "POST",
        r"/api/participations/p-1/decide",
        (409, {"code": "full", "message": "Мест не осталось. Увеличьте лимит или откажите"}),
    )
    await h.text("/requests")
    await h.press("Принять")
    await wait_undo(h)
    assert any(m.text == "Мест не осталось. Увеличьте лимит или откажите" for _, _, m in h.msg.edits)

    h.site.on(
        "POST",
        r"/api/participations/p-1/decide",
        (409, {"code": "already_decided", "message": "Заявку уже рассмотрели"}),
    )
    await h.text("/requests")
    await h.press("Отклонить")
    await h.press("Без причины")
    await wait_undo(h)
    assert any(m.text == "Заявку уже рассмотрели" for _, _, m in h.msg.edits)


async def test_no_seats_hides_accept(h: Harness):
    h.link()
    h.site.pending = [application(seats_left=0)]
    await h.text("/requests")
    card = h.msg.last()
    assert [b.label for b in card.buttons[0]] == ["Отклонить", "Позже"]
    assert "Не хватает мест — откройте встречу на сайте, чтобы увеличить лимит." in card.text
    assert card.buttons[1][0].url == "https://site.test/events/e-volley/manage"


async def test_later_skips_and_show_again(h: Harness):
    h.link()
    h.site.pending = [application()]
    await h.text("/requests")
    await h.press("Позже")
    assert h.msg.last().text == "Остальные заявки вы отложили."
    await h.press("Показать снова")
    assert h.msg.last().text.startswith("Анна Соколова")


async def test_menu_shows_requests_count(h: Harness):
    h.link()
    h.site.pending = [application("p-1"), application("p-2"), application("p-3")]
    await h.text("/start")
    menu = h.msg.last().menu
    assert ["Заявки (3)", "Помощь"] in menu
    await h.text("Заявки (3)")
    assert h.msg.last().text.startswith("Анна Соколова")
