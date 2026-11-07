"""Привязка аккаунта к ботам Telegram и VK: одноразовые коды, личные ключи `stb_…`, лимиты.

Два пути:
- код с сайта: сайт выдаёт код (`link-code`), бот приносит его вместе с чатом (`link`) и получает ключ;
- код из бота: бот получает код для чата (`pending`), человек вводит его на сайте (`claim`),
  бот опрашивает код и забирает ключ ровно один раз.

Ключ живёт 365 дней, в базе только sha256 — как токен сессии. Коды из шести цифр перебираются
мгновенно, поэтому в базе HMAC кода с секретом бота, а ошибки ввода ограничены лимитом.
"""

import hashlib
import hmac
import math
import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TypeGuard

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.security import hash_token
from app.db.models import BotCode, BotCodeKind, BotLink, BotPlatform, User
from app.db.repositories.bots import BotCodeRepository, BotLinkRepository
from app.db.repositories.users import UserRepository

KEY_PREFIX = "stb_"
KEY_TTL = timedelta(days=365)
CODE_TTL = timedelta(minutes=10)
TOUCH_EVERY = timedelta(minutes=1)
CODE_DIGITS = 6

# Окно в секундах и сколько запросов в нём можно.
LINK_CODE_RULE = (600, 5)
ATTEMPT_RULE = (60, 20)
POLL_RULE = (60, 60)
FAILURE_RULE = (600, 10)

CODE_INVALID = "Код не подошёл"
CODE_EXPIRED_SITE = "Код устарел. Получите новый на сайте"
CODE_EXPIRED_BOT = "Код устарел. Получите новый в боте"
CODE_USED_BOT = "Код уже использован. Получите новый в боте"


def bots_disabled() -> AppError:
    return AppError(ErrorCode.BOTS_DISABLED, "Подключение мессенджеров сейчас выключено")


def code_invalid() -> AppError:
    return AppError(ErrorCode.CODE_INVALID, CODE_INVALID)


def is_bot_key(token: str | None) -> TypeGuard[str]:
    return token is not None and token.startswith(KEY_PREFIX)


def new_bot_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def normalize_code(raw: str) -> str | None:
    """«123 456», «123-456» → «123456»; не шесть цифр — None."""
    digits = "".join(ch for ch in raw if ch not in " -")
    if len(digits) != CODE_DIGITS or not digits.isascii() or not digits.isdigit():
        return None
    return digits


class BotLimiter:
    """Счётчики попыток привязки в памяти: бэкенд работает одним процессом."""

    max_keys = 10_000

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._hits: dict[str, deque[float]] = {}

    def _recent(self, key: str, window: int, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= window:
            hits.popleft()
        return hits

    def _prune(self, now: float) -> None:
        if len(self._hits) <= self.max_keys:
            return
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] >= 3600]:  # noqa: PLR2004
            del self._hits[key]

    def _wait(self, key: str, rule: tuple[int, int], now: float) -> int:
        window, limit = rule
        hits = self._recent(key, window, now)
        if len(hits) < limit:
            return 0
        return max(1, math.ceil(window - (now - hits[len(hits) - limit])))

    def check(self, key: str, rule: tuple[int, int]) -> None:
        """Отказ с 429, если окно уже заполнено; сам запрос не учитывается."""
        wait = self._wait(key, rule, self.clock())
        if wait:
            raise rate_limited(wait)

    def take(self, key: str, rule: tuple[int, int]) -> None:
        self.check(key, rule)
        self.hit(key)

    def hit(self, key: str) -> None:
        now = self.clock()
        self._hits.setdefault(key, deque()).append(now)
        self._prune(now)


def rate_limited(wait: int) -> AppError:
    return AppError(
        ErrorCode.RATE_LIMITED,
        f"Слишком много попыток. Повторите через {wait} сек.",
        extra={"retryAfter": wait},
        headers={"Retry-After": str(wait)},
    )


@dataclass(frozen=True, slots=True)
class IssuedCode:
    code: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class IssuedKey:
    token: str
    user: User


@dataclass(frozen=True, slots=True)
class Claimed:
    platform: str
    display_name: str


@dataclass(frozen=True, slots=True)
class PendingStatus:
    key: IssuedKey | None


@dataclass(frozen=True, slots=True)
class Chat:
    platform: BotPlatform
    external_id: str
    display_name: str = ""


class BotService:
    def __init__(self, session: AsyncSession, settings: Settings, limiter: BotLimiter) -> None:
        self.session = session
        self.settings = settings
        self.limiter = limiter
        self.links = BotLinkRepository(session)
        self.codes = BotCodeRepository(session)
        self.users = UserRepository(session)

    # ---------- Секрет и настройки ----------

    def _secret(self) -> str:
        secret = self.settings.bot_api_secret.get_secret_value()
        if not secret:
            raise bots_disabled()
        return secret

    def ensure_enabled(self) -> None:
        self._secret()

    def verify_bot(self, given: str | None) -> None:
        """Запрос от бота: секрет из `X-Bot-Secret`, сравнение за постоянное время."""
        secret = self._secret()
        if not given or not hmac.compare_digest(given.encode(), secret.encode()):
            raise AppError(ErrorCode.BOT_SECRET, "Неверный секрет бота")

    def link_url(self, platform: BotPlatform, code: str) -> str | None:
        if platform == BotPlatform.TELEGRAM:
            username = self.settings.telegram_bot_username
            return f"https://t.me/{username}?start={code}" if username else None
        return f"https://vk.me/club{self.settings.vk_group_id}?ref={code}"

    def _code_hash(self, kind: BotCodeKind, code: str) -> str:
        message = f"{kind}:{code}".encode()
        return hmac.new(self._secret().encode(), message, hashlib.sha256).hexdigest()

    # ---------- Лимиты ----------

    def _attempt(self, key: str, rule: tuple[int, int] = ATTEMPT_RULE) -> None:
        """Лимит запросов и перебора кодов: после 10 неверных кодов — пауза до конца окна."""
        self.limiter.check(f"fail:{key}", FAILURE_RULE)
        self.limiter.take(f"{rule[0]}:{rule[1]}:{key}", rule)

    def _failed(self, key: str) -> None:
        self.limiter.hit(f"fail:{key}")

    async def _code(self, key: str, raw: str, kind: BotCodeKind, now: datetime) -> BotCode:
        """Найти код или отказать: неверный и повторный — 400, истёкший — 410. Неверный считается попыткой."""
        code = normalize_code(raw)
        found = await self.codes.find(self._code_hash(kind, code), kind, now) if code else None
        if found is None:
            self._failed(key)
            raise code_invalid()
        return found

    # ---------- Код с сайта ----------

    async def issue_site_code(self, user: User, platform: BotPlatform) -> IssuedCode:
        self.ensure_enabled()
        now = datetime.now(UTC)
        window, limit = LINK_CODE_RULE
        recent = await self.codes.site_codes_since(user.id, now - timedelta(seconds=window))
        if len(recent) >= limit:
            wait = window - (now - recent[len(recent) - limit]).total_seconds()
            raise rate_limited(max(1, math.ceil(wait)))
        code = await self._new_code(BotCodeKind.SITE, now)
        expires_at = now + CODE_TTL
        await self.codes.add(
            BotCode(
                code_hash=self._code_hash(BotCodeKind.SITE, code),
                kind=BotCodeKind.SITE,
                platform=platform,
                user_id=user.id,
                created_at=now,
                expires_at=expires_at,
            )
        )
        await self.session.commit()
        return IssuedCode(code, expires_at)

    async def link(self, ip: str, raw_code: str, chat: Chat) -> IssuedKey:
        """Бот принёс код с сайта: привязать чат и выдать ключ."""
        key = f"{ip}|{chat.platform}:{chat.external_id}"
        self._attempt(key)
        now = datetime.now(UTC)
        found = await self._code(key, raw_code, BotCodeKind.SITE, now)
        if found.used_at is not None or found.platform != chat.platform or found.user_id is None:
            self._failed(key)
            raise code_invalid()
        if found.expires_at <= now:
            raise AppError(ErrorCode.CODE_EXPIRED, CODE_EXPIRED_SITE)
        user = await self.users.get(found.user_id)
        if user is None or not user.is_active:
            raise code_invalid()
        issued = await self._create_link(user, chat, now)
        found.used_at = now
        found.link_id = issued[0].id
        found.external_id = chat.external_id
        found.display_name = chat.display_name
        await self.session.commit()
        return IssuedKey(issued[1], user)

    # ---------- Код из бота ----------

    async def issue_bot_code(self, ip: str, chat: Chat) -> IssuedCode:
        key = f"{ip}|{chat.platform}:{chat.external_id}"
        self._attempt(key)
        now = datetime.now(UTC)
        await self.codes.expire_pending(chat.platform, chat.external_id, now)
        code = await self._new_code(BotCodeKind.BOT, now)
        expires_at = now + CODE_TTL
        await self.codes.add(
            BotCode(
                code_hash=self._code_hash(BotCodeKind.BOT, code),
                kind=BotCodeKind.BOT,
                platform=chat.platform,
                external_id=chat.external_id,
                display_name=chat.display_name,
                created_at=now,
                expires_at=expires_at,
            )
        )
        await self.session.commit()
        return IssuedCode(code, expires_at)

    async def claim(self, ip: str, user: User, raw_code: str) -> Claimed:
        """Человек ввёл на сайте код из бота. Ключ заберёт бот при следующем опросе."""
        self.ensure_enabled()
        key = f"{ip}|site"
        self._attempt(key)
        now = datetime.now(UTC)
        found = await self._code(key, raw_code, BotCodeKind.BOT, now)
        if found.used_at is not None or found.user_id is not None:
            self._failed(key)
            raise code_invalid()
        if found.expires_at <= now:
            raise AppError(ErrorCode.CODE_EXPIRED, CODE_EXPIRED_BOT)
        found.user_id = user.id
        # Боту нужно время, чтобы заметить подтверждение и забрать ключ.
        found.expires_at = now + CODE_TTL
        await self.session.commit()
        return Claimed(found.platform, found.display_name)

    async def poll(self, ip: str, raw_code: str, chat: Chat) -> PendingStatus:
        key = f"{ip}|{chat.platform}:{chat.external_id}"
        self._attempt(key, POLL_RULE)
        now = datetime.now(UTC)
        found = await self._code(key, raw_code, BotCodeKind.BOT, now)
        if found.platform != chat.platform or found.external_id != chat.external_id:
            self._failed(key)
            raise code_invalid()
        if found.used_at is not None:
            raise AppError(ErrorCode.CODE_EXPIRED, CODE_USED_BOT)
        if found.expires_at <= now:
            raise AppError(ErrorCode.CODE_EXPIRED, CODE_EXPIRED_BOT)
        if found.user_id is None:
            await self.session.rollback()
            return PendingStatus(None)
        user = await self.users.get(found.user_id)
        if user is None or not user.is_active:
            raise code_invalid()
        link, token = await self._create_link(
            user, Chat(chat.platform, chat.external_id, found.display_name), now
        )
        found.used_at = now
        found.link_id = link.id
        await self.session.commit()
        return PendingStatus(IssuedKey(token, user))

    # ---------- Ключи ----------

    async def user_by_key(self, token: str | None) -> User | None:
        """Владелец ключа бота. Отозванный, просроченный или чужой формат — None, как невалидная сессия."""
        if not is_bot_key(token):
            return None
        now = datetime.now(UTC)
        found = await self.links.active_by_hash(hash_token(token), now - KEY_TTL)
        if found is None:
            return None
        link, user = found
        if link.platform != BotPlatform.VK:
            return None
        if link.last_used_at is None or link.last_used_at < now - TOUCH_EVERY:
            await self.links.touch(link.id, now, now - TOUCH_EVERY)
            await self.session.commit()
        return user

    async def list_links(self, user: User) -> list[BotLink]:
        return [
            link
            for link in await self.links.list_active(user.id, datetime.now(UTC) - KEY_TTL)
            if link.platform == BotPlatform.VK
        ]

    async def revoke(self, user: User, link_id: str) -> None:
        if not await self.links.revoke(link_id, user.id, datetime.now(UTC)):
            raise AppError(ErrorCode.NOT_FOUND, "Такого подключения нет")
        await self.session.commit()

    async def unlink(self, token: str | None) -> None:
        """Бот отключается сам: отзывает ключ, с которым пришёл запрос."""
        if not is_bot_key(token):
            raise AppError(ErrorCode.AUTH_REQUIRED)
        now = datetime.now(UTC)
        found = await self.links.active_by_hash(hash_token(token), now - KEY_TTL)
        if found is None:
            raise AppError(ErrorCode.AUTH_REQUIRED)
        await self.links.revoke(found[0].id, found[0].user_id, now)
        await self.session.commit()

    # ---------- Внутреннее ----------

    async def _new_code(self, kind: BotCodeKind, now: datetime) -> str:
        """Случайный код, которого нет среди действующих кодов того же вида."""
        await self.codes.lock_codes()
        while True:
            code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
            if not await self.codes.has_active(self._code_hash(kind, code), now):
                return code

    async def _create_link(self, user: User, chat: Chat, now: datetime) -> tuple[BotLink, str]:
        """Новая привязка чата отзывает прежнюю, даже если она была к другому аккаунту."""
        await self.links.lock_chat(chat.platform, chat.external_id)
        await self.links.revoke_chat(chat.platform, chat.external_id, now)
        token = new_bot_key()
        link = await self.links.add(
            BotLink(
                user_id=user.id,
                platform=chat.platform,
                external_id=chat.external_id,
                display_name=chat.display_name,
                token_hash=hash_token(token),
                created_at=now,
            )
        )
        return link, token
