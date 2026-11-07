from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PhoneCode(Base):
    """Код из SMS и журнал запросов кода для лимитов.

    В базе только sha256(секрет + код + id): шесть цифр перебираются мгновенно, без секрета хеш бесполезен.
    Запрос без отправки (почта не ждёт подтверждения) тоже записывается — без пользователя и хеша:
    лимиты на номер и IP срабатывают одинаково, и по ответам нельзя понять, есть ли такой аккаунт.
    """

    __tablename__ = "phone_codes"
    __table_args__ = (
        Index("ix_phone_codes_phone_created_at", "phone", "created_at"),
        Index("ix_phone_codes_ip_created_at", "ip", "created_at"),
        Index("ix_phone_codes_user_id_created_at", "user_id", "created_at"),
        Index("ix_phone_codes_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    phone: Mapped[str] = mapped_column(String(16))
    # Пусто — SMS не отправлялось.
    code_hash: Mapped[str | None] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ip: Mapped[str | None] = mapped_column(String(45))


class PhoneStatus(Base):
    """Подтверждённый кодом номер пользователя."""

    __tablename__ = "phone_status"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    phone: Mapped[str] = mapped_column(String(16))
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
