"""Ошибки API: один класс, один перечень кодов и один формат ответа для всего сервера.

Ответ на любую ошибку — `{code, statusCode, message, errors?, …}`: `code` клиент использует в логике,
`message` — готовый русский текст для человека, `errors` — подсказки к полям формы. Дополнительные
поля (`similar` у `sport_similar`, `fallback` у помощника, `retryAfter` у лимитов) лежат рядом.
Модуль не зависит от FastAPI: ошибки бросают и доменные правила, обработчики — в app/api/errors.py.
"""

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    """Стабильные коды ошибок API. Совпадают с кодами, которые ждёт интерфейс."""

    # Общие
    AUTH_REQUIRED = "auth_required"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    VALIDATION = "validation"
    BAD_REQUEST = "bad_request"
    RATE_LIMIT = "rate_limit"
    SERVICE_UNAVAILABLE = "service_unavailable"
    INTERNAL = "internal"
    # Вход, почта и SMS
    INVALID_CREDENTIALS = "invalid_credentials"
    RATE_LIMITED = "rate_limited"
    EMAIL_NOT_VERIFIED = "email_not_verified"
    # Коды ошибок ссылок из писем, не пароли.
    TOKEN_INVALID = "token_invalid"  # noqa: S105
    TOKEN_EXPIRED = "token_expired"  # noqa: S105
    TOKEN_USED = "token_used"  # noqa: S105
    CODE_INVALID = "code_invalid"
    CODE_EXPIRED = "code_expired"
    SMS_FAILED = "sms_failed"
    SMS_UNAVAILABLE = "sms_unavailable"
    # Боты Telegram и VK: привязка выключена, неверный секрет бота (код ошибки, не секрет)
    BOTS_DISABLED = "bots_disabled"
    BOT_SECRET = "bot_secret"  # noqa: S105
    # Помощник
    ASSISTANT_UNAVAILABLE = "assistant_unavailable"
    # Событие и запись
    EVENT_NOT_OPEN = "event_not_open"
    EVENT_REMOVED = "event_removed"
    EVENT_CANCELLED = "event_cancelled"
    EVENT_PAST = "event_past"
    EVENT_DELETED = "event_deleted"
    EVENT_STARTED = "event_started"
    EVENT_INACTIVE = "event_inactive"
    ALREADY_JOINED = "already_joined"
    REJECTED_BEFORE = "rejected_before"
    OWN_EVENT = "own_event"
    ADMIN_CANNOT_JOIN = "admin_cannot_join"
    NO_PARTICIPATION = "no_participation"
    ALREADY_DECIDED = "already_decided"
    FULL = "full"
    HAS_PARTICIPANTS = "has_participants"
    TIME_CONFLICT = "time_conflict"
    GENDER_REQUIRED = "gender_required"
    COMPOSITION_MISMATCH = "composition_mismatch"
    NO_OFFER = "no_offer"
    INVITE_REQUIRED = "invite_required"
    # Стоп-лист организатора: не пускает на свои встречи, убрал из участников, нельзя добавить, позвать
    ORGANIZER_BLOCKED = "organizer_blocked"
    REMOVED_BEFORE = "removed_before"
    CANNOT_BLOCK = "cannot_block"
    STOP_LISTED = "stop_listed"
    # Оплата на сайте: платить не нужно, ещё рано, срок вышел, ЮKassa не ответила, вещь не продаётся
    PAYMENT_NOT_REQUIRED = "payment_not_required"
    PAYMENT_NOT_OPEN = "payment_not_open"
    PAYMENT_CLOSED = "payment_closed"
    PAYMENT_PROVIDER_ERROR = "payment_provider_error"
    NOT_FOR_SALE = "not_for_sale"
    # Организации
    ORG_NOT_APPROVED = "org_not_approved"
    ORG_WRONG_STATUS = "org_wrong_status"
    ORG_SUSPENDED = "org_suspended"
    # Модерация, обсуждение и справочники
    REASON_REQUIRED = "reason_required"
    DISCUSSION_CLOSED = "discussion_closed"
    MESSAGE_UNAVAILABLE = "message_unavailable"
    SPORT_SIMILAR = "sport_similar"
    DUPLICATE = "duplicate"
    BAD_STATE = "bad_state"
    # Справочники: запись используется (удалить нельзя) или правка выводит записи за границу города.
    IN_USE = "in_use"
    OUTSIDE_CITY = "outside_city"
    # «Ищу компанию»
    COMPANION_CLOSED = "companion_closed"
    OWN_COMPANION = "own_companion"


_STATUS: dict[ErrorCode, int] = {
    ErrorCode.AUTH_REQUIRED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.METHOD_NOT_ALLOWED: 405,
    ErrorCode.VALIDATION: 422,
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.RATE_LIMIT: 429,
    ErrorCode.SERVICE_UNAVAILABLE: 503,
    ErrorCode.INTERNAL: 500,
    ErrorCode.INVALID_CREDENTIALS: 401,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.EMAIL_NOT_VERIFIED: 403,
    ErrorCode.TOKEN_INVALID: 400,
    ErrorCode.TOKEN_EXPIRED: 410,
    ErrorCode.TOKEN_USED: 409,
    ErrorCode.CODE_INVALID: 400,
    ErrorCode.CODE_EXPIRED: 410,
    ErrorCode.SMS_FAILED: 502,
    ErrorCode.SMS_UNAVAILABLE: 503,
    ErrorCode.BOTS_DISABLED: 503,
    ErrorCode.BOT_SECRET: 401,
    ErrorCode.ASSISTANT_UNAVAILABLE: 503,
    ErrorCode.EVENT_NOT_OPEN: 409,
    ErrorCode.EVENT_REMOVED: 409,
    ErrorCode.EVENT_CANCELLED: 409,
    ErrorCode.EVENT_PAST: 409,
    ErrorCode.EVENT_DELETED: 410,
    ErrorCode.EVENT_STARTED: 409,
    ErrorCode.EVENT_INACTIVE: 409,
    ErrorCode.ALREADY_JOINED: 409,
    ErrorCode.REJECTED_BEFORE: 409,
    ErrorCode.OWN_EVENT: 409,
    ErrorCode.ADMIN_CANNOT_JOIN: 403,
    ErrorCode.NO_PARTICIPATION: 409,
    ErrorCode.ALREADY_DECIDED: 409,
    ErrorCode.FULL: 409,
    ErrorCode.HAS_PARTICIPANTS: 409,
    ErrorCode.TIME_CONFLICT: 409,
    ErrorCode.GENDER_REQUIRED: 409,
    ErrorCode.COMPOSITION_MISMATCH: 403,
    ErrorCode.NO_OFFER: 409,
    ErrorCode.INVITE_REQUIRED: 403,
    ErrorCode.ORGANIZER_BLOCKED: 409,
    ErrorCode.REMOVED_BEFORE: 409,
    ErrorCode.CANNOT_BLOCK: 409,
    ErrorCode.STOP_LISTED: 409,
    ErrorCode.PAYMENT_NOT_REQUIRED: 409,
    ErrorCode.PAYMENT_NOT_OPEN: 409,
    ErrorCode.PAYMENT_CLOSED: 409,
    ErrorCode.PAYMENT_PROVIDER_ERROR: 502,
    ErrorCode.NOT_FOR_SALE: 409,
    ErrorCode.ORG_NOT_APPROVED: 403,
    ErrorCode.ORG_WRONG_STATUS: 409,
    ErrorCode.ORG_SUSPENDED: 403,
    ErrorCode.REASON_REQUIRED: 422,
    ErrorCode.DISCUSSION_CLOSED: 403,
    ErrorCode.MESSAGE_UNAVAILABLE: 409,
    ErrorCode.SPORT_SIMILAR: 409,
    ErrorCode.DUPLICATE: 409,
    ErrorCode.BAD_STATE: 409,
    ErrorCode.IN_USE: 409,
    ErrorCode.OUTSIDE_CITY: 409,
    ErrorCode.COMPANION_CLOSED: 409,
    ErrorCode.OWN_COMPANION: 409,
}

# Тексты по умолчанию. Доменные правила всегда передают свой текст — о конкретной ситуации.
_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.AUTH_REQUIRED: "Войдите, чтобы продолжить",
    ErrorCode.INVALID_CREDENTIALS: "Неверная почта или пароль",
    ErrorCode.FORBIDDEN: "Недостаточно прав для этого действия",
    ErrorCode.NOT_FOUND: "Не нашли то, что вы ищете",
    ErrorCode.METHOD_NOT_ALLOWED: "Такое действие здесь недоступно",
    ErrorCode.VALIDATION: "Проверьте заполнение полей",
    ErrorCode.BAD_REQUEST: "Некорректный запрос",
    ErrorCode.RATE_LIMIT: "Слишком много запросов. Подождите немного и попробуйте снова",
    ErrorCode.RATE_LIMITED: "Письмо уже отправлено. Повторите чуть позже",
    ErrorCode.EMAIL_NOT_VERIFIED: "Подтвердите почту: ссылка в письме",
    ErrorCode.TOKEN_INVALID: "Ссылка не подошла. Запросите новое письмо",
    ErrorCode.TOKEN_EXPIRED: "Срок действия ссылки истёк. Запросите новое письмо",
    ErrorCode.TOKEN_USED: "Ссылка уже использована. Запросите новую",
    ErrorCode.CODE_INVALID: "Код не подошёл",
    ErrorCode.CODE_EXPIRED: "Код больше не действует. Запросите новый",
    ErrorCode.SMS_FAILED: "Не получилось отправить SMS. Попробуйте позже или запросите письмо ещё раз",
    ErrorCode.SMS_UNAVAILABLE: "Отправка SMS временно недоступна. Попробуйте позже",
    ErrorCode.ASSISTANT_UNAVAILABLE: "Помощник сейчас недоступен",
    ErrorCode.SERVICE_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже",
}
_FALLBACK_MESSAGE = "Не получилось. Попробуйте ещё раз"


class AppError(Exception):
    def __init__(  # noqa: PLR0913
        self,
        code: ErrorCode,
        message: str | None = None,
        *,
        status: int | None = None,
        errors: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message or _MESSAGES.get(code, _FALLBACK_MESSAGE)
        self.status = status or _STATUS[code]
        self.errors = errors or None
        # Дополнительные поля ответа рядом с code и message (retryAfter, email, similar, fallback).
        self.extra = extra or {}
        self.headers = headers
        super().__init__(self.message)

    def body(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            **self.extra,
            "code": self.code.value,
            "statusCode": self.status,
            "message": self.message,
        }
        if self.errors:
            body["errors"] = self.errors
        return body
