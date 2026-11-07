from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    BotLink,
    DeliveryLog,
    DeliveryPrefs,
    DeliveryStatus,
    EmailStatus,
    PushSubscription,
    User,
)
from app.domain.schema import COLLECTIONS

_notifications = COLLECTIONS["notifications"].table

# Ключ бота действует год с момента привязки — как в проверке ключа (app/services/bots.py).
BOT_KEY_DAYS = 365


@dataclass(frozen=True, slots=True)
class Notice:
    id: str
    user_id: str
    title: str
    text: str
    link: str
    created_at: datetime | None


@dataclass(frozen=True, slots=True)
class Recipient:
    user_id: str
    name: str
    email: str
    city: str
    is_active: bool
    email_verified: bool


@dataclass(frozen=True, slots=True)
class LogRow:
    notification_id: str
    channel: str
    notification_at: datetime | None
    user_id: str | None
    status: DeliveryStatus
    error: str | None = None


def _notice(row: sa.Row[Any]) -> Notice:
    return Notice(
        id=row.id,
        user_id=row.user_id,
        title=row.title or "",
        text=row.text or "",
        link=row.link or "",
        created_at=row.created_at,
    )


class DeliveryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ---------- Каналы человека ----------

    async def prefs(self, user_id: str) -> DeliveryPrefs | None:
        return await self.session.get(DeliveryPrefs, user_id)

    async def prefs_many(self, user_ids: Iterable[str]) -> dict[str, DeliveryPrefs]:
        ids = list(set(user_ids))
        if not ids:
            return {}
        rows = await self.session.execute(sa.select(DeliveryPrefs).where(DeliveryPrefs.user_id.in_(ids)))
        return {p.user_id: p for p in rows.scalars()}

    async def save_prefs(self, user_id: str, changes: dict[str, Any]) -> None:
        statement = insert(DeliveryPrefs).values(user_id=user_id, **changes)
        await self.session.execute(
            statement.on_conflict_do_update(
                index_elements=[DeliveryPrefs.user_id], set_={**changes, "updated_at": sa.func.now()}
            )
        )

    async def recipients(self, user_ids: Iterable[str]) -> dict[str, Recipient]:
        ids = list(set(user_ids))
        if not ids:
            return {}
        # Нет строки статуса почты — почта считается подтверждённой (демо и старые аккаунты).
        verified = sa.or_(EmailStatus.user_id.is_(None), EmailStatus.verified_at.is_not(None))
        rows = await self.session.execute(
            sa.select(User.id, User.name, User.email, User.city, User.is_active, verified.label("verified"))
            .outerjoin(EmailStatus, EmailStatus.user_id == User.id)
            .where(User.id.in_(ids))
        )
        return {
            r.id: Recipient(
                r.id, r.name or "", r.email or "", r.city or "", bool(r.is_active), bool(r.verified)
            )
            for r in rows
        }

    async def bot_platforms(self, user_id: str, now: datetime) -> set[str]:
        rows = await self.session.execute(
            sa.select(BotLink.platform)
            .where(
                BotLink.user_id == user_id,
                BotLink.revoked_at.is_(None),
                BotLink.created_at > now - timedelta(days=BOT_KEY_DAYS),
            )
            .distinct()
        )
        return set(rows.scalars())

    # ---------- Подписки браузера ----------

    async def subscriptions(self, user_ids: Iterable[str]) -> dict[str, list[PushSubscription]]:
        ids = list(set(user_ids))
        result: dict[str, list[PushSubscription]] = {}
        if not ids:
            return result
        rows = await self.session.execute(
            sa.select(PushSubscription).where(PushSubscription.user_id.in_(ids)).order_by(PushSubscription.id)
        )
        for sub in rows.scalars():
            result.setdefault(sub.user_id, []).append(sub)
        return result

    async def count_subscriptions(self, user_id: str) -> int:
        count = await self.session.scalar(
            sa.select(sa.func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.user_id == user_id)
        )
        return int(count or 0)

    async def save_subscription(
        self, user_id: str, endpoint: str, p256dh: str, auth: str, user_agent: str
    ) -> None:
        values = {"user_id": user_id, "p256dh": p256dh, "auth": auth, "user_agent": user_agent}
        statement = insert(PushSubscription).values(endpoint=endpoint, **values)
        await self.session.execute(
            statement.on_conflict_do_update(index_elements=[PushSubscription.endpoint], set_=values)
        )

    async def delete_subscription(self, endpoint: str, user_id: str | None = None) -> None:
        condition = PushSubscription.endpoint == endpoint
        if user_id is not None:
            condition = sa.and_(condition, PushSubscription.user_id == user_id)
        await self.session.execute(sa.delete(PushSubscription).where(condition))

    async def subscription_ok(self, endpoint: str, now: datetime) -> None:
        await self.session.execute(
            sa.update(PushSubscription).where(PushSubscription.endpoint == endpoint).values(last_ok_at=now)
        )

    # ---------- Журнал доставки ----------

    async def reconcile_log(self) -> None:
        """Сверка журнала с уведомлениями после сдвига дат и сброса демо-данных.

        Сдвиг дат переносит уведомление на целое число дней: это то же уведомление, его отметка
        в журнале переезжает вместе с ним. Иначе номер занят другим уведомлением после сброса:
        старая отметка удаляется, и новое уведомление проходит доставку как обычно.
        """
        log, n = DeliveryLog.__table__, _notifications
        mismatch = sa.and_(
            log.c.notification_id == n.c.id, log.c.notification_at.is_distinct_from(n.c.created_at)
        )
        whole_days = sa.and_(
            log.c.user_id == n.c.user_id,
            log.c.notification_at.is_not(None),
            n.c.created_at.is_not(None),
            sa.func.mod(sa.extract("epoch", n.c.created_at - log.c.notification_at), 86_400) == 0,
        )
        await self.session.execute(
            sa.update(log).where(mismatch, whole_days).values(notification_at=n.c.created_at)
        )
        await self.session.execute(sa.delete(log).where(mismatch))

    async def log_is_empty(self) -> bool:
        return (await self.session.scalar(sa.select(DeliveryLog.id).limit(1))) is None

    async def unprocessed(self, limit: int) -> list[Notice]:
        n = _notifications
        handled = sa.select(sa.literal(1)).where(DeliveryLog.notification_id == n.c.id).exists()
        rows = await self.session.execute(
            sa.select(n.c.id, n.c.user_id, n.c.title, n.c.text, n.c.link, n.c.created_at)
            .where(~handled)
            .order_by(n.c.created_at.asc().nulls_first(), n.c.id)
            .limit(limit)
        )
        return [_notice(r) for r in rows]

    async def retryable(self, max_attempts: int, since: datetime) -> list[tuple[int, str, Notice]]:
        n = _notifications
        rows = await self.session.execute(
            sa.select(
                DeliveryLog.id.label("log_id"),
                DeliveryLog.channel,
                n.c.id,
                n.c.user_id,
                n.c.title,
                n.c.text,
                n.c.link,
                n.c.created_at,
            )
            .join(
                n,
                sa.and_(n.c.id == DeliveryLog.notification_id, n.c.created_at == DeliveryLog.notification_at),
            )
            .where(
                DeliveryLog.status == DeliveryStatus.FAILED,
                DeliveryLog.attempts < max_attempts,
                n.c.created_at >= since,
            )
            .order_by(DeliveryLog.id)
        )
        return [(r.log_id, r.channel, _notice(r)) for r in rows]

    async def add_log(self, rows: Sequence[LogRow]) -> set[tuple[str, str]]:
        """Записать отметки; уже существующие пары не трогаются. Возвращает пары, записанные сейчас."""
        if not rows:
            return set()
        statement = (
            insert(DeliveryLog)
            .values(
                [
                    {
                        "notification_id": r.notification_id,
                        "channel": r.channel,
                        "notification_at": r.notification_at,
                        "user_id": r.user_id,
                        "status": r.status,
                        "attempts": 1 if r.status == DeliveryStatus.SENDING else 0,
                        "error": r.error,
                    }
                    for r in rows
                ]
            )
            .on_conflict_do_nothing(constraint="uq_delivery_log_notification_channel")
            .returning(DeliveryLog.notification_id, DeliveryLog.channel)
        )
        result = await self.session.execute(statement)
        return {(r.notification_id, r.channel) for r in result}

    async def claim_retry(self, log_id: int) -> bool:
        result = await self.session.execute(
            sa.update(DeliveryLog)
            .where(DeliveryLog.id == log_id, DeliveryLog.status == DeliveryStatus.FAILED)
            .values(status=DeliveryStatus.SENDING, attempts=DeliveryLog.attempts + 1, error=None)
            .returning(DeliveryLog.id)
        )
        return result.first() is not None

    async def finish(
        self, notification_id: str, channel: str, status: DeliveryStatus, error: str | None, now: datetime
    ) -> None:
        await self.session.execute(
            sa.update(DeliveryLog)
            .where(DeliveryLog.notification_id == notification_id, DeliveryLog.channel == channel)
            .values(status=status, error=error, sent_at=now if status == DeliveryStatus.SENT else None)
        )
