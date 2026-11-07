"""Общие помощники модулей С1, С2, С3, Н2 и В2.

Модули работают поверх тех же данных и правил, что и core.py.
"""

from typing import TYPE_CHECKING

from app.domain import bus, clock, store
from app.domain.errors import fail
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain


def date_token(iso: str) -> str:
    """Дата в тексте уведомления хранится как ISO и подписывается при чтении."""
    return f"{{{{date:{iso}}}}}"


def db() -> store.Database:
    return store.data()


def require_user(actor: Actor) -> Entity:
    return actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")


def get_event(id_: ID) -> Entity:
    found = db().record("events", id_)
    return found if found is not None else fail("not_found", "Событие не найдено. Возможно, ссылка устарела")


def organizer_ids(e: Entity) -> list[ID]:
    """Кто управляет событием: автор или представитель организации."""
    if e["organizer"]["kind"] == "user":
        return [e["organizer"]["id"]]
    org = next((o for o in db().organizations if o["id"] == e["organizer"]["id"]), None)
    # С14: соуправляющие клуба тоже организаторы его встреч
    managers = [m["userId"] for m in db().engagement.managers if m["orgId"] == (org or {}).get("id")]
    return [org["ownerId"], *managers] if org else []


def participation(event_id: ID, user_id: ID | None) -> Entity | None:
    if not user_id:
        return None
    return next((p for p in db().participations if p["eventId"] == event_id and p["userId"] == user_id), None)


def confirmed_count(event_id: ID) -> int:
    return sum(1 for p in db().participations if p["eventId"] == event_id and p["status"] == "confirmed")


def notify(d: "Domain", user_ids: list[ID], type_: str, title: str, text: str, link: str) -> None:  # noqa: ARG001
    at = clock.iso(clock.now())
    for user_id in dict.fromkeys(u for u in user_ids if u):
        db().notifications.insert(
            0,
            {
                "id": store.next_id("n"),
                "userId": user_id,
                "type": type_,
                "title": title,
                "text": text,
                "link": link,
                "read": False,
                "createdAt": at,
            },
        )


def commit(resources: list[str], ids: list[ID] | None = None) -> None:
    bus.publish(resources, ids or [])


def first_name(name: str) -> str:
    return name.split(" ", maxsplit=1)[0]
