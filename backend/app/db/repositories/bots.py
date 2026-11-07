from datetime import datetime

from sqlalchemy import or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BotCode, BotLink, User


class BotLinkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, link: BotLink) -> BotLink:
        self.session.add(link)
        await self.session.flush()
        return link

    async def lock_chat(self, platform: str, external_id: str) -> None:
        """Привязки одного чата создаются по очереди: две одновременные не нарушат уникальность."""
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"bot:{platform}:{external_id}"}
        )

    async def revoke_chat(self, platform: str, external_id: str, now: datetime) -> None:
        await self.session.execute(
            update(BotLink)
            .where(
                BotLink.platform == platform,
                BotLink.external_id == external_id,
                BotLink.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )

    async def active_by_hash(self, token_hash: str, issued_after: datetime) -> tuple[BotLink, User] | None:
        result = await self.session.execute(
            select(BotLink, User)
            .join(User, User.id == BotLink.user_id)
            .where(
                BotLink.token_hash == token_hash,
                BotLink.revoked_at.is_(None),
                BotLink.created_at > issued_after,
                User.is_active,
            )
        )
        row = result.first()
        return (row[0], row[1]) if row else None

    async def touch(self, link_id: str, now: datetime, stale_before: datetime) -> None:
        await self.session.execute(
            update(BotLink)
            .where(
                BotLink.id == link_id,
                or_(BotLink.last_used_at.is_(None), BotLink.last_used_at < stale_before),
            )
            .values(last_used_at=now)
        )

    async def list_active(self, user_id: str, issued_after: datetime) -> list[BotLink]:
        result = await self.session.execute(
            select(BotLink)
            .where(
                BotLink.user_id == user_id,
                BotLink.revoked_at.is_(None),
                BotLink.created_at > issued_after,
            )
            .order_by(BotLink.created_at.desc())
        )
        return list(result.scalars())

    async def revoke(self, link_id: str, user_id: str, now: datetime) -> bool:
        result = await self.session.execute(
            update(BotLink)
            .where(BotLink.id == link_id, BotLink.user_id == user_id, BotLink.revoked_at.is_(None))
            .values(revoked_at=now)
            .returning(BotLink.id)
        )
        return result.scalar_one_or_none() is not None


class BotCodeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, code: BotCode) -> BotCode:
        self.session.add(code)
        await self.session.flush()
        return code

    async def lock_codes(self) -> None:
        """Выдача кодов по очереди: у двух действующих кодов не будет одинакового хеша."""
        await self.session.execute(text("SELECT pg_advisory_xact_lock(hashtext('bot:codes'))"))

    async def has_active(self, code_hash: str, now: datetime) -> bool:
        result = await self.session.execute(
            select(BotCode.id)
            .where(BotCode.code_hash == code_hash, BotCode.used_at.is_(None), BotCode.expires_at > now)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def find(self, code_hash: str, kind: str, now: datetime) -> BotCode | None:
        """Сначала действующий код, иначе последний выданный — чтобы отличить «устарел» от «не подошёл»."""
        active = BotCode.used_at.is_(None) & (BotCode.expires_at > now)
        result = await self.session.execute(
            select(BotCode)
            .where(BotCode.code_hash == code_hash, BotCode.kind == kind)
            .order_by(active.desc(), BotCode.created_at.desc(), BotCode.id.desc())
            .limit(1)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def site_codes_since(self, user_id: str, since: datetime) -> list[datetime]:
        result = await self.session.execute(
            select(BotCode.created_at)
            .where(BotCode.user_id == user_id, BotCode.kind == "site", BotCode.created_at > since)
            .order_by(BotCode.created_at)
        )
        return list(result.scalars())

    async def expire_pending(self, platform: str, external_id: str, now: datetime) -> None:
        """Новый код из бота гасит прежний неподтверждённый код того же чата."""
        await self.session.execute(
            update(BotCode)
            .where(
                BotCode.kind == "bot",
                BotCode.platform == platform,
                BotCode.external_id == external_id,
                BotCode.user_id.is_(None),
                BotCode.used_at.is_(None),
                BotCode.expires_at > now,
            )
            .values(expires_at=now)
        )
