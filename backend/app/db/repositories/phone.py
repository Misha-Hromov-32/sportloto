from datetime import datetime

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.db.models import EmailPurpose, EmailToken, PhoneCode, PhoneStatus


class PhoneCodeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, code: PhoneCode) -> PhoneCode:
        self.session.add(code)
        await self.session.flush()
        return code

    async def lock_phone(self, phone: str) -> None:
        """Запросы на один номер проходят по очереди: два одновременных не обойдут лимит."""
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"sms:{phone}"}
        )

    async def sent_times(self, condition: ColumnElement[bool], since: datetime) -> list[datetime]:
        """Время запросов кода после `since` по условию (номер, IP или пользователь), по возрастанию."""
        result = await self.session.execute(
            select(PhoneCode.created_at)
            .where(condition, PhoneCode.created_at > since)
            .order_by(PhoneCode.created_at)
        )
        return list(result.scalars())

    async def count_sent(self, since: datetime) -> int:
        """Сколько SMS ушло к провайдеру после `since` — для общего дневного потолка."""
        result = await self.session.execute(
            select(func.count())
            .select_from(PhoneCode)
            .where(PhoneCode.code_hash.is_not(None), PhoneCode.created_at > since)
        )
        return result.scalar_one()

    async def expire_unused(self, user_id: str, now: datetime) -> None:
        """Новый код гасит прежние."""
        await self.session.execute(
            update(PhoneCode)
            .where(PhoneCode.user_id == user_id, PhoneCode.used_at.is_(None), PhoneCode.expires_at > now)
            .values(expires_at=now)
        )

    async def active(self, user_id: str, phone: str, now: datetime) -> PhoneCode | None:
        # Блокировка строки: одновременные попытки ввода считаются по одной.
        result = await self.session.execute(
            select(PhoneCode)
            .where(
                PhoneCode.user_id == user_id,
                PhoneCode.phone == phone,
                PhoneCode.code_hash.is_not(None),
                PhoneCode.used_at.is_(None),
                PhoneCode.expires_at > now,
            )
            .order_by(PhoneCode.created_at.desc())
            .limit(1)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def verification_mailed(self, user_id: str) -> bool:
        """Письмо со ссылкой подтверждения уже уходило этому пользователю."""
        result = await self.session.execute(
            select(EmailToken.id)
            .where(EmailToken.user_id == user_id, EmailToken.purpose == EmailPurpose.VERIFY)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None


class PhoneStatusRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: str) -> PhoneStatus | None:
        return await self.session.get(PhoneStatus, user_id)

    async def mark_verified(self, user_id: str, phone: str, now: datetime) -> None:
        statement = insert(PhoneStatus).values(user_id=user_id, phone=phone, verified_at=now)
        await self.session.execute(
            statement.on_conflict_do_update(
                index_elements=[PhoneStatus.user_id], set_={"phone": phone, "verified_at": now}
            )
        )
