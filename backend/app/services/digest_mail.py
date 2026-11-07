"""Письма «Подборка дня»: доменный тик ставит письмо в очередь, здесь оно уходит асинхронно.

Правила домена синхронные и выполняются в пуле потоков, а SMTP и модель помощника — долгие сетевые
вызовы. Поэтому тик и «Прислать сейчас» только отмечают подборку (`mail: "queued"`), а этот слой
забирает очередь (`digest.claim_mail`), пишет письмо и отмечает итог (`digest.finish_mail`).

Просыпается по живому обновлению «уведомления» (подборка всегда приходит уведомлением) и раз в минуту.
"""

import asyncio
import contextlib
import logging
from typing import Any
from urllib.parse import quote

import sqlalchemy as sa
from fastapi import FastAPI

from app.assistant import config as assistant_config
from app.assistant import engines
from app.domain.features import digest
from app.domain.schema import COLLECTIONS
from app.mail import OutgoingMail
from app.mail.digest import DEFAULT_INTRO, DigestCard, digest_mail
from app.services.realtime import PUBLIC_TOPIC

logger = logging.getLogger(__name__)

POLL_SECONDS = 60
INTRO_WAIT_SECONDS = 20
INTRO_MAX = 300
INTRO_MIN = 10

_INTRO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"intro": {"type": "string"}},
    "required": ["intro"],
    "additionalProperties": False,
}

_digests = COLLECTIONS["digests"].table
_HAS_QUEUE = sa.select(sa.literal(1)).where(_digests.c.mail.in_(("queued", "sending"))).limit(1)


def site_of(app: FastAPI) -> str:
    """Адрес для ссылок в письме: SITE_URL, иначе первый разрешённый адрес фронтенда."""
    settings = app.state.settings
    if settings.site_url:
        return settings.site_url
    origins = [o for o in settings.cors_origins if o.startswith("http")]
    return origins[0].rstrip("/") if origins else "http://localhost:5173"


def _instruction(name: str, titles: list[str]) -> str:
    first = name.split(" ", maxsplit=1)[0] if name else ""
    return (
        "Напиши короткое тёплое вступление к письму «Подборка дня» с совместными тренировками рядом с домом"
        + (f" для человека по имени {first}" if first else "")
        + f". В подборке: {'; '.join(titles)}. Одно-два простых предложения, не длиннее 200 знаков, на «вы». "
        "Без восклицательных знаков, без эмодзи, без слов «уважаемый» и «дорогой». "
        "Не придумывай подробностей о встречах и не повторяй их названия. "
        'Верни JSON: {"intro": "текст"}.'
    )


def _clean_intro(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip("\"'«» ")
    if not INTRO_MIN <= len(text) <= INTRO_MAX or "<" in text or "http" in text:
        return None
    return text


class DigestMailer:
    def __init__(self, app: FastAPI) -> None:
        self.app = app
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def _has_queue(self) -> bool:
        async with self.app.state.db.engine.connect() as connection:
            return (await connection.execute(_HAS_QUEUE)).first() is not None

    async def intro(self, config: dict[str, Any], name: str, titles: list[str]) -> str | None:
        """Вступление от помощника, если в админке включена модель. Любой сбой — None, тогда шаблон."""
        if not assistant_config.allows(config, "digest") or config.get("mode") == "builtin":
            return None
        try:
            answer = await engines.complete(
                config,
                self.app.state.settings,
                _instruction(name, titles),
                _INTRO_SCHEMA,
                wait=INTRO_WAIT_SECONDS,
            )
        except Exception as exc:  # noqa: BLE001  у письма всегда есть обычное вступление
            logger.info("Вступление к подборке без модели: %s", type(exc).__name__)
            return None
        return _clean_intro(answer.get("intro"))

    async def deliver_pending(self) -> int:
        """Отправить письма из очереди. Возвращает, сколько ушло."""
        async with self._lock:
            if not await self._has_queue():
                return 0
            domain = self.app.state.domain
            claimed, config = await domain.call(
                lambda: (digest.claim_mail(), assistant_config.read()), write=True
            )
            site = site_of(self.app)
            sent = 0
            for item in claimed:
                intro = await self.intro(config, item["name"], [c["title"] for c in item["items"]])
                cards = [
                    DigestCard(
                        title=c["title"],
                        when=c["when"],
                        where=c["where"],
                        reasons=c["reasons"],
                        link=f"{site}{c['path']}",
                    )
                    for c in item["items"]
                ]
                unsubscribe = f"{site}/digest/unsubscribe?token={quote(item['token'])}"
                rendered = digest_mail(item["name"], intro or DEFAULT_INTRO, cards, site, unsubscribe)
                ok = await self.app.state.mailer.send(
                    OutgoingMail(
                        to=item["to"],
                        subject=rendered.subject,
                        text=rendered.text,
                        html=rendered.html,
                        link=f"{site}/digest/{item['digestId']}",
                    )
                )
                sent += int(ok)
                await domain.call(
                    lambda i=item, good=ok, text=intro: digest.finish_mail(
                        i["digestId"], "sent" if good else "failed", text
                    ),
                    write=True,
                )
            return sent

    async def _safe_deliver(self) -> None:
        try:
            await self.deliver_pending()
        except Exception:
            logger.exception("Письма подборки дня не отправлены")

    async def _run(self) -> None:
        broker = self.app.state.broker
        while True:
            sub = broker.subscribe([PUBLIC_TOPIC]).subscription
            try:
                await self._safe_deliver()
                while not sub.closed:
                    try:
                        message = await asyncio.wait_for(sub.queue.get(), timeout=POLL_SECONDS)
                    except TimeoutError:
                        await self._safe_deliver()
                        continue
                    if message is None:
                        break
                    if message.data.get("channel") == "resources/notifications":
                        # Одно правило публикует изменения пачкой: даём ему закончить.
                        await asyncio.sleep(0.5)
                        await self._safe_deliver()
            finally:
                broker.unsubscribe(sub)
            await asyncio.sleep(POLL_SECONDS)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
