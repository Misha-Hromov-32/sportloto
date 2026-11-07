"""Живые обновления правил.

Правило сообщает, какие ресурсы изменились; подписчики SSE получат событие `resources/<ресурс>`
после успешного коммита транзакции.
"""

from collections.abc import Iterable

from app.domain import store

RESOURCES = (
    "events",
    "participations",
    "messages",
    "organizations",
    "companions",
    "notifications",
    "sports",
    "categories",
    "cities",
    "districts",
    "rules",
    "users",
    "audit",
    "invites",
    "admin",
    "demo",
    "inventory",
    "demand",
    "venues",
    "imports",
    "reports",
    "mcp",
)


def publish(resources: Iterable[str], ids: Iterable[str] = (), type_: str = "updated") -> None:
    store.data().publish(list(resources), list(ids), type_)
