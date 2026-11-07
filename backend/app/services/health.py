import logging

from app.core.errors import AppError, ErrorCode
from app.db.session import Database

logger = logging.getLogger(__name__)


async def check_database(db: Database) -> None:
    try:
        await db.ping()
    except Exception as exc:
        logger.warning("Проверка базы данных не прошла: %s", type(exc).__name__)
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "База данных недоступна") from exc
