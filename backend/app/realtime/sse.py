import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from app.realtime.broker import Broker

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # nginx не буферизует ответ с этим заголовком, даже если proxy_buffering включён.
    "X-Accel-Buffering": "no",
}


def format_sse(
    *,
    data: Any = None,  # noqa: ANN401
    event: str | None = None,
    id_: str | None = None,
    retry_ms: int | None = None,
) -> str:
    lines: list[str] = []
    if retry_ms is not None:
        lines.append(f"retry: {retry_ms}")
    if id_ is not None:
        lines.append(f"id: {id_}")
    if event is not None:
        lines.append(f"event: {event}")
    if data is not None:
        # json.dumps не оставляет переводов строк, поэтому одна строка data на событие.
        lines.append(f"data: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}")
    return "\n".join(lines) + "\n\n"


HEARTBEAT = ": ping\n\n"


async def event_stream(  # noqa: PLR0913
    broker: Broker,
    topics: list[str],
    last_event_id: str | None,
    *,
    heartbeat_seconds: float,
    retry_ms: int,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    # Подписка внутри генератора: если ответ так и не начнёт отправляться, подписка не повиснет.
    subscribed = broker.subscribe(topics, last_event_id)
    sub = subscribed.subscription
    try:
        # Событие ready несёт текущий id: после обрыва браузер пришлёт его в Last-Event-ID.
        # При повторной доставке id выставят сами доставленные события.
        yield format_sse(
            retry_ms=retry_ms,
            event="ready",
            id_=None if subscribed.replay else subscribed.last_id,
            data={"topics": sorted(sub.topics)},
        )
        if subscribed.resync:
            yield format_sse(event="resync", id_=subscribed.last_id, data={})
        for message in subscribed.replay:
            yield format_sse(id_=message.id, event=message.event, data=message.data)
        while True:
            try:
                message = await asyncio.wait_for(sub.queue.get(), timeout=heartbeat_seconds)
            except TimeoutError:
                if await is_disconnected():
                    break
                yield HEARTBEAT
                continue
            if message is None:
                break
            yield format_sse(id_=message.id, event=message.event, data=message.data)
    finally:
        broker.unsubscribe(sub)
