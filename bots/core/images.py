"""Фото из мессенджера → обложка для сайта: не больше 1280 px, JPEG, data URL до 160 000 символов."""

import base64
import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_DATA_URL = 160_000
MAX_SIDE = 1280
PREFIX = "data:image/jpeg;base64,"


class BadImageError(ValueError):
    pass


def _encode(img: Image.Image, quality: int) -> str:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return PREFIX + base64.b64encode(buf.getvalue()).decode()


def to_data_url(raw: bytes, limit: int = MAX_DATA_URL) -> str:
    """Уменьшает картинку, пока data URL не станет короче `limit`: сначала качество, потом размер."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise BadImageError("не картинка") from exc
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    while True:
        for quality in (85, 75, 65, 55, 45):
            url = _encode(img, quality)
            if len(url) <= limit:
                return url
        if min(img.size) < 64:
            raise BadImageError("слишком большая картинка")
        img = img.resize((max(1, int(img.width * 0.8)), max(1, int(img.height * 0.8))))


def data_url_bytes(url: str) -> bytes | None:
    if not url.startswith("data:image/") or ";base64," not in url:
        return None
    try:
        return base64.b64decode(url.split(";base64,", 1)[1])
    except ValueError:
        return None
