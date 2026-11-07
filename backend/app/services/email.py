"""Подтверждение почты и сброс пароля: одноразовые ссылки, лимиты отправки, письма."""

import asyncio
import math
import secrets
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security import MIN_PASSWORD, hash_password, hash_token
from app.db.models import EmailPurpose, EmailToken, User
from app.db.repositories.email import EmailStatusRepository, EmailTokenRepository
from app.db.repositories.users import AuthSessionRepository, UserRepository
from app.mail import OutgoingMail, templates

TOKEN_TTL = {
    EmailPurpose.VERIFY: timedelta(hours=templates.VERIFY_HOURS),
    EmailPurpose.RESET: timedelta(hours=templates.RESET_HOURS),
}
LINK_PATH = {EmailPurpose.VERIFY: "/verify-email", EmailPurpose.RESET: "/reset-password"}

VERIFY_USED = "Почта уже подтверждена. Войдите с почтой и паролем"
RESET_USED = "Ссылка уже использована. Запросите новую"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def not_verified_error(email: str) -> AppError:
    return AppError(
        ErrorCode.EMAIL_NOT_VERIFIED,
        f"Подтвердите почту: ссылка в письме, которое мы отправили на {email}",
        extra={"email": email},
    )


class SendLimiter:
    """Не чаще одного письма в минуту и пяти в час на адрес.

    Лимит считается по адресу из запроса, а не по найденному пользователю: ответ для чужого
    и несуществующего адреса одинаковый. Счётчики в памяти — бэкенд работает одним процессом.
    """

    max_keys = 10_000

    def __init__(
        self,
        *,
        interval: float = 60,
        per_hour: int = 5,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.interval = interval
        self.per_hour = per_hour
        self.clock = clock
        self._sent: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        sent = self._sent.setdefault(key, deque())
        while sent and now - sent[0] >= 3600:  # noqa: PLR2004
            sent.popleft()
        return sent

    def _prune(self, now: float) -> None:
        if len(self._sent) <= self.max_keys:
            return
        for key in [k for k, v in self._sent.items() if not v or now - v[-1] >= 3600]:  # noqa: PLR2004
            del self._sent[key]

    def retry_after(self, key: str) -> int:
        now = self.clock()
        sent = self._recent(key, now)
        wait = 0.0
        if sent:
            wait = self.interval - (now - sent[-1])
        if len(sent) >= self.per_hour:
            wait = max(wait, 3600 - (now - sent[0]))
        return max(0, math.ceil(wait))

    def hit(self, key: str) -> None:
        now = self.clock()
        self._recent(key, now).append(now)
        self._prune(now)

    def take(self, key: str) -> None:
        """Учесть отправку или отказать с 429 и временем до следующей попытки."""
        wait = self.retry_after(key)
        if wait > 0:
            raise AppError(
                ErrorCode.RATE_LIMITED,
                f"Письмо уже отправлено. Повторить можно через {wait} сек.",
                extra={"retryAfter": wait},
                headers={"Retry-After": str(wait)},
            )
        self.hit(key)


class EmailService:
    def __init__(self, session: AsyncSession, settings: Settings, limiter: SendLimiter) -> None:
        self.session = session
        self.settings = settings
        self.limiter = limiter
        self.users = UserRepository(session)
        self.tokens = EmailTokenRepository(session)
        self.statuses = EmailStatusRepository(session)
        self.sessions = AuthSessionRepository(session)

    # ---------- Письма ----------

    async def _issue(self, user: User, purpose: EmailPurpose, site: str) -> OutgoingMail:
        """Новая ссылка гасит прежние неиспользованные того же назначения."""
        now = datetime.now(UTC)
        await self.tokens.expire_unused(user.id, purpose, now)
        token = secrets.token_urlsafe(32)
        self.tokens.add(
            EmailToken(
                user_id=user.id,
                purpose=purpose,
                token_hash=hash_token(token),
                expires_at=now + TOKEN_TTL[purpose],
            )
        )
        await self.session.commit()
        link = f"{site}{LINK_PATH[purpose]}?token={quote(token)}"
        render = templates.verify_email if purpose == EmailPurpose.VERIFY else templates.reset_password
        rendered = render(user.name, link, site)
        return OutgoingMail(
            to=user.email, subject=rendered.subject, text=rendered.text, html=rendered.html, link=link
        )

    async def registration_mail(self, user_id: str, site: str) -> OutgoingMail:
        user = await self.users.get(user_id)
        if user is None:
            raise AppError(ErrorCode.NOT_FOUND, "Пользователь не найден")
        # Письмо после регистрации — первая отправка: «Отправить ещё раз» доступно через минуту.
        self.limiter.hit(f"verify:{normalize_email(user.email)}")
        return await self._issue(user, EmailPurpose.VERIFY, site)

    async def resend_verification(self, email: str, site: str) -> OutgoingMail | None:
        address = normalize_email(email)
        self.limiter.take(f"verify:{address}")
        user = await self.users.get_by_email(address)
        if user is None or not user.is_active:
            return None
        status = await self.statuses.get(user.id)
        if status is None or status.verified_at is not None:
            return None
        return await self._issue(user, EmailPurpose.VERIFY, site)

    async def forgot_password(self, email: str, site: str) -> OutgoingMail | None:
        address = normalize_email(email)
        self.limiter.take(f"reset:{address}")
        user = await self.users.get_by_email(address)
        # Демо-аккаунты и зарегистрированные без пароля входят иначе: сбрасывать нечего.
        if user is None or not user.is_active or user.is_demo or user.password_hash is None:
            return None
        return await self._issue(user, EmailPurpose.RESET, site)

    # ---------- Переход по ссылке ----------

    async def _consume(self, raw: str, purpose: EmailPurpose) -> User:
        raw = raw.strip()
        found = await self.tokens.get_by_hash(hash_token(raw), purpose) if raw else None
        user = await self.users.get(found.user_id) if found is not None else None
        if found is None or user is None or not user.is_active:
            raise AppError(ErrorCode.TOKEN_INVALID)
        used_message = VERIFY_USED if purpose == EmailPurpose.VERIFY else RESET_USED
        if found.used_at is not None:
            raise AppError(ErrorCode.TOKEN_USED, used_message)
        now = datetime.now(UTC)
        if found.expires_at <= now:
            # Старая ссылка из первого письма, а почта уже подтверждена по новой — так и скажем.
            if purpose == EmailPurpose.VERIFY and await self.statuses.is_verified(user.id):
                raise AppError(ErrorCode.TOKEN_USED, VERIFY_USED)
            raise AppError(ErrorCode.TOKEN_EXPIRED)
        found.used_at = now
        await self.session.flush()
        return user

    async def verify(self, token: str) -> User:
        user = await self._consume(token, EmailPurpose.VERIFY)
        await self.statuses.mark_verified(user.id, datetime.now(UTC))
        await self.session.commit()
        return user

    async def reset_password(self, token: str, password: str) -> User:
        if len(password) < MIN_PASSWORD:
            raise AppError(
                ErrorCode.VALIDATION,
                "Пароль слишком короткий",
                errors={"password": f"Не короче {MIN_PASSWORD} символов"},
            )
        user = await self._consume(token, EmailPurpose.RESET)
        now = datetime.now(UTC)
        # argon2 нагружает процессор, поэтому не блокируем цикл событий.
        user.password_hash = await asyncio.to_thread(hash_password, password)
        await self.tokens.expire_unused(user.id, EmailPurpose.RESET, now)
        # Кто-то мог войти со старым паролем: закрываем все сессии, новая начнётся после ответа.
        await self.sessions.delete_all(user.id)
        # Письмо дошло до этой почты — значит, она настоящая.
        await self.statuses.mark_verified(user.id, now)
        await self.session.commit()
        return user

    async def is_verified(self, user_id: str) -> bool:
        return await self.statuses.is_verified(user_id)
