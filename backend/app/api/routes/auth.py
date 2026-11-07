import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy import Delete, Insert, Update, delete, func, insert, update

from app.api.cookies import clear_session_cookie, set_session_cookie
from app.api.deps import (
    AuthServiceDep,
    CurrentUser,
    EmailServiceDep,
    MailerDep,
    SessionDep,
    SettingsDep,
    TokenDep,
)
from app.api.routes.domain import run_domain
from app.api.routes.robots import site_url
from app.api.schemas.auth import (
    AuthConfigOut,
    DeleteAccountIn,
    DemoInfo,
    DemoLoginIn,
    EmailIn,
    LoginIn,
    OkOut,
    PhoneCodeIn,
    PhoneSendIn,
    PhoneSentOut,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    TokenIn,
    UserOut,
    VerificationSentOut,
)
from app.api.schemas.common import ERROR_RESPONSES
from app.core.security import MIN_PASSWORD, hash_password, verify_password
from app.db.models import (
    AiRequest,
    AuthSession,
    ConsentKind,
    EmailStatus,
    EmailToken,
    PhoneCode,
    PhoneStatus,
    User,
    UserConsent,
)
from app.db.repositories.email import EmailStatusRepository
from app.domain.lib.cities import city_by_id
from app.domain import core, provider, store
from app.domain.errors import fail
from app.domain.features import account
from app.mail import Mailer, OutgoingMail
from app.services.auth import LoginResult
from app.services.email_policy import email_domain, foreign_email_message, is_allowed_email
from app.services.phone import PhoneService
from app.sms import SmsSender, build_sms_sender

router = APIRouter(tags=["вход"], responses=ERROR_RESPONSES)
log = logging.getLogger(__name__)

# Редакция документов на /legal: меняется вместе с текстами, журнал согласий хранит принятую редакцию.
LEGAL_VERSION = "2026-11-03"

def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def consents_insert(user_id: str, ip: str | None) -> Insert:
    """Доказательство согласий (152-ФЗ, ст. 9 ч. 3): три отметки формы, редакция и IP; время — в базе."""
    return insert(UserConsent).values(
        [{"user_id": user_id, "kind": kind, "version": LEGAL_VERSION, "ip": ip} for kind in ConsentKind]
    )


def forget_statements(user_id: str) -> list[Delete | Update]:
    """Удаление аккаунта у сервиса входа: сессии, коды почты и SMS, вход закрыт, согласия отозваны."""
    return [
        delete(AuthSession).where(AuthSession.user_id == user_id),
        delete(EmailToken).where(EmailToken.user_id == user_id),
        delete(EmailStatus).where(EmailStatus.user_id == user_id),
        delete(PhoneCode).where(PhoneCode.user_id == user_id),
        delete(PhoneStatus).where(PhoneStatus.user_id == user_id),
        update(User).where(User.id == user_id).values(is_active=False, password_hash=None),
        update(UserConsent)
        .where(UserConsent.user_id == user_id, UserConsent.revoked_at.is_(None))
        .values(revoked_at=func.now()),
        # Журнал помощника хранит только метрики; связь с человеком больше не нужна.
        update(AiRequest).where(AiRequest.user_id == user_id).values(user_id=None),
    ]


def user_out(user: User) -> UserOut:
    demo = None
    if user.demo_order is not None:
        demo = DemoInfo(title=user.demo_title or "", hint=user.demo_hint or "", order=user.demo_order)
    return UserOut(id=user.id, name=user.name, email=user.email, role=user.role, demo=demo)  # type: ignore[arg-type]


async def session_out(request: Request, result: LoginResult) -> SessionOut:
    """Ответ входа: пользователь, токен сессии и `Identity` в форме контракта API."""
    identity = await run_domain(
        request, lambda: core.domain.identity(provider.actor()), write=False, user_id=result.user.id
    )
    return SessionOut(**user_out(result.user).model_dump(), token=result.token, identity=identity)


def sms_sender(request: Request, settings: SettingsDep) -> SmsSender:
    """Отправитель SMS создаётся при первом запросе; тесты подменяют его в `app.state.sms`."""
    sender = getattr(request.app.state, "sms", None)
    if sender is None:
        sender = request.app.state.sms = build_sms_sender(settings)
    return sender


def get_phone_service(
    session: SessionDep, settings: SettingsDep, sender: Annotated[SmsSender, Depends(sms_sender)]
) -> PhoneService:
    return PhoneService(session, settings, sender)


PhoneServiceDep = Annotated[PhoneService, Depends(get_phone_service)]


def send_later(background: BackgroundTasks, mailer: Mailer, mail: OutgoingMail | None) -> None:
    """Письмо уходит после ответа: SMTP не задерживает экран, а время ответа не выдаёт, есть ли адрес."""
    if mail is not None:
        background.add_task(mailer.send, mail)


@router.get("/auth/config")
async def auth_config(settings: SettingsDep) -> AuthConfigOut:
    return AuthConfigOut(
        email_verification=settings.email_verification,
        password_reset=settings.mail_enabled or settings.email_verification,
        phone_verification=settings.phone_verification,
    )


@router.post("/auth/login")
async def login(
    body: LoginIn, request: Request, auth: AuthServiceDep, settings: SettingsDep, response: Response
) -> SessionOut:
    result = await auth.login_with_password(body.email, body.password)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/demo-login")
async def demo_login(
    body: DemoLoginIn, request: Request, auth: AuthServiceDep, settings: SettingsDep, response: Response
) -> SessionOut:
    result = await auth.login_demo(body.user_id)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/register", responses={202: {"model": VerificationSentOut}})
async def register(  # noqa: PLR0913, PLR0917
    body: RegisterIn,
    request: Request,
    auth: AuthServiceDep,
    emails: EmailServiceDep,
    mailer: MailerDep,
    settings: SettingsDep,
    response: Response,
    background: BackgroundTasks,
) -> SessionOut | VerificationSentOut:
    """Регистрация (имя, почта без повторов, район, интересы).

    Без подтверждения почты — сразу вход. С подтверждением (EMAIL_VERIFICATION) — письмо со ссылкой,
    сессия начнётся после перехода по ней. Пароль обязателен: без пароля в демо-режиме входят по почте
    только вымышленные аккаунты демо-данных, и зарегистрированный аккаунт так открыть нельзя.
    """
    verification = settings.email_verification
    email = (body.email or "").strip()
    if verification and email_domain(email) is None:
        fail("validation", "Укажите почту", {"email": "На неё придёт письмо для входа"})
    if email and not is_allowed_email(email):
        message = foreign_email_message(email)
        fail("validation", message, {"email": message})
    if not (body.accept_terms and body.personal_data_consent and body.public_profile_consent):
        fail(
            "validation",
            "Отметьте согласия под формой: без них аккаунт создать нельзя",
            {"consents": "Нужны все три отметки"},
        )
    password = body.password or ""
    if len(password) < MIN_PASSWORD:
        message = "Пароль слишком короткий" if password else "Придумайте пароль"
        fail("validation", message, {"password": f"Не короче {MIN_PASSWORD} символов"})
    # argon2 нагружает процессор, поэтому не блокируем цикл событий.
    password_hash = await asyncio.to_thread(hash_password, password)
    payload = body.model_dump(
        by_alias=True,
        exclude={"password", "accept_terms", "personal_data_consent", "public_profile_consent"},
        exclude_none=True,
    )
    ip = client_ip(request)

    def create() -> str:
        city = city_by_id(request.headers.get("x-city"))
        if city is not None:
            payload["city"] = city["name"]
        user = core.domain.register(payload)
        after = store.data().after_commit_sql
        after.append(consents_insert(user["id"], ip))
        after.append(update(User).where(User.id == user["id"]).values(password_hash=password_hash))
        if verification:
            after.append(EmailStatusRepository.pending_insert(user["id"]))
        return user["id"]

    user_id = await run_domain(request, create, write=True)
    if verification:
        mail = await emails.registration_mail(user_id, site_url(request))
        send_later(background, mailer, mail)
        response.status_code = status.HTTP_202_ACCEPTED
        return VerificationSentOut(email=mail.to)
    result = await auth.login_registered(user_id)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/verify-email")
async def verify_email(  # noqa: PLR0913, PLR0917
    body: TokenIn,
    request: Request,
    emails: EmailServiceDep,
    auth: AuthServiceDep,
    settings: SettingsDep,
    response: Response,
) -> SessionOut:
    """Переход по ссылке из письма: почта подтверждена, человек сразу вошёл."""
    user = await emails.verify(body.token)
    result = await auth.login_registered(user.id)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/resend-verification")
async def resend_verification(
    body: EmailIn, request: Request, emails: EmailServiceDep, mailer: MailerDep, background: BackgroundTasks
) -> OkOut:
    """Ответ одинаковый для любого адреса: не раскрываем, кто зарегистрирован."""
    send_later(background, mailer, await emails.resend_verification(body.email, site_url(request)))
    return OkOut()


@router.post("/auth/phone/send")
async def send_phone_code(body: PhoneSendIn, request: Request, phones: PhoneServiceDep) -> PhoneSentOut:
    """Код по SMS, если письмо не дошло. Почта и пароль — как при входе, иначе 401.

    Код уходит, только если почта ждёт подтверждения и письмо ей уже отправлялось; ответ одинаковый.
    """
    await phones.send_code(body.email, body.password, body.phone, client_ip(request))
    return PhoneSentOut()


@router.post("/auth/phone/verify")
async def verify_phone_code(  # noqa: PLR0913, PLR0917
    body: PhoneCodeIn,
    request: Request,
    phones: PhoneServiceDep,
    auth: AuthServiceDep,
    settings: SettingsDep,
    response: Response,
) -> SessionOut:
    """Верный код из SMS подтверждает аккаунт, человек сразу вошёл — как по ссылке из письма."""
    user = await phones.verify_code(body.email, body.phone, body.code)
    result = await auth.login_registered(user.id)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/password/forgot")
async def forgot_password(
    body: EmailIn, request: Request, emails: EmailServiceDep, mailer: MailerDep, background: BackgroundTasks
) -> OkOut:
    """Ответ одинаковый для любого адреса: не раскрываем, кто зарегистрирован."""
    send_later(background, mailer, await emails.forgot_password(body.email, site_url(request)))
    return OkOut()


@router.post("/auth/password/reset")
async def reset_password(  # noqa: PLR0913, PLR0917
    body: ResetPasswordIn,
    request: Request,
    emails: EmailServiceDep,
    auth: AuthServiceDep,
    settings: SettingsDep,
    response: Response,
) -> SessionOut:
    """Новый пароль по ссылке из письма: прочие сессии закрыты, человек сразу вошёл."""
    user = await emails.reset_password(body.token, body.password)
    result = await auth.login_registered(user.id)
    set_session_cookie(response, result.token, settings)
    return await session_out(request, result)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(auth: AuthServiceDep, settings: SettingsDep, token: TokenDep, response: Response) -> None:
    await auth.logout(token)
    clear_session_cookie(response, settings)


@router.post("/auth/delete-account")
async def delete_account(
    body: DeleteAccountIn, request: Request, user: CurrentUser, settings: SettingsDep, response: Response
) -> OkOut:
    """Удалить свой аккаунт (152-ФЗ, ст. 21 ч. 5). Подтверждение — паролем.

    Доменные правила отменяют записи и свои встречи и обезличивают профиль (app/domain/features/account.py),
    здесь же, в той же транзакции, закрывается вход и отзываются согласия.
    """
    if user.password_hash is None:
        # Аккаунт без пароля входит по почте только в демо-режиме: подтверждать нечем, хватает сессии.
        if not settings.demo_login_enabled:
            fail(
                "validation",
                "У аккаунта нет пароля",
                {"password": "Задайте пароль через «Забыли пароль?» на странице входа и повторите"},
            )
    elif not await verify_password(user.password_hash, body.password):
        fail("validation", "Пароль не подошёл", {"password": "Проверьте пароль: тот же, что при входе"})
    user_id = user.id

    def remove() -> None:
        account.delete_account(core.domain, provider.actor())
        store.data().after_commit_sql.extend(forget_statements(user_id))

    await run_domain(request, remove, write=True)
    log.info("account deleted user=%s", user_id)
    clear_session_cookie(response, settings)
    return OkOut()


@router.get("/auth/me")
async def me(user: CurrentUser) -> UserOut:
    return user_out(user)
