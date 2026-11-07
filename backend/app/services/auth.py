from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security import hash_session_token, new_session_token, verify_password
from app.db.models import AuthSession, User
from app.db.repositories.email import EmailStatusRepository
from app.db.repositories.users import AuthSessionRepository, UserRepository
from app.services.email import not_verified_error


@dataclass(frozen=True, slots=True)
class LoginResult:
    user: User
    token: str


class AuthService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.sessions = AuthSessionRepository(session)

    async def login_with_password(self, email: str, password: str) -> LoginResult:
        user = await self.users.get_by_email(email.strip())
        # Демо-режим: у демо-аккаунтов и персонажей демо-данных нет пароля — вход по почте.
        # Зарегистрироваться без пароля нельзя, поэтому чужой зарегистрированный аккаунт так не открыть.
        if (
            user is not None
            and self.settings.demo_login_enabled
            and user.is_active
            and user.password_hash is None
            and not password
        ):
            await self._ensure_verified(user)
            return await self._start_session(user)
        valid = await verify_password(user.password_hash if user else None, password)
        if user is None or not valid or not user.is_active:
            raise AppError(ErrorCode.INVALID_CREDENTIALS)
        # Статус почты — только после проверки пароля: без него чужой адрес ничего не раскрывает.
        await self._ensure_verified(user)
        return await self._start_session(user)

    async def _ensure_verified(self, user: User) -> None:
        if self.settings.email_verification and not await EmailStatusRepository(self.session).is_verified(
            user.id
        ):
            raise not_verified_error(user.email)

    async def login_demo(self, user_id: str) -> LoginResult:
        if not self.settings.demo_login_enabled:
            raise AppError(ErrorCode.FORBIDDEN, "Быстрый вход отключён. Войдите по почте и паролю")
        user = await self.users.get(user_id)
        if user is None or not user.is_demo or not user.is_active:
            raise AppError(ErrorCode.NOT_FOUND, "Такого аккаунта нет. Выберите аккаунт из списка")
        return await self._start_session(user)

    async def login_registered(self, user_id: str) -> LoginResult:
        """Сессия для только что зарегистрированного пользователя."""
        user = await self.users.get(user_id)
        if user is None or not user.is_active:
            raise AppError(ErrorCode.NOT_FOUND, "Пользователь не найден")
        return await self._start_session(user)

    async def logout(self, token: str | None) -> None:
        if token:
            await self.sessions.delete(hash_session_token(token))
            await self.session.commit()

    async def user_by_token(self, token: str | None) -> User | None:
        if not token:
            return None
        found = await self.sessions.get_active(hash_session_token(token), datetime.now(UTC))
        if found is None or not found.user.is_active:
            return None
        return found.user

    async def demo_accounts(self) -> list[User]:
        if not self.settings.demo_login_enabled:
            return []
        return await self.users.list_demo()

    async def _start_session(self, user: User) -> LoginResult:
        now = datetime.now(UTC)
        await self.sessions.delete_expired(user.id, now)
        token = new_session_token()
        self.sessions.add(
            AuthSession(
                token_hash=hash_session_token(token),
                user_id=user.id,
                expires_at=now + timedelta(seconds=self.settings.session_ttl_seconds),
            )
        )
        await self.session.commit()
        return LoginResult(user=user, token=token)


def ensure_authenticated(user: User | None) -> User:
    if user is None:
        raise AppError(ErrorCode.AUTH_REQUIRED)
    return user


def ensure_admin(user: User | None) -> User:
    user = ensure_authenticated(user)
    if not user.is_admin:
        raise AppError(ErrorCode.FORBIDDEN, "Это доступно только администратору")
    return user
