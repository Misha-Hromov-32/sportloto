"""Демо-данные для подбора (В2), встречающего (С1), спроса (С2), срочного добора (С3)
и программы для ветеранов (Н2).

Вызывается из base.py: добавляет события, записи и объявления в общие списки и возвращает свои коллекции.
"""

from collections.abc import Callable
from typing import Any

from app.domain.seed.catalog import COVERS
from app.domain.types import Entity

# Помощники из base.py:
#   at(day_offset, hhmm) — дата через `day_offset` дней в `hhmm` по местному времени Красноярска;
#   next(iso_dow, hhmm) — ближайший будущий день недели (1 — пн … 7 — вс);
#   ago(minutes); events, participations, companions, notifications — общие списки.

HOUR = 60
DAY = 24 * HOUR


def _step(extra: Entity) -> Entity:
    return {
        "intensity": "medium",
        "bring": "",
        "preparation": "",
        "age": "",
        "howToFind": "",
        "amenities": [],
        "firstTimeNote": "",
        **extra,
    }


def seed_community(t: dict[str, Any]) -> dict[str, list[Entity]]:
    at: Callable[[int, str], str] = t["at"]
    next_: Callable[[int, str], str] = t["next"]
    ago: Callable[[float], str] = t["ago"]

    def ev(f: Entity) -> Entity:
        return {
            "description": "",
            "durationMin": 120,
            "level": "any",
            "beginnersWelcome": False,
            "firstStep": _step({}),
            "price": {"kind": "free"},
            "paymentNote": "",
            "cancelPolicy": {"kind": "anytime"},
            "joinMode": "open",
            "capacity": None,
            "minParticipants": None,
            "status": "published",
            "moderation": None,
            "cancelReason": "",
            "changes": [],
            "series": None,
            "privateInfo": "",
            "discussion": "everyone",
            "extra": {},
            "coverUrl": None,
            "createdWithAssistant": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(2 * DAY),
            "updatedAt": ago(2 * DAY),
            **f,
        }

    events: list[Entity] = [
        ev(
            {
                "id": "e-volley-vzlet",
                "title": "Волейбол для начинающих на Взлётке",
                "sportId": "s-volleyball",
                "organizer": {"kind": "user", "id": "u-dmitry"},
                "createdBy": "u-dmitry",
                "startsAt": next_(6, "11:00"),
                "place": {
                    "address": "Спортзал школы № 151, ул. Молокова, 66",
                    "landmark": "Вход со двора, синяя дверь",
                    "districtId": "d-vzlet",
                    "lat": 56.0503,
                    "lng": 92.9046,
                },
                "description": "Субботняя игра для тех, кто давно не играл или только начинает. Разминка, подачи в парах, потом 6×6 с заменами. Счёт не главное, учимся принимать и пасовать.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": _step(
                    {
                        "intensity": "medium",
                        "bring": "Кроссовки со светлой подошвой, вода",
                        "preparation": "Правила объясним на месте",
                        "howToFind": "От остановки «Взлётная» 5 минут через двор школы",
                        "amenities": ["Раздевалка", "Мячи есть"],
                        "firstTimeNote": "Первые полчаса разминка и подачи в парах, новичков ставлю рядом с опытными.",
                    }
                ),
                "price": {"kind": "split", "total": 1800, "note": "на аренду зала"},
                "paymentNote": "Переводом организатору после игры",
                "capacity": 12,
                "privateInfo": "Охране скажите «на волейбол к Дмитрию». Телефон: +7 902 940-33-44.",
                "coverUrl": COVERS["volleyball2"],
            }
        ),
        ev(
            {
                "id": "e-volley-sun",
                "title": "Воскресный волейбол в зале «Динамо»",
                "sportId": "s-volleyball",
                "organizer": {"kind": "user", "id": "u-ksenia"},
                "createdBy": "u-ksenia",
                "startsAt": next_(7, "12:00"),
                "place": {
                    "address": "Зал «Динамо», ул. Ленина, 34",
                    "landmark": "Второй этаж, малый зал",
                    "districtId": "d-center",
                    "lat": 56.0158,
                    "lng": 92.8905,
                },
                "description": "Играем 6×6, составы перемешиваем. Новичкам рады, напишите в заявке, играли ли вы раньше, чтобы команды были ровными.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": _step({"intensity": "medium", "bring": "Сменная обувь, вода"}),
                "price": {"kind": "fixed", "amount": 200},
                "paymentNote": "На месте, за аренду",
                "joinMode": "approval",
                "capacity": 12,
                "coverUrl": COVERS["volleyball"],
            }
        ),
        ev(
            {
                "id": "e-basket-urgent",
                "title": "Баскетбол 5×5 в зале: добираем состав",
                "sportId": "s-basketball",
                "organizer": {"kind": "user", "id": "u-dmitry"},
                "createdBy": "u-dmitry",
                "startsAt": at(1, "19:30"),
                "durationMin": 90,
                "place": {
                    "address": "Спортзал школы № 10, ул. Мичурина, 2",
                    "landmark": "Вход с торца, второй этаж",
                    "districtId": "d-oct",
                    "lat": 56.0289,
                    "lng": 92.7905,
                },
                "description": "Две пятёрки и замены. Играем до 21 очка, после каждой игры меняем составы.",
                "level": "amateur",
                "firstStep": _step({"intensity": "high", "bring": "Кроссовки, тёмная и светлая футболки"}),
                "price": {"kind": "split", "total": 2000, "note": "на аренду зала"},
                "capacity": 10,
                "coverUrl": COVERS["basketball2"],
            }
        ),
    ]

    t["events"].extend(events)

    seq = 0

    def join(event_id: str, user_ids: list[str]) -> None:
        nonlocal seq
        for user_id in user_ids:
            seq += 1
            t["participations"].append(
                {
                    "id": f"p-cm-{seq}",
                    "eventId": event_id,
                    "userId": user_id,
                    "status": "confirmed",
                    "prevStatus": None,
                    "note": "",
                    "rejectReason": "",
                    "source": "self",
                    "createdAt": ago((30 + seq) * HOUR),
                    "decidedAt": ago((30 + seq) * HOUR),
                }
            )

    join("e-volley-vzlet", ["u-sofia", "u-nikita", "u-ksenia", "u-egor", "u-alina"])
    join("e-volley-sun", ["u-maxim", "u-oleg", "u-timur", "u-irina", "u-roman", "u-pavel"])
    join("e-basket-urgent", ["u-maxim", "u-roman", "u-oleg", "u-timur", "u-igor", "u-egor", "u-konstantin"])

    t["companions"].append(
        {
            "id": "c-sofia-badminton",
            "authorId": "u-sofia",
            "sportId": "s-badminton",
            "text": "Ищу, с кем поиграть в бадминтон после работы на Взлётке. Ракетки есть, корт найдём вместе.",
            "districtId": "d-vzlet",
            "point": {"lat": 56.049, "lng": 92.906},
            "when": "Будни вечером, после 19:00",
            "level": "beginner",
            "readiness": "join",
            "metoo": [
                {"userId": "u-egor", "at": ago(20 * HOUR)},
                {"userId": "u-ksenia", "at": ago(6 * HOUR)},
            ],
            "status": "open",
            "eventId": None,
            "createdWithAssistant": False,
            "createdAt": ago(2 * DAY),
        }
    )

    greeters: list[Entity] = [
        {
            "eventId": "e-volley-vzlet",
            "userId": "u-dmitry",
            "note": "У входа со двора в 10:50, в красной куртке и с мячом",
            "updatedAt": ago(DAY),
        },
        {
            "eventId": "e-workout-akadem",
            "userId": "u-valentina",
            "note": "У летней сцены, в синей ветровке, с ковриками",
            "updatedAt": ago(3 * DAY),
        },
        {
            "eventId": "e-taichi",
            "userId": "u-valentina",
            "note": "У главного входа в Центральный парк, в зелёной ветровке, с табличкой «Тайцзи»",
            "updatedAt": ago(2 * DAY),
        },
    ]

    first_visits: list[Entity] = [
        {"eventId": "e-volley-vzlet", "userId": "u-sofia", "withCompanion": False, "at": ago(30 * HOUR)},
        {"eventId": "e-taichi", "userId": "u-lyudmila", "withCompanion": True, "at": ago(20 * HOUR)},
    ]

    event_programs: list[Entity] = [
        {
            "eventId": "e-taichi",
            "kind": "veterans",
            "withCompanion": True,
            "by": "u-valentina",
            "at": ago(3 * DAY),
        },
    ]

    urgent_calls: list[Entity] = [
        {
            "eventId": "e-basket-urgent",
            "need": 2,
            "baseline": 7,
            "createdBy": "u-dmitry",
            "createdAt": ago(2 * HOUR),
            "notified": ["u-nikita"],
            "closedAt": None,
        },
    ]

    # Неудачные поиски подбора. Гости без входа (userId: null) учитываются в спросе, но приглашение не получат.
    ds = 0

    def searched(
        sport_id: str, slot: str, district_id: str, users: list[str | None], level: str | None
    ) -> list[Entity]:
        nonlocal ds
        out: list[Entity] = []
        for i, user_id in enumerate(users):
            ds += 1
            out.append(
                {
                    "id": f"ds-{ds}",
                    "userId": user_id,
                    "sportId": sport_id,
                    "districtId": district_id,
                    "slot": slot,
                    "level": level,
                    "at": ago((i + 1) * 9 * HOUR),
                }
            )
        return out

    demand_signals: list[Entity] = [
        *searched(
            "s-badminton",
            "weekday_evening",
            "d-vzlet",
            ["u-alina", "u-irina", "u-oleg", None, None, None],
            "beginner",
        ),
        *searched(
            "s-chess",
            "weekend_day",
            "d-akadem",
            ["u-petr", "u-galina", "u-lyudmila", "u-vasily", None, None],
            "beginner",
        ),
        *searched("s-volleyball", "weekend_morning", "d-north", [None, None], None),
    ]

    t["notifications"].append(
        {
            "id": "n-cm-urgent",
            "userId": "u-nikita",
            "type": "urgent",
            "title": "Срочно нужны игроки",
            "text": "«Баскетбол 5×5 в зале: добираем состав», {{date:"
            + events[2]["startsAt"]
            + "}}, Октябрьский: не хватает 2\u00a0игроков. Если можете прийти, запишитесь в карточке.",
            "link": "/events/e-basket-urgent",
            "read": False,
            "createdAt": ago(2 * HOUR),
        }
    )

    return {
        "greeters": greeters,
        "firstVisits": first_visits,
        "eventPrograms": event_programs,
        "urgentCalls": urgent_calls,
        "demandSignals": demand_signals,
        "demandOffers": [],
    }
