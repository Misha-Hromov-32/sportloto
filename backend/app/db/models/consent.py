from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ConsentKind(StrEnum):
    TERMS = "terms"  # Пользовательское соглашение и Политика
    PERSONAL_DATA = "personal_data"  # согласие на обработку
    PUBLIC_PROFILE = "public_profile"  # согласие на распространение


class UserConsent(Base):
    """Журнал согласий (152-ФЗ, ст. 9 ч. 3): кто, когда, с какой редакцией документов и откуда.

    Строка не удаляется вместе с аккаунтом: при удалении ставится время отзыва.
    """

    __tablename__ = "user_consents"
    __table_args__ = (
        CheckConstraint("kind IN ('terms', 'personal_data', 'public_profile')", name="kind"),
        Index("ix_user_consents_user_id_kind", "user_id", "kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    version: Mapped[str] = mapped_column(String(32))
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
