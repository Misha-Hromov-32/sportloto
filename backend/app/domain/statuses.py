"""Статусы основных сущностей: одни значения в правилах, в ограничениях таблиц (CHECK) и в контракте API
(frontend/src/types/domain.ts).

Перечисления — StrEnum: в записях и ответах это обычные строки, сравнение `e["status"] == EventStatus.REMOVED`
работает и со строкой из базы.
"""

from enum import StrEnum


class EventStatus(StrEnum):
    """Публикация события. Состояние для экрана (идёт запись, уже идёт, прошло) вычисляется из неё и времени."""

    PUBLISHED = "published"
    CANCELLED = "cancelled"  # отменил организатор
    REMOVED = "removed"  # снял модератор: запись заморожена, событие можно вернуть
    DELETED = "deleted"


class JoinMode(StrEnum):
    OPEN = "open"  # свободная запись: сразу участник
    APPROVAL = "approval"  # по заявке: решает организатор


class ParticipationStatus(StrEnum):
    CONFIRMED = "confirmed"
    PENDING = "pending"  # заявка ждёт решения организатора
    WAITLIST = "waitlist"
    REJECTED = "rejected"
    CANCELLED = "cancelled"  # человек отменил запись
    EVENT_REMOVED = "event_removed"  # снято или удалено модератором; при возврате статус восстанавливается
    REMOVED = "removed"  # организатор убрал из участников этой встречи


# Запись, которая занимает место или ждёт решения.
ACTIVE_PARTICIPATION = (
    ParticipationStatus.CONFIRMED,
    ParticipationStatus.PENDING,
    ParticipationStatus.WAITLIST,
)


class OrganizationStatus(StrEnum):
    """Допуск организации: публиковать от её имени можно только в статусе APPROVED."""

    DRAFT = "draft"
    PENDING = "pending"  # заявка у администратора
    APPROVED = "approved"
    REJECTED = "rejected"
    RETURNED = "returned"  # вернули на доработку
    BLOCKED = "blocked"


class MessageStatus(StrEnum):
    VISIBLE = "visible"
    HIDDEN = "hidden"  # скрыто организатором или модератором
    DELETED = "deleted"


class CompanionStatus(StrEnum):
    """Объявление «Ищу компанию»."""

    OPEN = "open"
    GATHERED = "gathered"  # из откликов собрали встречу
    CLOSED = "closed"
