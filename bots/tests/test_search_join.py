from .conftest import SECRET, Harness, event


def match_result(n: int, total: int) -> dict:
    return {
        "filters": {"sportIds": ["s-volley"], "when": "weekend"},
        "understood": ["волейбол"],
        "reply": "Нашёл встречи по волейболу на выходных.",
        "items": [
            {"event": event(f"e-{i}", title=f"Волейбол {i}"), "why": ["Любите волейбол"]} for i in range(n)
        ],
        "total": total,
        "questions": [],
        "widen": [],
        "joined": [],
        "companion": None,
    }


async def test_find_sends_three_cards_and_more(h: Harness):
    h.site.on("POST", r"/api/assistant/match", (200, match_result(3, 5)))
    for i in range(5):
        h.site.events[f"e-{i}"] = event(f"e-{i}", title=f"Волейбол {i}")

    await h.text("/find волейбол на выходных")

    call = h.site.find("POST", "/api/assistant/match")[0]
    assert call.body == {"text": "волейбол на выходных", "cityId": "krasnoyarsk", "steps": []}
    assert call.headers["X-Bot-Secret"] == SECRET
    assert call.headers["X-Bot-Chat"] == "telegram:100"
    cards = [m for _, m, _ in h.msg.sent if m.text.startswith("🏐")]
    assert len(cards) == 3
    assert "Почему вам подходит: любите волейбол" in cards[0].text
    assert "👥 7 из 12 · свободно 5 · свободная запись" in cards[0].text
    labels = [b.label for row in cards[0].buttons for b in row]
    assert labels == ["Записаться", "♥", "Подробнее", "Открыть на сайте"]
    assert h.msg.last().text.startswith("Нашлось: 5")

    await h.press("Ещё")
    listing = h.site.find("GET", "/api/events")[-1]
    fields = {f["field"] for f in listing.query["filters"]}
    assert {"sportIds", "when", "place.lat"} <= fields
    new_cards = [m for _, m, _ in h.msg.sent if m.text.startswith("🏐")]
    assert [c.text.splitlines()[0] for c in new_cards[3:]] == ["🏐 Волейбол 3", "🏐 Волейбол 4"]


async def test_find_without_assistant_falls_back_to_text_search(h: Harness):
    h.site.on(
        "POST",
        r"/api/assistant/match",
        (503, {"code": "assistant_unavailable", "message": "Помощник недоступен", "fallback": {"q": "йога"}}),
    )
    h.site.events["e-yoga"] = event("e-yoga", title="Йога в парке")
    await h.text("/find хочу на йогу")
    assert h.site.find("POST", "/api/assistant/search")
    assert any(t.startswith("🏐 Йога в парке") for t in h.msg.texts())


async def test_join_open_event(h: Harness):
    h.link()
    h.site.events["e-volley"] = event()
    await h.text("/event e-volley")
    await h.press("Записаться")
    assert h.msg.last().text.startswith("Записать вас на «Волейбол в зале»")
    await h.press("Да")

    call = h.site.find("POST", "/api/events/e-volley/join")[0]
    assert call.body == {"checkConflicts": True}
    assert call.headers["Authorization"].startswith("Bearer stb_")
    assert call.headers["X-City"] == "krasnoyarsk"
    assert h.msg.last().text.startswith("Вы записаны на «Волейбол в зале»")


async def test_join_approval_asks_message_for_organizer(h: Harness):
    h.link()
    h.site.events["e-volley"] = event(joinMode="approval")
    await h.text("/event e-volley")
    await h.press("Записаться")
    assert "Напишите пару слов о себе" in h.msg.last().text
    await h.text("Играю 3 года, могу взять свой мяч")

    call = h.site.find("POST", "/api/events/e-volley/join")[0]
    assert call.body == {"note": "Играю 3 года, могу взять свой мяч", "checkConflicts": True}
    assert h.msg.last().text.startswith("Заявка на «Волейбол в зале» отправлена")


async def test_join_approval_without_message(h: Harness):
    h.link()
    h.site.events["e-volley"] = event(joinMode="approval")
    await h.text("/event e-volley")
    await h.press("Записаться")
    await h.press("Без сообщения")
    assert h.site.find("POST", "/api/events/e-volley/join")[0].body == {"checkConflicts": True}


async def test_time_conflict_then_join_anyway(h: Harness):
    h.link()
    h.site.events["e-volley"] = event()
    calls = []

    def join(c):
        calls.append(c.body)
        if c.body.get("checkConflicts"):
            return 409, {
                "code": "time_conflict",
                "message": "В это время у вас другая встреча",
                "conflicts": [
                    {"eventId": "e-run", "title": "Пробежка", "startsAt": "2030-10-24T12:00:00.000Z"}
                ],
            }
        return 200, {**event(), "my": {"status": "confirmed"}}

    h.site.on("POST", r"/api/events/e-volley/join", join)
    await h.text("/event e-volley")
    await h.press("Записаться")
    await h.press("Да")
    assert "В это время у вас уже есть:\n• «Пробежка»" in h.msg.last().text
    await h.press("Всё равно записаться")
    assert calls == [{"checkConflicts": True}, {}]
    assert h.msg.last().text.startswith("Вы записаны")


async def test_full_event_offers_waitlist(h: Harness):
    h.link()
    h.site.events["e-volley"] = event(counts={"confirmed": 12, "spotsLeft": 0})
    await h.text("/event e-volley")
    await h.press("Записаться")
    assert "Встать в лист ожидания?" in h.msg.last().text
    await h.press("Встать в очередь")
    assert h.msg.last().text.startswith("Мест нет, вы в листе ожидания, место 2")


async def test_stop_list_error_shows_site_text(h: Harness):
    h.link()
    h.site.events["e-volley"] = event()
    text = "Организатор ограничил вашу запись на свои встречи. Причина: пропуски. До 20 ноября."
    h.site.on("POST", r"/api/events/e-volley/join", (409, {"code": "organizer_blocked", "message": text}))
    await h.text("/event e-volley")
    await h.press("Записаться")
    await h.press("Да")
    assert h.msg.last().text == text


async def test_blocked_card_shows_reason_without_join_button(h: Harness):
    h.link()
    reason = "Организатор ограничил вашу запись на свои встречи"
    h.site.events["e-volley"] = event(can={"join": False, "joinReason": reason, "leave": False})
    await h.text("/event e-volley")
    card = h.msg.last()
    assert f"Записаться нельзя: {reason}" in card.text
    assert "Записаться" not in [b.label for row in card.buttons for b in row]


async def test_details_sends_first_step_and_point(h: Harness):
    h.site.events["e-volley"] = event()
    await h.text("/event e-volley")
    await h.press("Подробнее")
    msg = h.msg.last()
    assert "Что взять: Сменная обувь" in msg.text
    assert msg.location is not None
    assert msg.location.lat == 56.01


async def test_cover_data_url_goes_as_photo(h: Harness):
    h.site.events["e-volley"] = event(coverUrl="data:image/jpeg;base64,/9j/AAAA")
    await h.text("/event e-volley")
    assert h.msg.last().photo_bytes == b"\xff\xd8\xff\x00\x00\x00"
