import re

from app.core.errors import AppError, ErrorCode
from app.db.models import User

# Каналы объектов, на которые можно подписаться явно. Каналы пользователя и админа выдаются только сервером.
_OBJECT_TOPIC = re.compile(r"^(event|org|companion):[A-Za-z0-9_-]{1,64}$")

PUBLIC_TOPIC = "public"
ADMIN_TOPIC = "admin"


def user_topic(user_id: str) -> str:
    return f"user:{user_id}"


def resolve_topics(user: User | None, requested: list[str], *, max_topics: int) -> list[str]:
    """Набор каналов подписки: общий, личный (если вошёл), админский (для админа) и запрошенные объекты.

    Ограничения доступа к закрытым обсуждениям добавятся здесь вместе с доменной моделью событий.
    """
    if len(requested) > max_topics:
        raise AppError(ErrorCode.VALIDATION, f"Можно подписаться не больше чем на {max_topics} объектов")
    invalid = [topic for topic in requested if not _OBJECT_TOPIC.match(topic)]
    if invalid:
        raise AppError(
            ErrorCode.VALIDATION, "Недопустимый канал подписки", errors={"topics": ", ".join(invalid[:5])}
        )
    topics = {PUBLIC_TOPIC, *requested}
    if user is not None:
        topics.add(user_topic(user.id))
        if user.is_admin:
            topics.add(ADMIN_TOPIC)
    return sorted(topics)
