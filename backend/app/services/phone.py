"""Подтверждение аккаунта кодом по SMS — запасной путь, если письмо со ссылкой не дошло."""

import hashlib
import hmac
import logging
import math
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security import verify_password
from app.db.models import PhoneCode, User
from app.db.repositories.email import EmailStatusRepository
from app.db.repositories.phone import PhoneCodeRepository, PhoneStatusRepository
from app.db.repositories.users import UserRepository
from app.services.email import normalize_email
from app.sms import SmsError, SmsSender

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=5)
RESEND_SECONDS = 60
MAX_ATTEMPTS = 5
DAY = timedelta(days=1)
# Окно в секундах и сколько запросов кода в нём можно.
PHONE_RULES = ((RESEND_SECONDS, 1), (3600, 3), (86400, 5))
USER_RULES = ((86400, 5),)
IP_RULES = ((86400, 10),)

PHONE_HINT = "Введите российский мобильный номер, например +7 912 345-67-89"
_PHONE_CHARS = re.compile(r"^\+?[\d\s()\-]+$")

# Без SMS_CODE_PEPPER — случайный секрет процесса: коды, выданные до перезапуска, перестанут подходить.
_RUNTIME_PEPPER = secrets.token_hex(32)


def normalize_phone(raw: str) -> str:
    """Российский мобильный к виду +79XXXXXXXXX: «+7 912…», «8 912…», «912…». Иначе ValueError."""
    value = raw.strip()
    if not _PHONE_CHARS.match(value):
        raise ValueError(PHONE_HINT)
    digits = re.sub(r"\D", "", value)
    if value.startswith("+"):
        valid = len(digits) == 11 and digits.startswith("79")  # noqa: PLR2004
    elif len(digits) == 11:  # noqa: PLR2004
        valid = digits[:2] in {"79", "89"}
    else:
        valid = len(digits) == 10 and digits.startswith("9")  # noqa: PLR2004
    if not valid:
        raise ValueError(PHONE_HINT)
    return f"+7{digits[-10:]}"


def sms_text(code: str) -> str:
    # Одно SMS кириллицей — до 70 символов; имя сервиса в тексте обязательно для бесплатной подписи.
    return f"Спорт и точка: код {code}. Никому его не сообщайте."


def retry_wait(times: list[datetime], rules: tuple[tuple[int, int], ...], now: datetime) -> int:
    """Сколько секунд ждать, чтобы новый запрос уложился во все окна лимитов."""
    wait = 0.0
    for window, limit in rules:
        recent = [t for t in times if (now - t).total_seconds() < window]
        if len(recent) >= limit:
            oldest_to_expire = recent[len(recent) - limit]
            wait = max(wait, window - (now - oldest_to_expire).total_seconds())
    return max(0, math.ceil(wait))


def _wait_text(seconds: int) -> str:
    if seconds < 120:  # noqa: PLR2004
        return f"{seconds} сек."
    if seconds < 7200:  # noqa: PLR2004
        return f"{math.ceil(seconds / 60)} мин."
    return f"{math.ceil(seconds / 3600)} ч"


def rate_limited(wait: int) -> AppError:
    return AppError(
        ErrorCode.RATE_LIMITED,
        f"Новый код можно запросить через {_wait_text(wait)}",
        extra={"retryAfter": wait},
        headers={"Retry-After": str(wait)},
    )


class PhoneService:
    def __init__(self, session: AsyncSession, settings: Settings, sender: SmsSender) -> None:
        self.session = session
        self.settings = settings
        self.sender = sender
        self.users = UserRepository(session)
        self.codes = PhoneCodeRepository(session)
        self.phones = PhoneStatusRepository(session)
        self.emails = EmailStatusRepository(session)

    def _ensure_enabled(self) -> None:
        if not self.settings.phone_verification:
            raise AppError(ErrorCode.SMS_UNAVAILABLE)

    def _hash(self, code: str, code_id: int) -> str:
        pepper = self.settings.sms_code_pepper.get_secret_value() or _RUNTIME_PEPPER
        return hashlib.sha256(f"{pepper}{code}{code_id}".encode()).hexdigest()

    async def _authenticate(self, email: str, password: str) -> User | None:
        """Пара почта и пароль — как при входе. Демо-аккаунты и аккаунты без пароля не проходят."""
        user = await self.users.get_by_email(normalize_email(email))
        valid = await verify_password(user.password_hash if user else None, password)
        return user if user is not None and valid and user.is_active else None

    async def _waiting(self, user: User) -> bool:
        """Можно слать код: почта не подтверждена, письмо со ссылкой уже уходило."""
        status = await self.emails.get(user.id)
        if status is None or status.verified_at is not None:
            return False
        return await self.codes.verification_mailed(user.id)

    def _record_unsent(self, phone: str, ip: str | None, now: datetime) -> None:
        """Запрос без отправки остаётся в лимитах номера и IP: так ограничен и подбор пароля."""
        self.session.add(PhoneCode(phone=phone, ip=ip, created_at=now, expires_at=now))

    async def send_code(self, email: str, password: str, phone: str, ip: str | None) -> None:
        """Отправить код владельцу аккаунта: почта и пароль проверяются, как при входе.

        Лимиты на номер и IP проверяются до пароля: подбор пароля через SMS ограничен ими же.
        Для подтверждённой почты или почты без письма — тот же ответ без SMS.
        """
        self._ensure_enabled()
        now = datetime.now(UTC)
        await self.codes.lock_phone(phone)
        wait = retry_wait(await self.codes.sent_times(PhoneCode.phone == phone, now - DAY), PHONE_RULES, now)
        if ip:
            ip_times = await self.codes.sent_times(PhoneCode.ip == ip, now - DAY)
            wait = max(wait, retry_wait(ip_times, IP_RULES, now))
        if wait:
            raise rate_limited(wait)
        if await self.codes.count_sent(now - DAY) >= self.settings.sms_daily_limit:
            logger.warning(
                "Дневной лимит SMS исчерпан (%s), отправка приостановлена", self.settings.sms_daily_limit
            )
            raise AppError(ErrorCode.SMS_UNAVAILABLE)

        user = await self._authenticate(email, password)
        if user is None:
            self._record_unsent(phone, ip, now)
            await self.session.commit()
            raise AppError(ErrorCode.INVALID_CREDENTIALS)
        if not await self._waiting(user):
            self._record_unsent(phone, ip, now)
            await self.session.commit()
            return
        wait = retry_wait(
            await self.codes.sent_times(PhoneCode.user_id == user.id, now - DAY), USER_RULES, now
        )
        if wait:
            raise rate_limited(wait)

        await self.codes.expire_unused(user.id, now)
        row = await self.codes.add(
            PhoneCode(user_id=user.id, phone=phone, ip=ip, created_at=now, expires_at=now + CODE_TTL)
        )
        code = f"{secrets.randbelow(10**6):06d}"
        row.code_hash = self._hash(code, row.id)
        await self.session.commit()
        try:
            await self.sender.send(phone, sms_text(code))
        except SmsError:
            # Код до человека не дошёл — гасим его, но запрос остаётся в лимитах: это защита бюджета.
            row.expires_at = datetime.now(UTC)
            await self.session.commit()
            raise AppError(ErrorCode.SMS_FAILED) from None

    async def verify_code(self, email: str, phone: str, code: str) -> User:
        """Верный код подтверждает номер и почту. Нет кода, просрочен или кончились попытки — 410."""
        self._ensure_enabled()
        now = datetime.now(UTC)
        user = await self.users.get_by_email(normalize_email(email))
        found = await self.codes.active(user.id, phone, now) if user is not None and user.is_active else None
        if user is None or found is None or found.code_hash is None or found.attempts >= MAX_ATTEMPTS:
            raise AppError(ErrorCode.CODE_EXPIRED)
        entered = re.sub(r"\s", "", code)
        if not hmac.compare_digest(self._hash(entered, found.id), found.code_hash):
            found.attempts += 1
            left = MAX_ATTEMPTS - found.attempts
            if left <= 0:
                found.expires_at = now
            await self.session.commit()
            if left <= 0:
                raise AppError(ErrorCode.CODE_EXPIRED)
            raise AppError(
                ErrorCode.CODE_INVALID,
                f"Код не подошёл. Осталось попыток: {left}",
                extra={"attemptsLeft": left},
            )
        found.used_at = now
        await self.phones.mark_verified(user.id, phone, now)
        # SMS пришло на номер владельца аккаунта — считаем аккаунт подтверждённым, как по ссылке из письма.
        await self.emails.mark_verified(user.id, now)
        await self.session.commit()
        return user
