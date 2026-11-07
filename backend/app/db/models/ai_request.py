from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Identity, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiRequest(Base):
    """Журнал обращений к помощнику. Текст запроса и ответа не хранится — только метрики."""

    __tablename__ = "ai_requests"
    __table_args__ = (
        Index("ix_ai_requests_user_id_created_at", "user_id", "created_at"),
        Index("ix_ai_requests_kind_created_at", "kind", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(32))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    duration_ms: Mapped[int] = mapped_column(Integer)
    success: Mapped[bool] = mapped_column(Boolean)
    fallback_used: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    cached: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    error: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
