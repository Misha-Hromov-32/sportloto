from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import User, UserRole
from app.db.repositories.users import UserRepository


async def create_user(  # noqa: PLR0913
    session: AsyncSession,
    *,
    email: str,
    name: str,
    password: str | None = None,
    role: UserRole = UserRole.USER,
    user_id: str | None = None,
    demo: tuple[int, str, str] | None = None,
) -> User:
    """Создать пользователя. `demo` — (порядок, заголовок, подсказка) для переключателя демо-аккаунтов.

    Используется сидами и будущей регистрацией; коммит — за вызывающим кодом.
    """
    user = User(
        email=email.strip().lower(),
        name=name.strip(),
        role=role,
        password_hash=hash_password(password) if password else None,
    )
    if user_id is not None:
        user.id = user_id
    if demo is not None:
        user.demo_order, user.demo_title, user.demo_hint = demo
    UserRepository(session).add(user)
    await session.flush()
    return user
