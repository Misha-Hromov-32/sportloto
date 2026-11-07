"""Точка протокола MCP для внешних ассистентов (Streamable HTTP, docs/architecture/mcp.md).

`POST /mcp` в корне сайта: заголовок `Authorization: Bearer stp_…` — личный токен из «Настроек → Помощник»,
тело — одно сообщение JSON-RPC 2.0. Кто действует, определяет только токен, сессия сайта не используется.
Правила и журнал вызовов — те же, что у консоли инструментов (`POST /api/mcp`), поэтому вызов —
изменяющая транзакция: каждый вызов с `id` пишется в журнал без аргументов и ответа.
"""

from fastapi import APIRouter, Request, Response

from app.api.routes.domain import DomainJSONResponse, display_zone
from app.assistant import config as assistant_config
from app.core.errors import AppError, ErrorCode
from app.domain.features import mcp

router = APIRouter(tags=["MCP"])


@router.post(mcp.MCP_ENDPOINT_PATH, summary="Сообщение JSON-RPC 2.0 от внешнего ассистента")
async def exchange(request: Request) -> Response:
    if not await request.app.state.domain.call(lambda: assistant_config.feature_on("mcp"), write=False):
        raise AppError(ErrorCode.NOT_FOUND)
    # Тело передаётся строкой: разбор, ошибки -32700 и нормализация id — в обработчике MCP.
    message = (await request.body()).decode("utf-8", errors="replace")
    authorization = request.headers.get("authorization")
    result = await request.app.state.domain.call(
        lambda: mcp.mcp_exchange({"authorization": authorization, "message": message}),
        write=True,
        zone=display_zone(request),
    )
    status = result["httpStatus"]
    if status == 202 or result.get("response") is None:  # noqa: PLR2004  уведомление без ответа
        return Response(status_code=status)
    return DomainJSONResponse(status_code=status, content=result["response"])


@router.get(mcp.MCP_ENDPOINT_PATH, include_in_schema=False)
async def no_stream() -> Response:
    """Сервер не открывает поток событий для MCP: только запрос — ответ."""
    return Response(status_code=405, headers={"Allow": "POST"})
