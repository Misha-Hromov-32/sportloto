"""Ошибки доменных правил: `fail` прерывает правило ошибкой API.

Коды, HTTP-статусы и формат ответа — общие для всего сервера (app/core/errors.py): клиент различает
ошибки по коду, а человеку показывает готовое русское сообщение.
"""

from typing import Any, NoReturn

from app.core.errors import AppError, ErrorCode


def fail(
    code: str,
    message: str,
    fields: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
) -> NoReturn:
    """`code` — значение `ErrorCode`, `fields` — подсказки к полям формы, `extra` — дополнительные поля ответа."""
    raise AppError(ErrorCode(code), message, errors=fields, extra=extra)
