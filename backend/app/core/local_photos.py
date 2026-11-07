"""Фото демо-данных отдаются с нашего сервера, а не с фотобанка.

Обложки встреч, клубов и фото людей в демо-данных и импорте записаны адресами Unsplash. Их копии лежат
в `frontend/public/img/u/<id>.webp` (список — `local_photos.txt`), и ответы API подменяют адрес фотобанка
на свой. Базу и сиды менять не нужно: подмена срабатывает на выходе, и для старых, и для новых записей.
Фото без локальной копии остаются как есть.
"""

import re
from pathlib import Path

from starlette.types import ASGIApp, Message, Receive, Scope, Send

LOCAL_IDS = frozenset(
    line.strip()
    for line in (Path(__file__).with_name("local_photos.txt")).read_text("utf-8").splitlines()
    if line.strip()
)

# Адрес кончается на кавычке, пробеле или угловой скобке: так он записан и в JSON, и в HTML.
_UNSPLASH = re.compile(rb"https://images\.unsplash\.com/photo-(\d{9,13}-[0-9a-f]{12})(?:\?[^\"'\s<>\\]*)?")
_REWRITTEN_TYPES = (b"application/json", b"text/html")


def _local(match: re.Match[bytes]) -> bytes:
    photo_id = match.group(1).decode()
    return f"/img/u/{photo_id}.webp".encode() if photo_id in LOCAL_IDS else match.group(0)


def localize(body: bytes) -> bytes:
    return _UNSPLASH.sub(_local, body) if b"images.unsplash.com" in body else body


class LocalPhotosMiddleware:
    """Подменяет адреса фотобанка в ответах JSON и HTML; потоковые ответы (SSE) проходят без изменений."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start: Message | None = None
        chunks: list[bytes] = []

        async def wrapped(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                if headers.get(b"content-type", b"").startswith(_REWRITTEN_TYPES):
                    start = message
                    return
                await send(message)
                return
            if start is None or message["type"] != "http.response.body":
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = localize(b"".join(chunks))
            headers = [(k, v) for k, v in start.get("headers", []) if k != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped)
