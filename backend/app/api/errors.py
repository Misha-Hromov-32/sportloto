"""Ответы на ошибки: любая ошибка сервера уходит клиенту в одном формате (app/core/errors.py)."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

_VALIDATION_MESSAGES: dict[str, str] = {
    "missing": "Обязательное поле",
    "string_too_short": "Слишком короткое значение",
    "string_too_long": "Слишком длинное значение",
    "string_type": "Ожидается текст",
    "string_pattern_mismatch": "Неверный формат",
    "int_parsing": "Ожидается целое число",
    "int_type": "Ожидается целое число",
    "float_parsing": "Ожидается число",
    "bool_parsing": "Ожидается «да» или «нет»",
    "literal_error": "Недопустимое значение",
    "enum": "Недопустимое значение",
    "greater_than_equal": "Слишком маленькое значение",
    "less_than_equal": "Слишком большое значение",
    "too_long": "Слишком много элементов",
    "too_short": "Слишком мало элементов",
    "json_invalid": "Некорректный JSON",
    "model_attributes_type": "Ожидается объект",
    "dict_type": "Ожидается объект",
    "list_type": "Ожидается список",
    "extra_forbidden": "Лишнее поле",
}

_LOCATION_ROOTS = {"body", "query", "path", "header", "cookie"}

_HTTP_CODES = {
    401: ErrorCode.AUTH_REQUIRED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    429: ErrorCode.RATE_LIMIT,
}


def error_response(error: AppError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content=error.body(), headers=error.headers)


def _validation_errors(exc: RequestValidationError) -> dict[str, str]:
    fields: dict[str, str] = {}
    for item in exc.errors():
        loc = [str(part) for part in item.get("loc", ())]
        if loc and loc[0] in _LOCATION_ROOTS:
            loc = loc[1:]
        key = ".".join(loc) or "_"
        ctx = item.get("ctx") or {}
        # Ошибки из валидаторов схем уже на русском — их показываем как есть.
        if item.get("type") == "value_error" and "error" in ctx:
            message = str(ctx["error"])
        else:
            message = _VALIDATION_MESSAGES.get(item.get("type", ""), "Недопустимое значение")
        fields.setdefault(key, message)
    return fields


async def _handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return error_response(exc)


async def _handle_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(AppError(ErrorCode.VALIDATION, errors=_validation_errors(exc)))


async def _handle_http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _HTTP_CODES.get(exc.status_code)
    if code is None:
        code = ErrorCode.INTERNAL if exc.status_code >= 500 else ErrorCode.BAD_REQUEST  # noqa: PLR2004
    return error_response(AppError(code, status=exc.status_code))


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Необработанная ошибка: %s %s", request.method, request.url.path, exc_info=exc)
    return error_response(AppError(ErrorCode.INTERNAL))


def install_error_handlers(app: FastAPI) -> None:
    # Starlette типизирует обработчики общим Exception, а вызывает с нужным подклассом.
    app.add_exception_handler(AppError, _handle_app_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _handle_validation)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _handle_http)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _handle_unexpected)
