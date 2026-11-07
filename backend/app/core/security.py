import asyncio
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

MIN_PASSWORD = 8

# Хеш для несуществующего пользователя: проверка занимает столько же времени,
# и по задержке ответа нельзя понять, зарегистрирована ли почта.
_DUMMY_HASH = _hasher.hash("vmeste-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def _verify(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


async def verify_password(password_hash: str | None, password: str) -> bool:
    # argon2 нагружает процессор, поэтому не блокируем цикл событий.
    return await asyncio.to_thread(_verify, password_hash, password)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """В базе храним только хеш токена: утечка таблицы сессий или ссылок из писем не даёт войти."""
    return hashlib.sha256(token.encode()).hexdigest()


def hash_session_token(token: str) -> str:
    return hash_token(token)
