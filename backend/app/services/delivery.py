"""Уведомления сайта на почту и в браузер (Web Push) по каналам, которые включил человек.

Источник — записи `notifications` доменных правил (то, что под колокольчиком). Доставка идёт в фоне
по образцу письма «Подборка дня» (app/services/digest_mail.py): просыпается по живому обновлению
«уведомления» и раз в минуту, отправляет асинхронно и отмечает итог в журнале `delivery_log`.
Пара (уведомление, канал) обрабатывается один раз: повторный проход её не отправит.

Защита от потока писем: при первом запуске всё накопленное и любые «старые» уведомления
(старше 15 минут или из будущего, например после сброса или сдвига дат демо-данных) отмечаются
`baseline` без отправки. Уходят только свежие.

Мессенджеры сюда не входят: боты Telegram и VK сами забирают непрочитанные уведомления ключом
человека и читают его выбор (`messengers`) из настроек.
"""

import asyncio
import contextlib
import logging
import re
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.db.models import (
    DeliveryChannel,
    DeliveryPrefs,
    DeliveryStatus,
    MessengersMode,
    PushSubscription,
    User,
)
from app.db.repositories.delivery import DeliveryRepository, LogRow, Notice, Recipient
from app.domain import clock
from app.domain.lib.cities import city_by_name, default_city
from app.domain.lib.dates import format_event_date
from app.mail import OutgoingMail
from app.mail.notification import SETTINGS_PATH, notification_mail
from app.services.email_policy import TEST_ZONES, email_domain
from app.services.realtime import PUBLIC_TOPIC
from app.services.webpush import PushMessage, PushOutcome, PushSender, PushTarget

logger = logging.getLogger(__name__)

FRESH_FOR = timedelta(minutes=15)
# Часы правил и сервера могут чуть расходиться: уведомление «из будущего» на минуту ещё свежее.
CLOCK_SKEW = timedelta(minutes=1)
MAX_ATTEMPTS = 3
BATCH = 500
FALLBACK_LINK = "/notifications"

# Зоны, где почтовых ящиков не бывает: демо-аккаунты и служебные домены для проверок.
NO_MAIL_ZONES = frozenset({"demo", *TEST_ZONES})

DEFAULTS = {"email": True, "browser": False, "messengers": MessengersMode.ALL.value}

TEST_TITLE = "Проверка уведомлений"
TEST_TEXT = "Так будут приходить уведомления «Спорт и точка». Выбрать, куда их присылать, можно в настройках."
TEST_LIMIT = 5
TEST_WINDOW_SECONDS = 600

_DATE_TOKEN = re.compile(r"\{\{date:([^}]+)\}\}")


class TestResult(StrEnum):
    SENT = "sent"
    OFF = "off"
    FAILED = "failed"
    UNAVAILABLE = "unavailable"


def can_receive_mail(address: str) -> bool:
    domain = email_domain(address) if address else None
    return domain is not None and domain.rsplit(".", 1)[-1] not in NO_MAIL_ZONES


def mail_target(recipient: Recipient | None) -> str | None:
    """Адрес, на который можно писать: настоящий, подтверждённый, аккаунт активен."""
    if recipient is None or not recipient.is_active or not recipient.email_verified:
        return None
    address = recipient.email.strip()
    return address if can_receive_mail(address) else None


def prefs_of(prefs: DeliveryPrefs | None) -> dict[str, Any]:
    if prefs is None:
        return dict(DEFAULTS)
    return {"email": prefs.email, "browser": prefs.browser, "messengers": prefs.messengers}


def domain_now() -> datetime:
    """Время по часам доменных правил: с ним сравнивается `createdAt` уведомлений."""
    return clock.now()


def render_text(text: str, city: str) -> str:
    """Даты в текстах уведомлений хранятся метками `{{date:…}}` — как под колокольчиком, в поясе города."""
    if "{{date:" not in text:
        return text
    zone = (city_by_name(city) or default_city())["timeZone"]

    def label(match: re.Match[str]) -> str:
        at = clock.parse(match.group(1))
        return format_event_date(at, now) if at is not None else match.group(1)

    with clock.zone(zone):
        now = clock.now()
        return _DATE_TOKEN.sub(label, text)


def is_fresh(notice: Notice, now: datetime) -> bool:
    at = notice.created_at
    return at is not None and now - FRESH_FOR <= at <= now + CLOCK_SKEW


def site_of(app: FastAPI) -> str:
    settings: Settings = app.state.settings
    if settings.site_url:
        return settings.site_url
    origins = [o for o in settings.cors_origins if o.startswith("http")]
    return origins[0].rstrip("/") if origins else "http://localhost:5173"


# ---------- Настройки каналов (для API) ----------


class DeliverySettingsService:
    def __init__(self, repo: DeliveryRepository, settings: Settings) -> None:
        self.repo = repo
        self.settings = settings

    async def view(self, user: User) -> dict[str, Any]:
        prefs = prefs_of(await self.repo.prefs(user.id))
        recipient = (await self.repo.recipients([user.id])).get(user.id)
        platforms = await self.repo.bot_platforms(user.id, datetime.now(UTC))
        address = (user.email or "").strip()
        return {
            **prefs,
            "email_address": address or None,
            "email_deliverable": mail_target(recipient) is not None,
            "bots": {"vk": "vk" in platforms},
            "push_available": self.settings.web_push_enabled,
            "push_key": self.settings.web_push_public_key.strip() or None,
            "push_subscriptions": await self.repo.count_subscriptions(user.id),
        }

    async def update(self, user: User, changes: dict[str, Any]) -> dict[str, Any]:
        if changes:
            await self.repo.save_prefs(user.id, changes)
            await self.repo.session.commit()
        return await self.view(user)

    async def subscribe(self, user: User, endpoint: str, p256dh: str, auth: str, user_agent: str) -> None:
        # Тот же браузер под другим аккаунтом: подписка переходит к тому, кто вошёл сейчас.
        await self.repo.save_subscription(user.id, endpoint, p256dh, auth, user_agent[:255])
        await self.repo.session.commit()

    async def unsubscribe(self, user: User, endpoint: str) -> None:
        await self.repo.delete_subscription(endpoint, user.id)
        await self.repo.session.commit()


# ---------- Фоновая доставка ----------


@dataclass(frozen=True, slots=True)
class _Job:
    notice: Notice
    channel: DeliveryChannel


class NotificationDelivery:
    def __init__(self, app: FastAPI, push: PushSender | None) -> None:
        self.app = app
        # Отправитель Web Push; None — ключи VAPID не заданы, канал «В браузере» недоступен.
        self.push = push
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._tests: dict[str, deque[float]] = {}

    def _session(self) -> AsyncSession:
        return self.app.state.db.sessionmaker()

    # ---------- Проход по новым уведомлениям ----------

    async def deliver_pending(self) -> int:
        """Отметить новые уведомления и отправить свежие. Возвращает, сколько отправок прошло."""
        async with self._lock:
            now = domain_now()
            async with self._session() as session:
                repo = DeliveryRepository(session)
                await repo.reconcile_log()
                first_run = await repo.log_is_empty()
                await session.commit()
            # Повтор неудавшихся — до новых: отправленное в этом проходе повторяется не раньше следующего.
            sent = await self._retry_failed(now)
            while True:
                async with self._session() as session:
                    repo = DeliveryRepository(session)
                    notices = await repo.unprocessed(BATCH)
                    jobs = await self._plan(repo, notices, now, baseline_all=first_run)
                    await session.commit()
                for job in jobs:
                    sent += await self._run_job(job)
                if len(notices) < BATCH:
                    break
            return sent

    async def _plan(
        self, repo: DeliveryRepository, notices: list[Notice], now: datetime, *, baseline_all: bool
    ) -> list[_Job]:
        rows: list[LogRow] = []
        fresh = [n for n in notices if not baseline_all and is_fresh(n, now)]
        fresh_ids = {n.id for n in fresh}
        for n in notices:
            if n.id not in fresh_ids:
                rows.extend(
                    LogRow(n.id, ch, n.created_at, n.user_id, DeliveryStatus.BASELINE)
                    for ch in DeliveryChannel
                )
        users = {n.user_id for n in fresh}
        prefs = await repo.prefs_many(users)
        recipients = await repo.recipients(users)
        subscriptions = await repo.subscriptions(users) if self.push is not None else {}
        planned: dict[tuple[str, str], DeliveryStatus] = {}
        for n in fresh:
            p = prefs_of(prefs.get(n.user_id))
            email_skip = (
                "off" if not p["email"] else None if mail_target(recipients.get(n.user_id)) else "no_address"
            )
            if self.push is None:
                browser_skip: str | None = "unavailable"
            elif not p["browser"]:
                browser_skip = "off"
            else:
                browser_skip = None if subscriptions.get(n.user_id) else "no_subscriptions"
            for channel, skip in (
                (DeliveryChannel.EMAIL, email_skip),
                (DeliveryChannel.BROWSER, browser_skip),
            ):
                status = DeliveryStatus.SKIPPED if skip else DeliveryStatus.SENDING
                rows.append(LogRow(n.id, channel, n.created_at, n.user_id, status, skip))
                planned[n.id, channel.value] = status
        claimed = await repo.add_log(rows)
        # Пару, которую уже занял другой процесс, не отправляем.
        return [
            _Job(n, ch)
            for n in fresh
            for ch in DeliveryChannel
            if (n.id, ch.value) in claimed and planned[n.id, ch.value] == DeliveryStatus.SENDING
        ]

    async def _retry_failed(self, now: datetime) -> int:
        async with self._session() as session:
            repo = DeliveryRepository(session)
            candidates = await repo.retryable(MAX_ATTEMPTS, now - FRESH_FOR)
            jobs = [
                _Job(notice, DeliveryChannel(channel))
                for log_id, channel, notice in candidates
                if await repo.claim_retry(log_id)
            ]
            await session.commit()
        sent = 0
        for job in jobs:
            sent += await self._run_job(job)
        return sent

    async def _run_job(self, job: _Job) -> int:
        n, channel = job.notice, job.channel
        try:
            if channel == DeliveryChannel.EMAIL:
                status, error = await self._send_email(n)
            else:
                status, error = await self._send_browser(n)
        except Exception as exc:  # noqa: BLE001  сбой одного канала не мешает остальным
            # Текст уведомления личный: в журнал только номер, канал и тип ошибки.
            logger.warning("Уведомление %s (%s) не доставлено: %s", n.id, channel, type(exc).__name__)
            status, error = DeliveryStatus.FAILED, type(exc).__name__
        async with self._session() as session:
            await DeliveryRepository(session).finish(n.id, channel, status, error, datetime.now(UTC))
            await session.commit()
        return int(status == DeliveryStatus.SENT)

    # ---------- Каналы ----------

    async def _recipient(self, user_id: str) -> Recipient | None:
        async with self._session() as session:
            return (await DeliveryRepository(session).recipients([user_id])).get(user_id)

    async def _send_email(self, n: Notice) -> tuple[DeliveryStatus, str | None]:
        recipient = await self._recipient(n.user_id)
        address = mail_target(recipient)
        if recipient is None or address is None:
            return DeliveryStatus.SKIPPED, "no_address"
        ok = await self._mail(recipient, address, n.title, render_text(n.text, recipient.city), n.link)
        return (DeliveryStatus.SENT, None) if ok else (DeliveryStatus.FAILED, "smtp")

    async def _mail(self, recipient: Recipient, address: str, title: str, text: str, link: str) -> bool:
        site = site_of(self.app)
        url = f"{site}{link or FALLBACK_LINK}"
        rendered = notification_mail(recipient.name, title, text, url, site)
        return await self.app.state.mailer.send(
            OutgoingMail(
                to=address, subject=rendered.subject, text=rendered.text, html=rendered.html, link=url
            )
        )

    async def _send_browser(self, n: Notice) -> tuple[DeliveryStatus, str | None]:
        async with self._session() as session:
            subs = (await DeliveryRepository(session).subscriptions([n.user_id])).get(n.user_id, [])
        recipient = await self._recipient(n.user_id)
        text = render_text(n.text, recipient.city if recipient else "")
        message = PushMessage(id=n.id, title=n.title, body=text, url=n.link or FALLBACK_LINK)
        return await self._push_all(subs, message)

    async def _push_all(
        self, subs: list[PushSubscription], message: PushMessage
    ) -> tuple[DeliveryStatus, str | None]:
        if self.push is None:
            return DeliveryStatus.SKIPPED, "unavailable"
        if not subs:
            return DeliveryStatus.SKIPPED, "no_subscriptions"
        outcomes: list[PushOutcome] = []
        for sub in subs:
            outcome = await self.push.send(PushTarget(sub.endpoint, sub.p256dh, sub.auth), message)
            outcomes.append(outcome)
            async with self._session() as session:
                repo = DeliveryRepository(session)
                if outcome == PushOutcome.GONE:
                    await repo.delete_subscription(sub.endpoint)
                elif outcome == PushOutcome.OK:
                    await repo.subscription_ok(sub.endpoint, datetime.now(UTC))
                await session.commit()
        if PushOutcome.OK in outcomes:
            return DeliveryStatus.SENT, None
        if PushOutcome.FAILED in outcomes:
            return DeliveryStatus.FAILED, "push"
        return DeliveryStatus.SKIPPED, "no_subscriptions"

    # ---------- Проверка из настроек ----------

    def _check_test_limit(self, user_id: str) -> None:
        now = time.monotonic()
        hits = self._tests.setdefault(user_id, deque())
        while hits and now - hits[0] > TEST_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= TEST_LIMIT:
            raise AppError(
                ErrorCode.RATE_LIMIT, "Проверку можно запускать пять раз за 10 минут. Подождите немного"
            )
        hits.append(now)

    async def send_test(self, user_id: str) -> dict[str, str]:
        """Пробное уведомление сразу по включённым каналам, без записи под колокольчик и в журнал."""
        self._check_test_limit(user_id)
        async with self._session() as session:
            repo = DeliveryRepository(session)
            prefs = prefs_of(await repo.prefs(user_id))
            recipient = (await repo.recipients([user_id])).get(user_id)
            subs = (await repo.subscriptions([user_id])).get(user_id, [])

        email = TestResult.OFF
        if prefs["email"]:
            address = mail_target(recipient)
            if recipient is None or address is None:
                email = TestResult.UNAVAILABLE
            else:
                try:
                    ok = await self._mail(recipient, address, TEST_TITLE, TEST_TEXT, SETTINGS_PATH)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Проверочное письмо не отправлено: %s", type(exc).__name__)
                    ok = False
                email = TestResult.SENT if ok else TestResult.FAILED

        browser = TestResult.OFF
        if prefs["browser"]:
            if self.push is None or not subs:
                browser = TestResult.UNAVAILABLE
            else:
                message = PushMessage(
                    id=f"test-{int(clock.now().timestamp() * 1000)}",
                    title=TEST_TITLE,
                    body=TEST_TEXT,
                    url=SETTINGS_PATH,
                )
                try:
                    status, _ = await self._push_all(subs, message)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Проверочное уведомление в браузер не отправлено: %s", type(exc).__name__)
                    status = DeliveryStatus.FAILED
                browser = {
                    DeliveryStatus.SENT: TestResult.SENT,
                    DeliveryStatus.SKIPPED: TestResult.UNAVAILABLE,
                }.get(status, TestResult.FAILED)
        return {"email": email.value, "browser": browser.value}

    # ---------- Фоновая задача ----------

    async def _safe_deliver(self) -> None:
        try:
            await self.deliver_pending()
        except Exception:
            logger.exception("Доставка уведомлений на почту и в браузер не удалась")

    async def _run(self, poll: float) -> None:
        broker = self.app.state.broker
        while True:
            sub = broker.subscribe([PUBLIC_TOPIC]).subscription
            try:
                await self._safe_deliver()
                while not sub.closed:
                    try:
                        message = await asyncio.wait_for(sub.queue.get(), timeout=poll)
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
            await asyncio.sleep(poll)

    def start(self) -> None:
        poll = self.app.state.settings.delivery_poll_seconds
        if self._task is None and poll > 0:
            self._task = asyncio.create_task(self._run(poll))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
