from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse

from app.api.deps import BrokerDep, SettingsDep, StreamUser
from app.api.schemas.common import ERROR_RESPONSES
from app.realtime.sse import SSE_HEADERS, event_stream
from app.services.realtime import resolve_topics

router = APIRouter(tags=["живые обновления"], responses=ERROR_RESPONSES)


@router.get("/stream", response_class=StreamingResponse)
async def stream(  # noqa: PLR0913
    request: Request,
    *,
    broker: BrokerDep,
    settings: SettingsDep,
    user: StreamUser,
    topics: Annotated[
        str, Query(max_length=4000, description="Каналы объектов через запятую: event:<id>")
    ] = "",
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID", max_length=64)] = None,
    last_event_id_query: Annotated[str | None, Query(alias="lastEventId", max_length=64)] = None,
) -> StreamingResponse:
    """SSE-поток событий. Личный канал добавляется по cookie сессии, объекты — из параметра `topics`.

    `lastEventId` в строке запроса — для клиентов, которые переподключаются сами и не могут задать заголовок.
    """
    requested = [topic.strip() for topic in topics.split(",") if topic.strip()]
    resolved = resolve_topics(user, requested, max_topics=settings.sse_max_topics)
    return StreamingResponse(
        event_stream(
            broker,
            resolved,
            last_event_id or last_event_id_query,
            heartbeat_seconds=settings.sse_heartbeat_seconds,
            retry_ms=settings.sse_retry_ms,
            is_disconnected=request.is_disconnected,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
