from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories.ai_requests import AiRequestRepository


async def usage_by_kind(session: AsyncSession, days: int) -> list[dict[str, object]]:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = await AiRequestRepository(session).stats_by_kind(since)
    return [
        {
            "kind": row["kind"],
            "total": int(row["total"]),
            "succeeded": int(row["succeeded"] or 0),
            "fallbacks": int(row["fallbacks"] or 0),
            "cached": int(row["cached"] or 0),
            "avgMs": round(float(row["avg_ms"] or 0)),
            "p95Ms": round(float(row["p95_ms"] or 0)),
        }
        for row in rows
    ]
