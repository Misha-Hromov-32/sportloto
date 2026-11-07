import io
import random
from datetime import UTC, datetime

from PIL import Image

from bots.core import images

from .conftest import Harness


def noisy_photo(width: int = 2400, height: int = 1800) -> bytes:
    """Шумная картинка плохо сжимается: проверяем, что бот всё равно уложится в лимит сайта."""
    rnd = random.Random(7)
    img = Image.frombytes("RGB", (width, height), rnd.randbytes(width * height * 3))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


DRAFT = {
    "kind": "event",
    "draft": {
        "sportId": "s-football",
        "startsAt": "2030-10-26T04:00:00.000Z",
        "place": {"address": "Стадион «Енисей»", "districtId": "d-1", "lat": 56.03, "lng": 92.9},
        "capacity": 10,
        "price": {"kind": "free"},
        "joinMode": "open",
        "title": "Футбол на стадионе Енисей",
        "description": "Футбол в субботу в 11 на стадионе Енисей, 10 человек, бесплатно",
        "createdWithAssistant": True,
    },
    "filled": [],
    "missing": [],
    "newSport": None,
}


async def test_create_by_phrase_with_photo_and_publish_once(h: Harness):
    h.link()
    h.site.on("POST", r"/api/assistant/draft", (200, DRAFT))

    await h.text("/create футбол в субботу в 11 на стадионе Енисей, 10 человек, бесплатно")
    draft_call = h.site.find("POST", "/api/assistant/draft")[0]
    assert draft_call.body == {
        "kind": "event",
        "text": "футбол в субботу в 11 на стадионе Енисей, 10 человек, бесплатно",
    }
    assert any(
        t.startswith("Записал: футбол, Сб 26 октября, 11:00, Стадион «Енисей», 10 мест, бесплатно")
        for t in h.msg.texts()
    )
    assert h.msg.last().text == "Добавьте фото обложки или нажмите «Пропустить»."

    await h.photo(noisy_photo())
    preview = h.msg.last()
    assert preview.text.startswith("Так встречу увидят участники.")
    assert "⚽ Футбол на стадионе Енисей" in preview.text
    assert preview.photo_bytes

    await h.press("Опубликовать")
    await h.press("Опубликовать")

    posts = h.site.find("POST", "/api/events")
    assert len(posts) == 1
    body = posts[0].body
    assert len(body["idempotencyKey"]) == 32
    assert body["coverUrl"].startswith("data:image/jpeg;base64,")
    assert len(body["coverUrl"]) <= 160_000
    assert body["sportId"] == "s-football"
    assert body["startsAt"] == "2030-10-26T04:00:00.000Z"
    assert body["place"] == {"address": "Стадион «Енисей»", "districtId": "d-1", "lat": 56.03, "lng": 92.9}
    assert body["price"] == {"kind": "free"}
    assert body["capacity"] == 10
    assert body["cancelPolicy"] == {"kind": "anytime"}
    texts_ = h.msg.texts()
    assert any(t.startswith("Опубликовано: «Футбол на стадионе Енисей»") for t in texts_)
    assert texts_[-1] == "Эта встреча уже опубликована."


async def test_create_by_steps_asks_only_what_is_needed(h: Harness):
    h.link()
    h.bot.clock = lambda: datetime(2030, 10, 20, 5, 0, tzinfo=UTC).timestamp()
    await h.text("/create")
    await h.press("По шагам")
    assert h.msg.last().text.startswith("Каким видом спорта")
    await h.press("Волейбол")
    await h.press("Другая")
    await h.text("25.10")
    await h.text("19:30")
    await h.text("ул. Ленина, 1")
    await h.press("Без ограничения")
    await h.text("300")
    await h.press("По заявке")
    await h.press("Пропустить")
    await h.press("Изменить…")
    await h.press("Название")
    await h.text("Волейбол после работы")
    await h.press("Опубликовать")

    body = h.site.find("POST", "/api/events")[0].body
    assert body["sportId"] == "s-volley"
    assert body["startsAt"] == "2030-10-25T12:30:00.000Z"  # 19:30 по Красноярску
    assert body["capacity"] is None
    assert body["price"] == {"kind": "fixed", "amount": 300}
    assert body["joinMode"] == "approval"
    assert body["title"] == "Волейбол после работы"
    assert body["coverUrl"] is None


async def test_similar_sport_offers_choice(h: Harness):
    h.link()
    h.site.on(
        "POST",
        r"/api/assistant/draft",
        (200, {**DRAFT, "draft": {**DRAFT["draft"], "sportId": None, "newSportName": "Валейбол"}}),
    )

    def create(c):
        if c.body.get("sportId") or c.body.get("confirmNew"):
            return 200, {"id": "e-new", "title": c.body["title"]}
        return 409, {
            "code": "sport_similar",
            "message": "Похожее направление уже есть: Волейбол. Выберите его или подтвердите, что «Валейбол» — новое",
            "similar": [{"id": "s-volley", "name": "Волейбол"}],
        }

    h.site.on("POST", r"/api/events", create)
    await h.text("/create валейбол в субботу")
    await h.press("Пропустить")
    await h.press("Опубликовать")
    assert h.msg.last().text.startswith("Похожее направление уже есть")
    await h.press("Волейбол")
    posts = h.site.find("POST", "/api/events")
    assert posts[-1].body["sportId"] == "s-volley"
    assert posts[0].body["idempotencyKey"] == posts[-1].body["idempotencyKey"]


async def test_validation_errors_are_shown(h: Harness):
    h.link()
    h.site.on("POST", r"/api/assistant/draft", (200, DRAFT))
    h.site.on(
        "POST",
        r"/api/events",
        (
            422,
            {
                "code": "validation",
                "message": "Проверьте поля формы",
                "errors": {"title": "Название короче 5 букв"},
            },
        ),
    )
    await h.text("/create футбол")
    await h.press("Пропустить")
    await h.press("Опубликовать")
    assert h.msg.last().text == "Проверьте: Название короче 5 букв"


def test_compression_fits_site_limit():
    url = images.to_data_url(noisy_photo(3000, 2000))
    assert url.startswith("data:image/jpeg;base64,")
    assert len(url) <= 160_000
    img = Image.open(io.BytesIO(images.data_url_bytes(url)))
    assert max(img.size) <= 1280
