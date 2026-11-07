from app.api.schemas.base import ApiModel


class ErrorOut(ApiModel):
    code: str
    message: str
    errors: dict[str, str] | None = None


class HealthOut(ApiModel):
    status: str
    database: str
    version: str
    assistant: str


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorOut, "description": "Нужно войти"},
    403: {"model": ErrorOut, "description": "Недостаточно прав"},
    422: {"model": ErrorOut, "description": "Ошибка в данных"},
}
