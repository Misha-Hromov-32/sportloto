"""Альбом «Как это было».

Организатор начавшейся или прошедшей встречи сохраняет до четырёх фото с подписями.
Альбом заменяется целиком, пустой список убирает фотографии.
"""

from typing import Any

from app.domain.errors import fail
from app.domain.features.participation_host import ParticipationHost, input_text
from app.domain.lib.event_rules import valid_event_image
from app.domain.types import ID, Actor, Entity


def save_event_photos(host: ParticipationHost, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы добавить фото")
    event = host.event(id_)
    if event is None:
        fail("not_found", "Встреча не найдена")
    if not host.is_organizer(user, event):
        fail("forbidden", "Фото встречи добавляет её организатор")
    if host.event_state(event) not in ("past", "live"):
        fail("bad_state", "Фото «Как это было» можно добавить, когда встреча началась или завершилась")
    raw_photos = input_.get("photos")
    if not isinstance(raw_photos, list) or len(raw_photos) > 4:
        fail("validation", "В альбоме можно сохранить до четырёх фото")
    photos: list[Entity] = []
    for i, raw in enumerate(raw_photos):
        if not isinstance(raw, dict) or not valid_event_image(raw.get("url")):
            fail("validation", "Выберите корректное фото")
        photos.append(
            {
                "id": f"{event['id']}-photo-{i + 1}",
                "url": raw["url"],
                "caption": input_text(raw.get("caption")).strip()[:180],
            }
        )
    event["photos"] = photos
    host.commit(["events"], [id_])
    return host.event_details(user, id_)
