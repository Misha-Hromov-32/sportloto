"""Демо-данные для записи.

Женские и мужская встречи (В7), придержанное место у Анны (С4),
похожая встреча взамен отменённого футбола (С6), напоминание о завтрашней пробежке (С9),
ещё три встречи еженедельной зарядки (С10).
"""

import copy
from datetime import datetime, timedelta

from app.domain import clock
from app.domain.features import composition, waitlist_offer
from app.domain.seed.catalog import COVERS
from app.domain.types import Entity


def seed_participation_demo(data: Entity, now: datetime) -> None:
    """`data` — {users, events, participations, notifications}; `now` — момент сброса."""
    users: list[Entity] = data["users"]
    events: list[Entity] = data["events"]
    participations: list[Entity] = data["participations"]
    notifications: list[Entity] = data["notifications"]
    current = now

    def ago(delta: timedelta) -> str:
        return clock.iso(current - delta)

    def starts(event: Entity) -> datetime:
        # Даты встреч задал сам сид, они всегда верные.
        return clock.parse(event["startsAt"]) or current

    def by_id(id_: str) -> Entity | None:
        return next((e for e in events if e["id"] == id_), None)

    seq = 0

    def join(event_id: str, user_ids: list[str], created_at: str, extra: Entity | None = None) -> None:
        nonlocal seq
        extra = extra or {}
        for user_id in user_ids:
            seq += 1
            participations.append(
                {
                    "id": f"p-pf-{seq}",
                    "eventId": event_id,
                    "userId": user_id,
                    "status": "confirmed",
                    "prevStatus": None,
                    "note": "",
                    "rejectReason": "",
                    "source": "self",
                    "createdAt": created_at,
                    "decidedAt": created_at,
                    **extra,
                }
            )

    def copy_event(base: Entity, id_: str, starts_at: str, patch: Entity) -> Entity:
        return {
            **copy.deepcopy(base),
            "id": id_,
            "startsAt": starts_at,
            "changes": [],
            "createdAt": ago(timedelta(days=4)),
            "updatedAt": ago(timedelta(days=4)),
            **patch,
        }

    run = by_id("e-run-tatyshev")
    if run is not None:
        # Сегодня или завтра в 18:30, чтобы до начала было меньше суток и пришло напоминание
        tomorrow_evening = starts(run) + timedelta(hours=11)
        today_evening = tomorrow_evening - timedelta(days=1)
        evening = today_evening if today_evening > current + timedelta(minutes=30) else tomorrow_evening
        starts_at = clock.iso(evening)
        events.append(
            copy_event(
                run,
                "e-run-girls",
                starts_at,
                {
                    "title": "Бег для девушек: 5 км в спокойном темпе",
                    "organizer": {"kind": "user", "id": "u-alina"},
                    "createdBy": "u-alina",
                    "description": "Бегаем женской компанией вдоль набережной. Темп разговорный, кто устал, переходит на шаг. После пробежки растяжка 10 минут.",
                    "place": {
                        "address": "Набережная Енисея у Коммунального моста",
                        "landmark": "Деревянный настил под мостом",
                        "districtId": "d-center",
                        "lat": 56.0086,
                        "lng": 92.8935,
                    },
                    "firstStep": {
                        **run["firstStep"],
                        "howToFind": "От остановки «Театр оперы и балета» спуститься к реке, 3 минуты пешком",
                        "firstTimeNote": "Если вы раньше не бегали, чередуйте бег с шагом. Последнюю бегунью не оставляем.",
                    },
                    "capacity": 15,
                    "privateInfo": "Встречаемся за 10 минут до начала у настила. Телефон Алины: +7 913 777-20-41.",
                    "coverUrl": COVERS["running2"],
                    "composition": "women",
                },
            )
        )
        join("e-run-girls", ["u-anna", "u-ksenia", "u-sofia"], ago(timedelta(days=3)))

    football = by_id("e-football-77")
    cancelled = by_id("e-football-cancelled")
    if football is not None and cancelled is not None:
        events.append(
            copy_event(
                football,
                "e-football-noon",
                # Следующий день после отменённой игры, на 8,5 часа раньше: в обед
                clock.iso(starts(cancelled) + timedelta(days=1, hours=-8.5)),
                {
                    "title": "Футбол 6×6 в обед: смешанные команды",
                    "organizer": {"kind": "user", "id": "u-timur"},
                    "createdBy": "u-timur",
                    "description": "Играем 6×6 на открытом поле у набережной. Команды делим на месте, чтобы было ровно. Мяч есть.",
                    "place": {
                        "address": "Стадион «Енисей», малое поле, ул. Абытаевская, 2",
                        "landmark": "Вход со стороны набережной",
                        "districtId": "d-center",
                        "lat": 56.0256,
                        "lng": 92.9255,
                    },
                    "level": "any",
                    "beginnersWelcome": True,
                    "price": {"kind": "free"},
                    "paymentNote": "",
                    "cancelPolicy": {"kind": "anytime"},
                    "capacity": 12,
                    "minParticipants": None,
                    "extra": {"format": "6×6"},
                    "privateInfo": "Телефон Тимура: +7 923 300-12-55.",
                    "coverUrl": COVERS["footballYard"],
                },
            )
        )
        join(
            "e-football-noon", ["u-timur", "u-nikita", "u-oleg", "u-ksenia", "u-egor"], ago(timedelta(days=2))
        )

    # Анна в листе ожидания на футбол первая: если кто-то откажется, место предложат ей
    anna_queue = next(
        (p for p in participations if p["eventId"] == "e-football-77" and p["userId"] == "u-anna"), None
    )
    if anna_queue is not None:
        anna_queue["createdAt"] = ago(timedelta(days=4))

    workout = by_id("e-workout-akadem")
    if workout is not None and workout.get("series") is not None:
        for week in [1, 2, 3]:
            id_ = f"e-workout-akadem-w{week}"
            events.append(
                copy_event(
                    workout,
                    id_,
                    clock.iso(starts(workout) + timedelta(weeks=week)),
                    {
                        "series": workout["series"],
                        "createdAt": workout["createdAt"],
                        "updatedAt": workout["updatedAt"],
                    },
                )
            )
            join(id_, ["u-galina", "u-lyudmila", "u-natalia", "u-vasily"], workout["createdAt"])

    composition.seed_composition(users, events)
    waitlist_offer.seed_offer(participations, now)
    badminton = next(
        (p for p in participations if p["eventId"] == "e-badminton" and p["userId"] == "u-anna"), None
    )
    offer = badminton.get("offer") if badminton is not None else None
    if offer is not None:
        notifications.append(
            {
                "id": "n-pf-offer",
                "userId": "u-anna",
                "type": "waitlist_offer",
                "title": "Освободилось место на бадминтоне",
                "text": "«Бадминтон пара на пару»: место держим за вами 3 часа. Ответьте в карточке: «Иду» или «Отказаться».",
                "link": "/events/e-badminton#join",
                "read": False,
                "createdAt": offer["at"],
            }
        )
