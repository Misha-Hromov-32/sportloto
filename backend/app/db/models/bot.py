from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_id


class BotPlatform(StrEnum):
    TELEGRAM = "telegram"
    VK = "vk"


class BotCodeKind(StrEnum):
    # Код выдал сайт, его приносит бот.
    SITE = "site"
    # Код выдал бот, его вводят на сайте.
    BOT = "bot"


class BotLink(Base):
    """Привязка чата в мессенджере к аккаунту: личный ключ бота `stb_…` (в базе только sha256)."""

    __tablename__ = "bot_links"
    __table_args__ = (
        CheckConstraint("platform IN ('telegram', 'vk')", name="platform"),
        # Один чат — одна действующая привязка; отозванные остаются для истории.
        Index(
            "uq_bot_links_platform_external_id_active",
            "platform",
            "external_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("bl"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(16))
    external_id: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BotCode(Base):
    """Одноразовый шестизначный код привязки. В базе только HMAC кода с секретом бота."""

    __tablename__ = "bot_codes"
    __table_args__ = (
        CheckConstraint("kind IN ('site', 'bot')", name="kind"),
        CheckConstraint("platform IN ('telegram', 'vk')", name="platform"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(8))
    platform: Mapped[str] = mapped_column(String(16))
    # Код сайта — чей аккаунт; код бота — кто ввёл его на сайте.
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    external_id: Mapped[str | None] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    link_id: Mapped[str | None] = mapped_column(ForeignKey("bot_links.id", ondelete="SET NULL"))
