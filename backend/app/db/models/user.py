from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, new_id


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"
    # Аккаунт удалён по просьбе владельца: строка обезличена, остаётся ради чужих обсуждений и истории встреч.
    DELETED = "deleted"


class User(TimestampMixin, Base):
    """Пользователь. Представитель организации — тоже `user`: организатор и организация не роли, а связи."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'admin', 'deleted')", name="role"),
        # Почта уникальна без учёта регистра.
        Index("ix_users_email_lower", text("lower(email)"), unique=True),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("u"))
    email: Mapped[str] = mapped_column(String(254))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(16), default=UserRole.USER, server_default=UserRole.USER)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Демо-аккаунт: вход в один клик из переключателя ролей. Порядок задаёт место в списке.
    # Дробный порядок (7.5) ставит аккаунт между соседями, не перенумеровывая остальных.
    demo_order: Mapped[float | None] = mapped_column(Double)
    demo_title: Mapped[str | None] = mapped_column(String(120))
    demo_hint: Mapped[str | None] = mapped_column(String(255))

    # Профиль: его читают и меняют доменные правила (app/domain), поля — как в контракте `User`.
    avatar_url: Mapped[str | None] = mapped_column(Text)
    age: Mapped[int | None] = mapped_column(Integer)
    city: Mapped[str] = mapped_column(Text, default="Красноярск", server_default="Красноярск")
    district_id: Mapped[str | None] = mapped_column(
        ForeignKey("districts.id", deferrable=True, initially="DEFERRED")
    )
    about: Mapped[str] = mapped_column(Text, default="", server_default="")
    interests: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list, server_default="{}")
    levels: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict, server_default="{}")
    readiness: Mapped[str | None] = mapped_column(String(16))
    # Точка отсчёта для «Рядом со мной»: { lat, lng }.
    home: Mapped[dict[str, float] | None] = mapped_column(JSONB)
    radius_km: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    phone: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Пол указывают добровольно; видит только сам человек.
    gender: Mapped[str | None] = mapped_column(String(16))
    ord: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN

    @property
    def is_demo(self) -> bool:
        return self.demo_order is not None


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped[User] = relationship(back_populates="sessions", lazy="joined")
