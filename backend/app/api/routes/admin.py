from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, SessionDep
from app.api.schemas.admin import AiUsageOut
from app.api.schemas.common import ERROR_RESPONSES
from app.services.assistant_stats import usage_by_kind

router = APIRouter(prefix="/admin", tags=["администрирование"], responses=ERROR_RESPONSES)


@router.get("/ai/stats")
async def ai_stats(
    _: AdminUser, session: SessionDep, days: Annotated[int, Query(ge=1, le=90)] = 7
) -> list[AiUsageOut]:
    """Сводка журнала помощника по типам запросов: доля успехов, запасного пути и кэша, время ответа."""
    return [AiUsageOut.model_validate(row) for row in await usage_by_kind(session, days)]
