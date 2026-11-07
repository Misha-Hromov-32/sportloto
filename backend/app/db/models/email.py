from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmailPurpose(StrEnum):
    VERIFY = "verify"
    RESET = "reset"


class EmailToken(Base):
    """Одноразовая ссылка из письма. В базе только sha256 токена: утечка таблицы не даёт войти."""

    __tablename__ = "email_tokens"
    __table_args__ = (
        CheckConstraint("purpose IN ('verify', 'reset')", name="purpose"),
        Index("ix_email_tokens_user_id_purpose", "user_id", "purpose"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmailStatus(Base):
    """Статус почты. Нет строки — почта считается подтверждённой (демо-аккаунты и старые пользователи)."""

    __tablename__ = "email_status"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
