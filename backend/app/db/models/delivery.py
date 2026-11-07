from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeliveryChannel(StrEnum):
    EMAIL = "email"
    BROWSER = "browser"


class DeliveryStatus(StrEnum):
    # Отправка начата: строка уже заняла пару (уведомление, канал), второй раз не уйдёт.
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"
    # Канал выключен, адреса нет или нет подписок браузера.
    SKIPPED = "skipped"
    # Уведомление появилось до запуска доставки или слишком давно: отмечено без отправки.
    BASELINE = "baseline"


class MessengersMode(StrEnum):
    ALL = "all"
    IMPORTANT = "important"
    OFF = "off"


class DeliveryPrefs(Base):
    """Каналы уведомлений человека. Нет строки — значения по умолчанию."""

    __tablename__ = "delivery_prefs"
    __table_args__ = (CheckConstraint("messengers IN ('all', 'important', 'off')", name="messengers"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    browser: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Что боты Telegram и VK пересылают из уведомлений: боты читают это сами по ключу человека.
    messengers: Mapped[str] = mapped_column(
        String(16), default=MessengersMode.ALL, server_default=MessengersMode.ALL
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PushSubscription(Base):
    """Подписка браузера на Web Push. Одна подписка (endpoint) принадлежит одному человеку."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str] = mapped_column(String(255), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeliveryLog(Base):
    """Журнал доставки уведомлений по каналам: пара (уведомление, канал) обрабатывается один раз.

    Номера уведомлений после сброса демо-данных начинаются заново, поэтому рядом хранится время
    уведомления: другая отметка времени при том же номере — это уже другое уведомление.
    """

    __tablename__ = "delivery_log"
    __table_args__ = (
        UniqueConstraint("notification_id", "channel", name="uq_delivery_log_notification_channel"),
        CheckConstraint("channel IN ('email', 'browser')", name="channel"),
        CheckConstraint(
            "status IN ('sending', 'sent', 'failed', 'skipped', 'baseline')",
            name="status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    notification_id: Mapped[str] = mapped_column(String(64))
    channel: Mapped[str] = mapped_column(String(16))
    notification_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
