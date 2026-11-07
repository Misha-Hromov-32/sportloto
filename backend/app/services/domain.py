"""Доменные правила в процессе сервера: движок, транзакции, живые обновления и проверки по времени.

Правила синхронные (работают с базой как с объектом в памяти, см. app/domain/store.py), поэтому
выполняются в пуле потоков на отдельном синхронном движке (psycopg) к той же базе. Изменения, которые
правило публикует (`bus.publish`), после коммита уходят в брокер SSE каналом `public`: экраны
перечитывают данные сами, со своими правами.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable

import sqlalchemy as sa
from sqlalchemy import create_engine
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings
from app.domain import bus, clock, demo_restore, provider, store
from app.domain.store import DomainStore, LiveChange
from app.realtime import Broker
from app.realtime.broker import live_event
from app.services.realtime import PUBLIC_TOPIC

logger = logging.getLogger(__name__)

# Сессия вкладки или ключ бота `stb_…` (bot_links, срок 365 дней): у обоих в базе sha256 токена.
_SESSION_USER = sa.text(
    "SELECT s.user_id FROM auth_sessions s JOIN users u ON u.id = s.user_id "
    "WHERE s.token_hash = :token_hash AND s.expires_at > now() AND u.is_active "
    "UNION ALL "
    "SELECT b.user_id FROM bot_links b JOIN users u ON u.id = b.user_id "
    "WHERE b.token_hash = :token_hash AND b.revoked_at IS NULL "
    "AND b.created_at > now() - interval '365 days' AND u.is_active "
    "LIMIT 1"
)


class DomainRuntime:
    def __init__(self, settings: Settings, broker: Broker) -> None:
        self.settings = settings
        self.broker = broker
        engine = create_engine(
            settings.sync_database_url,
            echo=settings.database_echo,
            pool_size=settings.database_pool_size,
            pool_pre_ping=True,
            connect_args={"connect_timeout": max(1, int(settings.database_connect_timeout))},
        )
        self.store = DomainStore(engine, publish=self._publish, strict=settings.domain_strict)
        provider.configure_demo(
            reset_enabled=settings.demo_reset_enabled, backup_dir=settings.domain_backup_dir.strip()
        )
        self._loop: asyncio.AbstractEventLoop | None = None
        # Метка восстановления демо, которую процесс уже видел (None — ещё не читал).
        self._restore_mark: str | None = None
        self._ticker: asyncio.Task[None] | None = None
        if settings.domain_frozen_now:
            frozen = clock.parse(settings.domain_frozen_now)
            clock.set_frozen(frozen)

    # ---------- Транзакции ----------

    def run[T](
        self,
        fn: Callable[[], T],
        *,
        write: bool,
        token_hash: str | None = None,
        user_id: str | None = None,
        zone: str = clock.DEFAULT_ZONE,
    ) -> T:
        """Выполнить правило в транзакции от имени владельца сессии. Вызывается из пула потоков."""

        def transaction() -> T:
            uid = user_id
            if uid is None and token_hash:
                uid = store.data().connection.execute(_SESSION_USER, {"token_hash": token_hash}).scalar()
            with provider.acting_as(uid):
                if self.settings.demo_shift_dates:
                    provider.refresh_dates()
                if write:
                    provider.lazy_checks()
                return fn()

        with clock.zone(zone):
            return self.store.write(transaction) if write else self.store.read(transaction)

    async def call[T](
        self,
        fn: Callable[[], T],
        *,
        write: bool,
        token_hash: str | None = None,
        user_id: str | None = None,
        zone: str = clock.DEFAULT_ZONE,
    ) -> T:
        return await run_in_threadpool(
            self.run, fn, write=write, token_hash=token_hash, user_id=user_id, zone=zone
        )

    # ---------- Живые обновления ----------

    def _publish(self, changes: list[LiveChange]) -> None:
        # Коммит прошёл в потоке пула, а брокер живёт в цикле событий.
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._deliver, changes)

    def _deliver(self, changes: list[LiveChange]) -> None:
        for change in changes:
            for resource in change.resources:
                self.broker.publish([PUBLIC_TOPIC], live_event(resource, change.ids, change.type))

    # ---------- Запуск и фоновые проверки ----------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if self.settings.demo_seed_on_start:
            seeded = await run_in_threadpool(self.store.write, provider.ensure_seeded)
            if seeded:
                logger.info("Демо-данные загружены или обновлены")
        if self.settings.domain_tick_seconds > 0:
            self._ticker = asyncio.create_task(self._tick_forever())

    def tick(self) -> None:
        """Сдвиг дат демо-данных и проверки по времени: резервы, напоминания, «Встреча состоялась?»."""

        def run() -> None:
            if self.settings.demo_shift_dates:
                provider.refresh_dates()
            provider.lazy_checks()
            self._notice_restore()

        self.store.write(run)

    def _notice_restore(self) -> None:
        """Демо восстановили командой из другого процесса: открытые вкладки перечитывают всё."""
        mark = store.data().settings.get(demo_restore.RESTORE_MARK) or ""
        if self._restore_mark is not None and mark != self._restore_mark:
            bus.publish(list(bus.RESOURCES))
        self._restore_mark = mark

    async def _tick_forever(self) -> None:
        while True:
            await asyncio.sleep(self.settings.domain_tick_seconds)
            try:
                await run_in_threadpool(self.tick)
            except Exception:
                logger.exception("Фоновая проверка доменных правил не удалась")

    async def stop(self) -> None:
        if self._ticker is not None:
            self._ticker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._ticker
        self._loop = None
        await run_in_threadpool(self.store.dispose)
