from fastapi import APIRouter

from app.api.deps import AiDep, DatabaseDep, SettingsDep
from app.api.schemas.common import ErrorOut, HealthOut
from app.services.health import check_database

router = APIRouter(tags=["служебное"])


@router.get("/health", responses={503: {"model": ErrorOut}})
async def health(db: DatabaseDep, settings: SettingsDep, ai: AiDep) -> HealthOut:
    await check_database(db)
    return HealthOut(status="ok", database="ok", version=settings.app_version, assistant=ai.provider.name)
