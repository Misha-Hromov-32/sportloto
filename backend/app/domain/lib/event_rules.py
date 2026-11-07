"""Общие правила события для экранов и сервера (порт frontend/src/lib/eventRules.ts и eventImages.ts)."""

import re
from typing import Any
from urllib.parse import unquote

from app.domain.types import Entity

MAX_IMAGE_LENGTH = 160_000

_HTTPS_RE = re.compile(r"^https://[^\s]+\Z", re.IGNORECASE)
_DATA_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,[a-z0-9+/]+=*\Z", re.IGNORECASE | re.ASCII)
_LOCAL_IMAGE_RE = re.compile(
    r"^/(?:media/(?:covers|people)|img|demo/people)/(?:[A-Za-z0-9_-]+/)*"
    r"[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)\Z", re.IGNORECASE | re.ASCII
)

ORG_EMBLEMS = ("ball", "peaks", "waves", "star", "stripes", "target")
MAX_EMBLEM_LENGTH = 4000
_EMBLEM_PREFIX = "data:image/svg+xml;utf8,"
_EMBLEM_URL_RE = re.compile(r"^data:image/svg\+xml;utf8,[A-Za-z0-9\-_.!~*'()%]+\Z")
_BAD_ESCAPE_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
_EMBLEM_SVG_RE = re.compile(
    r'^<svg xmlns="http://www\.w3\.org/2000/svg" viewBox="0 0 64 64" data-emblem="([a-z]+)"'
    r' data-tone="(accent|ink)">[\s\S]*</svg>\Z'
)
_EMBLEM_UNSAFE_RE = re.compile(
    r"<script|<foreignobject|<!|\son[a-z]+\s*=|href|javascript:|url\(|@import", re.IGNORECASE
)


def public_discussion(event: Entity) -> bool:
    """Свободная публичная встреча принимает вопросы до записи."""
    return event.get("joinMode") == "open" and event.get("visibility") != "invite"


def valid_event_image(value: Any) -> bool:
    """Фото из локального каталога, HTTPS или уменьшенный JPEG/PNG/WebP data URL."""
    if not isinstance(value, str) or len(value) > MAX_IMAGE_LENGTH:
        return False
    return bool(_LOCAL_IMAGE_RE.match(value) or _HTTPS_RE.match(value) or _DATA_RE.match(value))


def valid_org_logo(value: Any) -> bool:
    """Картинка как у события или готовый SVG-знак из формы организации (`emblemUrl` во фронтенде)."""
    if valid_event_image(value):
        return True
    if (
        not isinstance(value, str)
        or len(value) > MAX_EMBLEM_LENGTH
        or not _EMBLEM_URL_RE.match(value)
        or _BAD_ESCAPE_RE.search(value)
    ):
        return False
    try:
        svg = unquote(value[len(_EMBLEM_PREFIX) :], errors="strict")
    except UnicodeDecodeError:
        return False
    match = _EMBLEM_SVG_RE.match(svg)
    return bool(match and match.group(1) in ORG_EMBLEMS and not _EMBLEM_UNSAFE_RE.search(svg))
