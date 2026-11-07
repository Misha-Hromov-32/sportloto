from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.ai import AiService
from app.core.config import Settings
from app.db.models import User
from app.db.session import Database
from app.mail import Mailer
from app.realtime import Broker
from app.services.auth import AuthService, ensure_admin, ensure_authenticated
from app.services.bots import BotLimiter, BotService, is_bot_key
from app.services.email import EmailService


# HTTPConnection, а не Request: общие зависимости роутера /api (touch_bot_key) работают и на WebSocket
# моста чат-бота, где объекта Request нет.
def get_settings(request: HTTPConnection) -> Settings:
    return request.app.state.settings


def get_database(request: HTTPConnection) -> Database:
    return request.app.state.db


def get_broker(request: Request) -> Broker:
    return request.app.state.broker


def get_ai(request: Request) -> AiService:
    return request.app.state.ai


async def get_session(db: Annotated[Database, Depends(get_database)]) -> AsyncIterator[AsyncSession]:
    async with db.sessionmaker() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings)]
DatabaseDep = Annotated[Database, Depends(get_database)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
BrokerDep = Annotated[Broker, Depends(get_broker)]
AiDep = Annotated[AiService, Depends(get_ai)]


def session_token(request: HTTPConnection, settings: SettingsDep) -> str | None:
    """Заголовок `Authorization: Bearer …` (у каждой вкладки своя сессия) или cookie сессии."""
    header = request.headers.get("authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip() or None
    return request.cookies.get(settings.session_cookie_name)


TokenDep = Annotated[str | None, Depends(session_token)]


def get_auth_service(session: SessionDep, settings: SettingsDep) -> AuthService:
    return AuthService(session, settings)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_mailer(request: Request) -> Mailer:
    return request.app.state.mailer


def get_email_service(request: Request, session: SessionDep, settings: SettingsDep) -> EmailService:
    return EmailService(session, settings, request.app.state.mail_limiter)


MailerDep = Annotated[Mailer, Depends(get_mailer)]
EmailServiceDep = Annotated[EmailService, Depends(get_email_service)]


def get_bot_limiter(request: Request) -> BotLimiter:
    limiter = getattr(request.app.state, "bot_limiter", None)
    if limiter is None:
        limiter = request.app.state.bot_limiter = BotLimiter()
    return limiter


def get_bot_service(request: Request, session: SessionDep, settings: SettingsDep) -> BotService:
    return BotService(session, settings, get_bot_limiter(request))


BotServiceDep = Annotated[BotService, Depends(get_bot_service)]


async def user_by_any_token(session: AsyncSession, settings: Settings, token: str | None) -> User | None:
    """Владелец сессии вкладки или ключа бота `stb_…` — ключ принимается везде, где принимается вход."""
    if is_bot_key(token):
        return await BotService(session, settings, BotLimiter()).user_by_key(token)
    return await AuthService(session, settings).user_by_token(token)


async def get_optional_user(session: SessionDep, settings: SettingsDep, token: TokenDep) -> User | None:
    return await user_by_any_token(session, settings, token)


async def touch_bot_key(db: DatabaseDep, settings: SettingsDep, token: TokenDep) -> None:
    """Отметка «последний раз пользовались» для ключа бота на любом запросе /api, в том числе доменном.

    Своя короткая сессия БД: зависимость общая для всех маршрутов, включая долгий SSE.
    """
    if is_bot_key(token):
        async with db.sessionmaker() as session:
            await BotService(session, settings, BotLimiter()).user_by_key(token)


async def get_current_user(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    return ensure_authenticated(user)


async def get_admin(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    return ensure_admin(user)


OptionalUser = Annotated[User | None, Depends(get_optional_user)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_admin)]


async def get_stream_user(
    request: Request, db: DatabaseDep, settings: SettingsDep, token: TokenDep
) -> User | None:
    """Пользователь для долгого SSE-соединения: короткая сессия БД, чтобы не держать подключение часами.

    EventSource не умеет задавать заголовки, поэтому токен вкладки приходит параметром `access_token`.
    """
    token = token or request.query_params.get("access_token") or None
    async with db.sessionmaker() as session:
        return await user_by_any_token(session, settings, token)


StreamUser = Annotated[User | None, Depends(get_stream_user)]
