from typing import Any, Literal

from pydantic import Field, field_validator

from app.api.schemas.base import ApiModel
from app.services.phone import CODE_TTL, RESEND_SECONDS, normalize_phone


class LoginIn(ApiModel):
    email: str = Field(min_length=3, max_length=254)
    # Пустой пароль — вход в демо-аккаунт по почте (только при DEMO_LOGIN_ENABLED).
    password: str = Field(default="", max_length=128)


class DeleteAccountIn(ApiModel):
    # Пароль подтверждает, что удаляет владелец. У аккаунтов без пароля (демо-режим) — пусто.
    password: str = Field(default="", max_length=128)


class DemoLoginIn(ApiModel):
    user_id: str = Field(min_length=1, max_length=64)


class DemoInfo(ApiModel):
    title: str
    hint: str
    order: float


class UserOut(ApiModel):
    id: str
    name: str
    email: str
    role: Literal["user", "admin"]
    demo: DemoInfo | None = None


class RegisterIn(ApiModel):
    """Регистрация (`RegisterInput`). Пароль обязателен: длину с понятным текстом проверяет маршрут."""

    name: str = Field(max_length=200)
    email: str | None = Field(default=None, max_length=254)
    password: str | None = Field(default=None, max_length=128)
    district_id: str | None = Field(default=None, max_length=64)
    interests: list[str] | None = Field(default=None, max_length=50)
    level: str | None = Field(default=None, max_length=32)
    # Согласия 152-ФЗ, каждое отдельной отметкой (документы — на /legal). Без них аккаунт не создаётся.
    accept_terms: bool = False
    personal_data_consent: bool = False
    public_profile_consent: bool = False


class SessionOut(UserOut):
    """Вход выполнен: токен для заголовка Authorization (своя сессия у каждой вкладки) и `Identity`."""

    token: str
    identity: dict[str, Any] | None = None


class VerificationSentOut(ApiModel):
    """Регистрация с подтверждением почты: сессии ещё нет, письмо отправлено."""

    status: Literal["verification_sent"] = "verification_sent"
    email: str


class TokenIn(ApiModel):
    token: str = Field(max_length=200)


class EmailIn(ApiModel):
    email: str = Field(min_length=3, max_length=254)


class ResetPasswordIn(ApiModel):
    token: str = Field(max_length=200)
    password: str = Field(max_length=128)


class OkOut(ApiModel):
    ok: bool = True


class AuthConfigOut(ApiModel):
    email_verification: bool
    password_reset: bool
    # Можно подтвердить аккаунт кодом по SMS, если письмо не дошло.
    phone_verification: bool


class PhoneIn(EmailIn):
    phone: str = Field(max_length=32)

    @field_validator("phone")
    @classmethod
    def _normalize_phone(cls, value: str) -> str:
        return normalize_phone(value)


class PhoneSendIn(PhoneIn):
    # Код получает только владелец аккаунта: пароль проверяется, как при входе.
    password: str = Field(min_length=1, max_length=128)


class PhoneCodeIn(PhoneIn):
    code: str = Field(min_length=1, max_length=16)


class PhoneSentOut(ApiModel):
    """Код отправлен (или запрос принят без отправки — ответ одинаковый)."""

    ok: bool = True
    resend_in: int = RESEND_SECONDS
    expires_in: int = int(CODE_TTL.total_seconds())
