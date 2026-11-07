"""Демо-данные С8, С14, С15.

Избранное и подписки Анны и Петра Ивановича, сохранённые поиски, соуправляющая клуба «Ладья»,
ответы «Встреча состоялась?» по прошедшим встречам и закреплённое объявление Дмитрия.
Ссылки «поделиться» не сеются: их создаёт участник сам.
"""

from collections.abc import Callable
from typing import Any

from app.domain.types import Entity

DAY = 24 * 60


def seed_engagement(input_: dict[str, Any]) -> dict[str, Entity]:
    """`input_` — {ago, messages, notifications}."""
    ago: Callable[[float], str] = input_["ago"]
    messages: list[Entity] = input_["messages"]
    notifications: list[Entity] = input_["notifications"]

    def vote(event_id: str, answer: str, user_ids: list[str], days_ago: int) -> list[Entity]:
        return [
            {"eventId": event_id, "userId": user_id, "answer": answer, "at": ago(days_ago * DAY - i * 37)}
            for i, user_id in enumerate(user_ids)
        ]

    messages.append(
        {
            "id": "m-pin-run",
            "eventId": "e-run-tatyshev",
            "authorId": "u-dmitry",
            "asOrgId": None,
            "text": "Встречаемся у входа на остров со стороны Коммунального моста, у информационного стенда. Если опаздываете, напишите сюда, минут пять подождём.",
            "replyTo": None,
            "reactions": {"thanks": ["u-sofia", "u-ksenia"]},
            "status": "visible",
            "hiddenReason": "",
            "system": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(18 * 60),
            "pinnedAt": ago(18 * 60),
        }
    )

    notifications.append(
        {
            "id": "n-held-anna-yoga",
            "userId": "u-anna",
            "type": "held_question",
            "title": "Встреча состоялась?",
            "text": "«Йога для начинающих в студии» закончилась. Ответьте одним нажатием: так другие узнают, что организатору можно доверять.",
            "link": "/events/e-past-yoga#held",
            "read": True,
            "createdAt": ago(4 * DAY - 120),
        }
    )

    return {
        "engagement": {
            "favorites": [
                {"userId": "u-anna", "eventId": "e-volley-hall", "at": ago(2 * DAY)},
                {"userId": "u-anna", "eventId": "e-tennis-beginners", "at": ago(DAY)},
                {"userId": "u-anna", "eventId": "e-hiking", "at": ago(300)},
                {"userId": "u-petr", "eventId": "e-gorodki", "at": ago(3 * DAY)},
            ],
            "follows": [
                {"userId": "u-anna", "kind": "org", "targetId": "o-vorontsova", "at": ago(10 * DAY)},
                {"userId": "u-anna", "kind": "user", "targetId": "u-dmitry", "at": ago(5 * DAY)},
                {"userId": "u-petr", "kind": "org", "targetId": "o-ladya", "at": ago(40 * DAY)},
                {"userId": "u-vasily", "kind": "org", "targetId": "o-ladya", "at": ago(60 * DAY)},
                {"userId": "u-galina", "kind": "org", "targetId": "o-ladya", "at": ago(20 * DAY)},
                {"userId": "u-artem", "kind": "org", "targetId": "o-ladya", "at": ago(12 * DAY)},
                {"userId": "u-nikita", "kind": "user", "targetId": "u-dmitry", "at": ago(30 * DAY)},
            ],
            "savedSearches": [
                {
                    "id": "ss-anna-volley",
                    "userId": "u-anna",
                    "name": "Волейбол по вечерам",
                    "query": "sport=s-volleyball&part=evening",
                    "criteria": {"sportIds": ["s-volleyball"], "dayPart": "evening"},
                    "summary": "Волейбол, вечером",
                    "createdAt": ago(6 * DAY),
                },
                {
                    "id": "ss-petr-chess",
                    "userId": "u-petr",
                    "name": "Шахматы для новичков",
                    "query": "sport=s-chess&new=1",
                    "criteria": {"sportIds": ["s-chess"], "beginners": True},
                    "summary": "Шахматы, рады новичкам",
                    "createdAt": ago(15 * DAY),
                },
            ],
            "matchNotified": [],
            "managers": [
                {"orgId": "o-ladya", "userId": "u-ksenia", "addedBy": "u-olga", "at": ago(10 * DAY)}
            ],
            "heldVotes": [
                *vote("e-past-chess", "yes", ["u-vasily", "u-artem"], 5),
                *vote("e-past-run", "yes", ["u-maxim", "u-sofia"], 6),
                *vote("e-past-volley", "yes", ["u-ksenia", "u-nikita", "u-maxim"], 4),
                *vote("e-past-workout", "yes", ["u-galina", "u-lyudmila"], 5),
                *vote("e-past-yoga", "no", ["u-irina"], 3),
            ],
            "heldAsked": ["u-anna|e-past-yoga"],
            "shareLinks": [],
        },
    }
