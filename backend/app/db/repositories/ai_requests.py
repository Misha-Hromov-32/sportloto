from datetime import datetime

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AiRequest


class AiRequestRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, record: AiRequest) -> AiRequest:
        self.session.add(record)
        return record

    async def count_for_user(self, user_id: str, since: datetime) -> int:
        """Сколько настоящих обращений к модели сделал пользователь.

        Ответы из кэша и отказы по лимиту не считаются.
        """
        result = await self.session.execute(
            select(func.count())
            .select_from(AiRequest)
            .where(
                AiRequest.user_id == user_id,
                AiRequest.created_at >= since,
                AiRequest.cached.is_(False),
                AiRequest.error.is_distinct_from("rate_limited"),
            )
        )
        return int(result.scalar_one())

    async def stats_by_kind(self, since: datetime) -> list[dict[str, object]]:
        result = await self.session.execute(
            select(
                AiRequest.kind,
                func.count().label("total"),
                func.sum(cast(AiRequest.success, Integer)).label("succeeded"),
                func.sum(cast(AiRequest.fallback_used, Integer)).label("fallbacks"),
                func.sum(cast(AiRequest.cached, Integer)).label("cached"),
                func.avg(AiRequest.duration_ms).label("avg_ms"),
                func.percentile_cont(0.95).within_group(AiRequest.duration_ms).label("p95_ms"),
            )
            .where(AiRequest.created_at >= since)
            .group_by(AiRequest.kind)
            .order_by(AiRequest.kind)
        )
        return [dict(row._mapping) for row in result]  # noqa: SLF001
