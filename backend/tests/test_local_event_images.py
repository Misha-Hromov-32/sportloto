import copy

import pytest

from app.domain.lib.event_rules import valid_event_image
from tests.test_calendar_scaling import calendar_domain


@pytest.mark.parametrize("path", [
    "/media/covers/krasnoyarsk/run-123.webp", "/media/people/person-12.webp",
    "/img/u/1552674605-db6ffd4facb5.webp", "/demo/people/u-anna.jpg",
])
def test_local_asset_images_are_accepted(path):
    assert valid_event_image(path)


@pytest.mark.parametrize("path", [
    "//evil.test/photo.jpg", "/api/users/photo.jpg", "/img/../private.jpg",
    "/img/%2e%2e/private.jpg", "/media/covers/photo.svg", "/img/photo.jpg?next=evil",
    "/img/photo.jpg\n", "javascript:alert(1)",
])
def test_local_asset_images_cannot_escape_catalog(path):
    assert not valid_event_image(path)


def test_organizer_can_edit_event_with_existing_local_cover(calendar_domain):
    domain, database = calendar_domain
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    event["coverUrl"] = "/media/covers/running/photo-123.webp"
    patch = {key: copy.deepcopy(event[key]) for key in (
        "title", "description", "startsAt", "durationMin", "place", "level", "beginnersWelcome",
        "firstStep", "price", "cancelPolicy", "joinMode", "capacity", "minParticipants", "coverUrl",
    )}
    patch["title"] = "Пробежка по острову: обновлённое название"
    domain.update_event(domain.user("u-dmitry"), event["id"], patch)
    assert event["title"] == patch["title"]
    assert event["coverUrl"] == patch["coverUrl"]
