from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import Insert, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EmailStatus, EmailToken


class EmailTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, token: EmailToken) -> EmailToken:
        self.session.add(token)
        return token

    async def get_by_hash(self, token_hash: str, purpose: str) -> EmailToken | None:
        # Блокировка строки: два одновременных перехода по одной ссылке не пройдут оба.
        result = await self.session.execute(
            select(EmailToken)
            .where(EmailToken.token_hash == token_hash, EmailToken.purpose == purpose)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def expire_unused(self, user_id: str, purpose: str, now: datetime) -> None:
        """Прежние ссылки того же назначения перестают работать: действует только последняя."""
        await self.session.execute(
            update(EmailToken)
            .where(
                EmailToken.user_id == user_id,
                EmailToken.purpose == purpose,
                EmailToken.used_at.is_(None),
                EmailToken.expires_at > now,
            )
            .values(expires_at=now)
        )


class EmailStatusRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: str) -> EmailStatus | None:
        return await self.session.get(EmailStatus, user_id)

    async def is_verified(self, user_id: str) -> bool:
        status = await self.get(user_id)
        return status is None or status.verified_at is not None

    async def mark_verified(self, user_id: str, now: datetime) -> None:
        """Отметить подтверждение, только если пользователь ждал его: нет строки — и так подтверждён."""
        await self.session.execute(
            update(EmailStatus)
            .where(EmailStatus.user_id == user_id, EmailStatus.verified_at.is_(None))
            .values(verified_at=now)
        )

    @staticmethod
    def pending_insert(user_id: str) -> Insert:
        """Запрос «ждёт подтверждения» для выполнения в транзакции регистрации."""
        return insert(EmailStatus).values(user_id=user_id, verified_at=None).on_conflict_do_nothing()
