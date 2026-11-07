from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuthSession, User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: str) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(func.lower(User.email) == email.lower()))
        return result.scalar_one_or_none()

    async def list_demo(self) -> list[User]:
        result = await self.session.execute(
            select(User).where(User.demo_order.is_not(None), User.is_active).order_by(User.demo_order)
        )
        return list(result.scalars())

    def add(self, user: User) -> User:
        self.session.add(user)
        return user


class AuthSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, auth_session: AuthSession) -> AuthSession:
        self.session.add(auth_session)
        return auth_session

    async def get_active(self, token_hash: str, now: datetime) -> AuthSession | None:
        result = await self.session.execute(
            select(AuthSession).where(AuthSession.token_hash == token_hash, AuthSession.expires_at > now)
        )
        return result.scalar_one_or_none()

    async def delete(self, token_hash: str) -> None:
        await self.session.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash))

    async def delete_all(self, user_id: str) -> None:
        await self.session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))

    async def delete_expired(self, user_id: str, now: datetime) -> None:
        await self.session.execute(
            delete(AuthSession).where(AuthSession.user_id == user_id, AuthSession.expires_at <= now)
        )
