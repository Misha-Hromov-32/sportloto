"""С12. «Собраться тем же составом».

После прошедшей встречи организатор нажимает «Собраться снова»: мастер создания открывается с копией
карточки на неделю вперёд (дату можно поменять), а после публикации все, кто был в составе прошлой
встречи, получают приглашение с кнопкой «Записаться». Приглашённые на встречу по заявке принимаются
без рассмотрения — как в механике «Позвать».
"""

from collections.abc import Callable
from typing import Any

from app.domain import clock
from app.domain.errors import fail
from app.domain.features.invite_only import invite_path, person_short
from app.domain.features.participation_host import ParticipationHost, date_token
from app.domain.features.stop_list import is_stop_listed
from app.domain.routing import Route, route
from app.domain.types import ID, Actor, Entity


def former_participants(host: ParticipationHost, e: Entity) -> list[ID]:
    """Кто был в составе встречи, кроме самих организаторов."""
    organizers = host.organizer_user_ids(e)
    now = clock.now()
    return [
        p["userId"]
        for p in host.db.participations
        if p["eventId"] == e["id"]
        and p["status"] == "confirmed"
        and p["userId"] not in organizers
        and not is_stop_listed(host.db, p["userId"], e, now)  # кого организатор не пускает, не зовём
    ]


def again_source(host: ParticipationHost, actor: Actor, event_id: Any) -> Entity | None:
    """Прошедшая встреча, которую этот человек проводил. Проверяется до публикации копии."""
    if event_id is None or event_id == "":
        return None
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    e = host.event(event_id) if isinstance(event_id, str) else None
    if e is None:
        fail("not_found", "Прошлая встреча не найдена")
    if not host.is_organizer(user, e):
        fail("forbidden", "Собрать снова может только организатор прошлой встречи")
    if host.event_state(e) != "past":
        fail("bad_state", "Собраться снова можно после того, как встреча прошла")
    return e


def again_preview(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    e = again_source(host, actor, event_id)
    users = [host.user(id_) for id_ in former_participants(host, e)]
    return {
        "eventId": e["id"],
        "title": e["title"],
        "invitees": [person_short(u) for u in users if u is not None],
    }


def invite_again(host: ParticipationHost, actor: Entity, source: Entity, created: Entity) -> int:
    """После публикации: приглашение каждому из прошлого состава. Возвращает, скольких позвали."""
    ids = [id_ for id_ in former_participants(host, source) if host.user(id_) is not None]
    if not ids:
        return 0
    at = clock.iso(clock.now())
    for to_user_id in ids:
        if any(i["eventId"] == created["id"] and i["toUserId"] == to_user_id for i in host.db.invites):
            continue
        host.db.invites.append(
            {
                "id": host.next_id("inv"),
                "eventId": created["id"],
                "fromUserId": actor["id"],
                "toUserId": to_user_id,
                "companionId": None,
                "createdAt": at,
            }
        )
    organizer = host.event_view(None, created)["organizerView"]["name"]
    approval = ": по приглашению заявку подтверждать не нужно" if created["joinMode"] == "approval" else ""
    host.notify(
        ids,
        "invite",
        f"Собираемся снова: «{created['title']}»",
        f"{organizer} зовёт тем же составом, что и в прошлый раз: {date_token(created['startsAt'])}. Нажмите, чтобы записаться{approval}.",
        invite_path(created, "intent=join"),
    )
    return len(ids)


def again_routes(host: Callable[[], ParticipationHost], actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/events/([^/]+)/again$", lambda p, _b, _q: again_preview(host(), actor(), p[0])),
    ]
