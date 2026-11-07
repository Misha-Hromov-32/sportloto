"""Демо-данные инвентаря и помощи партнёров.

Всё вымышленное. Партнёр «Спортмастерская» (Андрей Соловьёв) допущен администратором и входит в демо-доступы.
Сбор «Стритбола» Дмитрия и «Бадминтона» Максима не закрыт: видно, чего не хватает.
"""

from datetime import timedelta
from typing import Any

from app.domain import clock
from app.domain.types import Entity

# Демо-данные — в Красноярске: срок «до конца дня» — 23:59 по местному времени.
_PLACE_ZONE = "Asia/Krasnoyarsk"


def seed_inventory(input_: dict[str, Any]) -> Entity:
    """`input_` — {users, organizations, events, notifications, now}; `now` — момент сброса."""
    users: list[Entity] = input_["users"]
    organizations: list[Entity] = input_["organizations"]
    events: list[Entity] = input_["events"]
    notifications: list[Entity] = input_["notifications"]
    now = input_["now"]

    def ago(minutes: float) -> str:
        return clock.iso(now - timedelta(minutes=minutes))

    hour = 60
    day = 24 * hour

    def end_of_day_in(days: int) -> str:
        local = clock.local(now + timedelta(days=days), _PLACE_ZONE)
        return clock.iso(local.replace(hour=23, minute=59, second=0, microsecond=0))

    def has_event(id_: str) -> bool:
        return any(e["id"] == id_ for e in events)

    if not any(u["id"] == "u-andrey" for u in users):
        district = {"lat": 56.056, "lng": 92.93}
        users.append(
            {
                "id": "u-andrey",
                "name": "Андрей Соловьёв",
                "avatarUrl": None,
                "age": 42,
                "role": "user",
                "city": "Красноярск",
                "districtId": "d-sov",
                "about": "Веду мастерскую спортивного инвентаря. Помогаем дворовым командам и детским секциям.",
                "interests": ["s-volleyball", "s-skiing"],
                "levels": {"s-volleyball": "amateur", "s-skiing": "amateur"},
                "readiness": None,
                "home": district,
                "radiusKm": 10,
                "email": "andrey@vmeste.demo",
                "phone": "+7 913 455-80-80",
                "demo": {
                    "title": "Партнёр «Спортмастерская»",
                    "hint": "Откликается на просьбы клубов о помощи, даёт инвентарь с общей полки",
                    "order": 9,
                },
                "createdAt": ago(150 * day),
            }
        )
    if not any(o["id"] == "o-sportmaster" for o in organizations):
        organizations.append(
            {
                "id": "o-sportmaster",
                "name": "Спортмастерская",
                "type": "sponsor",
                "description": "Мастерская и прокат спортивного инвентаря в Советском районе. Чиним ракетки и лыжи, даём мячи, сетки и манишки на время дворовым командам и детским секциям. Помогаем вещами, денег не собираем.",
                "sportIds": ["s-volleyball", "s-basketball", "s-football", "s-skiing"],
                "city": "Красноярск",
                "districtId": "d-sov",
                "address": "ул. 9 Мая, 54, вход со двора",
                "contacts": {
                    "phone": "+7 913 455-80-80",
                    "email": "pomosh@sportmasterskaya-kras.ru",
                    "social": "",
                },
                "logoUrl": None,
                "ownerId": "u-andrey",
                "status": "approved",
                "reviews": [
                    {
                        "id": "rv-s-sportmaster",
                        "decision": "submitted",
                        "reason": "",
                        "adminId": None,
                        "at": ago(140 * day),
                    },
                    {
                        "id": "rv-a-sportmaster",
                        "decision": "approved",
                        "reason": "",
                        "adminId": "u-maria",
                        "at": ago(139 * day),
                    },
                ],
                "createdWithAssistant": False,
                "aiFlag": "none",
                "aiReason": "",
                "createdAt": ago(140 * day),
                "updatedAt": ago(139 * day),
            }
        )

    def by_org(id_: str) -> Entity:
        return {"kind": "org", "id": id_}

    def by_user(id_: str) -> Entity:
        return {"kind": "user", "id": id_}

    owners: dict[str, str] = {
        "o-legends": "u-roman",
        "o-ladya": "u-olga",
        "o-morning": "u-valentina",
        "o-vorontsova": "u-elena",
        "o-sportmaster": "u-andrey",
    }

    def item(id_: str, owner: Entity, f: Entity) -> Entity:
        rest = dict(f)
        days = rest.pop("days")
        note = rest.pop("note", "")
        return {
            "id": id_,
            "owner": owner,
            "createdBy": owner["id"] if owner["kind"] == "user" else owners.get(owner["id"], ""),
            "note": note,
            **rest,
            "createdAt": ago(days * day),
            "updatedAt": ago(days * day),
        }

    shelf: list[Entity] = [
        item(
            "sh-legends-balls",
            by_org("o-legends"),
            {
                "name": "Футбольный мяч, размер 5",
                "kind": "ball",
                "sportId": "s-football",
                "quantity": 6,
                "condition": "good",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit"],
                "days": 40,
            },
        ),
        item(
            "sh-legends-bibs",
            by_org("o-legends"),
            {
                "name": "Манишки двух цветов",
                "kind": "bibs",
                "sportId": "s-football",
                "quantity": 14,
                "condition": "good",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit", "pickup"],
                "note": "Постирать не нужно, заберём как есть.",
                "days": 38,
            },
        ),
        item(
            "sh-legends-cones",
            by_org("o-legends"),
            {
                "name": "Фишки для разминки",
                "kind": "cones",
                "sportId": None,
                "quantity": 20,
                "condition": "used",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit", "pickup"],
                "days": 30,
            },
        ),
        item(
            "sh-ladya-sets",
            by_org("o-ladya"),
            {
                "name": "Шахматы с доской",
                "kind": "board",
                "sportId": "s-chess",
                "quantity": 8,
                "condition": "good",
                "districtId": "d-center",
                "terms": ["return_after", "pickup"],
                "note": "Даём на турниры и дворовые встречи. Забрать можно в клубе по будням с 16:00.",
                "days": 60,
            },
        ),
        item(
            "sh-ladya-clocks",
            by_org("o-ladya"),
            {
                "name": "Шахматные часы",
                "kind": "clock",
                "sportId": "s-chess",
                "quantity": 6,
                "condition": "good",
                "districtId": "d-center",
                "terms": ["return_after", "pickup"],
                "days": 60,
            },
        ),
        item(
            "sh-morning-poles",
            by_org("o-morning"),
            {
                "name": "Палки для скандинавской ходьбы",
                "kind": "poles",
                "sportId": "s-nordic",
                "quantity": 10,
                "condition": "good",
                "districtId": "d-akadem",
                "terms": ["return_after", "no_deposit", "bring_to_place"],
                "note": "Подгоним длину по росту прямо на месте.",
                "days": 25,
            },
        ),
        item(
            "sh-morning-mats",
            by_org("o-morning"),
            {
                "name": "Коврики для зарядки",
                "kind": "mat",
                "sportId": "s-workout",
                "quantity": 12,
                "condition": "used",
                "districtId": "d-akadem",
                "terms": ["return_after", "no_deposit"],
                "days": 20,
            },
        ),
        item(
            "sh-yoga-mats",
            by_org("o-vorontsova"),
            {
                "name": "Коврик для йоги",
                "kind": "mat",
                "sportId": "s-yoga",
                "quantity": 10,
                "condition": "good",
                "districtId": "d-center",
                "terms": ["return_after", "no_deposit", "bring_to_place"],
                "note": "Привезу на занятие на набережной.",
                "days": 15,
            },
        ),
        item(
            "sh-sm-volley",
            by_org("o-sportmaster"),
            {
                "name": "Волейбольный мяч",
                "kind": "ball",
                "sportId": "s-volleyball",
                "quantity": 6,
                "condition": "new",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit", "bring_to_place"],
                "days": 50,
            },
        ),
        item(
            "sh-sm-basket",
            by_org("o-sportmaster"),
            {
                "name": "Баскетбольный мяч, размер 7",
                "kind": "ball",
                "sportId": "s-basketball",
                "quantity": 4,
                "condition": "new",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit"],
                "days": 50,
            },
        ),
        item(
            "sh-sm-bibs",
            by_org("o-sportmaster"),
            {
                "name": "Манишки, 6 красных и 6 синих",
                "kind": "bibs",
                "sportId": None,
                "quantity": 12,
                "condition": "good",
                "districtId": "d-sov",
                "terms": ["return_after", "no_deposit", "pickup"],
                "days": 45,
            },
        ),
        item(
            "sh-sm-net",
            by_org("o-sportmaster"),
            {
                "name": "Волейбольная сетка с тросом",
                "kind": "net",
                "sportId": "s-volleyball",
                "quantity": 2,
                "condition": "good",
                "districtId": "d-sov",
                "terms": ["return_after", "bring_to_place"],
                "note": "Поможем натянуть на дворовой площадке.",
                "days": 45,
            },
        ),
        item(
            "sh-sm-skis",
            by_org("o-sportmaster"),
            {
                "name": "Беговые лыжи с ботинками",
                "kind": "skis",
                "sportId": "s-skiing",
                "quantity": 8,
                "condition": "good",
                "districtId": "d-sov",
                "terms": ["return_after", "pickup"],
                "note": "Размеры обуви от 38 до 45, подберём при выдаче.",
                "days": 35,
            },
        ),
        item(
            "sh-pavel-rackets",
            by_user("u-pavel"),
            {
                "name": "Ракетка для бадминтона",
                "kind": "racket",
                "sportId": "s-badminton",
                "quantity": 4,
                "condition": "good",
                "districtId": "d-solnech",
                "terms": ["return_after", "pickup"],
                "note": "Запасные ракетки, играю по вторникам и четвергам.",
                "days": 12,
            },
        ),
        item(
            "sh-pavel-shuttles",
            by_user("u-pavel"),
            {
                "name": "Воланы пластиковые",
                "kind": "shuttle",
                "sportId": "s-badminton",
                "quantity": 12,
                "condition": "new",
                "districtId": "d-solnech",
                "terms": ["no_deposit"],
                "note": "Воланы можно не возвращать.",
                "days": 12,
            },
        ),
        item(
            "sh-artem-pingpong",
            by_user("u-artem"),
            {
                "name": "Ракетка для настольного тенниса",
                "kind": "racket",
                "sportId": "s-tabletennis",
                "quantity": 2,
                "condition": "used",
                "districtId": "d-oct",
                "terms": ["return_after", "no_deposit"],
                "days": 8,
            },
        ),
        item(
            "sh-ksenia-ball",
            by_user("u-ksenia"),
            {
                "name": "Волейбольный мяч",
                "kind": "ball",
                "sportId": "s-volleyball",
                "quantity": 1,
                "condition": "used",
                "districtId": "d-center",
                "terms": ["return_after", "no_deposit"],
                "days": 6,
            },
        ),
        item(
            "sh-konstantin-poles",
            by_user("u-konstantin"),
            {
                "name": "Треккинговые палки",
                "kind": "poles",
                "sportId": "s-hiking",
                "quantity": 4,
                "condition": "good",
                "districtId": "d-kirov",
                "terms": ["return_after", "pickup"],
                "days": 18,
            },
        ),
        item(
            "sh-sofia-helmet",
            by_user("u-sofia"),
            {
                "name": "Велошлем, размер M",
                "kind": "protection",
                "sportId": "s-cycling",
                "quantity": 2,
                "condition": "good",
                "districtId": "d-vzlet",
                "terms": ["return_after", "no_deposit", "pickup"],
                "days": 5,
            },
        ),
    ]

    lines: list[Entity] = []

    def line(id_: str, event_id: str, name: str, kind: str, quantity: int) -> None:
        if has_event(event_id):
            lines.append(
                {
                    "id": id_,
                    "eventId": event_id,
                    "name": name,
                    "kind": kind,
                    "quantity": quantity,
                    "createdAt": ago(2 * day),
                }
            )

    line("gl-street-ball", "e-streetball", "Баскетбольный мяч", "ball", 2)
    line("gl-street-bibs", "e-streetball", "Манишки", "bibs", 6)
    line("gl-volley-ball", "e-volley-hall", "Волейбольный мяч", "ball", 3)
    line("gl-badm-racket", "e-badminton", "Ракетка", "racket", 4)
    line("gl-badm-shuttle", "e-badminton", "Воланы", "shuttle", 6)
    line("gl-yoga-mat", "e-yoga-embankment", "Коврик для йоги", "mat", 6)

    pledges: list[Entity] = []

    def pledge(id_: str, line_id: str, user_id: str, quantity: int) -> None:
        found = next((x for x in lines if x["id"] == line_id), None)
        if found is not None:
            pledges.append(
                {
                    "id": id_,
                    "eventId": found["eventId"],
                    "lineId": line_id,
                    "userId": user_id,
                    "quantity": quantity,
                    "at": ago(day),
                }
            )

    pledge("gp-1", "gl-street-ball", "u-artem", 1)
    pledge("gp-2", "gl-volley-ball", "u-ksenia", 1)
    pledge("gp-3", "gl-badm-racket", "u-pavel", 2)
    pledge("gp-4", "gl-badm-racket", "u-alina", 1)
    pledge("gp-5", "gl-yoga-mat", "u-alina", 1)
    pledge("gp-6", "gl-yoga-mat", "u-ksenia", 1)

    loans: list[Entity] = []

    def loan(
        id_: str,
        item_id: str,
        line_id: str | None,
        event_id: str,
        requester_id: str,
        quantity: int,
        status: str,
        minutes_ago: int,
        comment: str = "",
    ) -> None:
        if not has_event(event_id):
            return
        loans.append(
            {
                "id": id_,
                "itemId": item_id,
                "eventId": event_id,
                "lineId": line_id,
                "requesterId": requester_id,
                "quantity": quantity,
                "comment": comment,
                "status": status,
                "reason": "",
                "createdAt": ago(minutes_ago),
                "decidedAt": None if status == "pending" else ago(minutes_ago - 30),
                "returnedAt": ago(minutes_ago - 120) if status == "returned" else None,
            }
        )

    loan(
        "gn-1",
        "sh-sm-volley",
        "gl-volley-ball",
        "e-volley-hall",
        "u-dmitry",
        2,
        "accepted",
        day,
        "Заберу в четверг после работы.",
    )
    loan(
        "gn-2",
        "sh-sm-bibs",
        "gl-street-bibs",
        "e-streetball",
        "u-dmitry",
        6,
        "pending",
        3 * hour,
        "Нужны на субботу, чтобы различать тройки.",
    )
    loan("gn-3", "sh-sm-volley", None, "e-past-volley", "u-dmitry", 2, "returned", 7 * day)

    support: list[Entity] = []

    def need(n: Entity) -> None:
        if n.get("eventId") and not has_event(n["eventId"]):
            n["eventId"] = None
        support.append({"offers": [], "closedByOrgId": None, "closedAt": None, **n})

    need(
        {
            "id": "sn-legends-kids",
            "orgId": "o-legends",
            "eventId": "e-football-kids",
            "title": "Нужны 10 мячей размера 4 и 2 сетки для детских ворот",
            "details": "Детская группа выросла до 20 человек, своих мячей на всех не хватает.",
            "deadline": end_of_day_in(-2),
            "status": "closed",
            "closedByOrgId": "o-sportmaster",
            "closedAt": ago(3 * day),
            "offers": [
                {
                    "id": "so-1",
                    "sponsorOrgId": "o-sportmaster",
                    "userId": "u-andrey",
                    "comment": "Дадим 10 мячей на сезон, сетки привезём и повесим в субботу.",
                    "status": "accepted",
                    "at": ago(5 * day),
                    "decidedAt": ago(3 * day),
                },
            ],
            "createdBy": "u-roman",
            "createdAt": ago(9 * day),
        }
    )
    need(
        {
            "id": "sn-ladya-tournament",
            "orgId": "o-ladya",
            "eventId": "e-chess-kids",
            "title": "Нужны 2 демонстрационные доски и 10 мест в зале для детского турнира",
            "details": "Хотим провести открытый турнир для детей 7–10 лет. Своих досок для разбора партий нет.",
            "deadline": end_of_day_in(11),
            "status": "open",
            "offers": [
                {
                    "id": "so-2",
                    "sponsorOrgId": "o-sportmaster",
                    "userId": "u-andrey",
                    "comment": "Демонстрационные доски есть, привезём к началу и заберём после турнира.",
                    "status": "pending",
                    "at": ago(5 * hour),
                    "decidedAt": None,
                },
            ],
            "createdBy": "u-olga",
            "createdAt": ago(2 * day),
        }
    )
    need(
        {
            "id": "sn-morning-hall",
            "orgId": "o-morning",
            "eventId": None,
            "title": "Нужен тёплый зал на зиму для утренней зарядки, 10 мест",
            "details": "Занимаемся по будням в 8:00, группа 55+. Подойдёт холл, спортзал школы или библиотека.",
            "deadline": end_of_day_in(11),
            "status": "open",
            "createdBy": "u-valentina",
            "createdAt": ago(4 * day),
        }
    )
    need(
        {
            "id": "sn-yoga-winter",
            "orgId": "o-vorontsova",
            "eventId": None,
            "title": "Нужен зал по субботам для бесплатных занятий йогой, 15 человек",
            "details": "Летом занимаемся на набережной. На холодное время ищем зал на полтора часа в неделю.",
            "deadline": end_of_day_in(25),
            "status": "open",
            "createdBy": "u-elena",
            "createdAt": ago(day),
        }
    )

    def notice(
        id_: str,
        user_id: str,
        type_: str,
        title: str,
        text: str,
        link: str,
        minutes_ago: int,
        read: bool = False,
    ) -> None:
        if not any(u["id"] == user_id for u in users):
            return
        notifications.append(
            {
                "id": id_,
                "userId": user_id,
                "type": type_,
                "title": title,
                "text": text,
                "link": link,
                "read": read,
                "createdAt": ago(minutes_ago),
            }
        )

    notice(
        "n-inv-1",
        "u-andrey",
        "gear_request",
        "Просят инвентарь",
        "Дмитрий Орлов просит «Манишки, 6 красных и 6 синих», 6 штук, на «Стритбол 3×3 на открытой площадке».",
        "/inventory?tab=mine",
        3 * hour,
    )
    notice(
        "n-inv-2",
        "u-olga",
        "support_offer",
        "Партнёр готов помочь",
        "«Спортмастерская» откликнулась на просьбу «Нужны 2 демонстрационные доски и 10 мест в зале для детского турнира».",
        "/org/o-ladya#support",
        5 * hour,
    )
    notice(
        "n-inv-3",
        "u-dmitry",
        "gear_accepted",
        "Вам дадут инвентарь",
        "«Спортмастерская» даст «Волейбольный мяч», 2 штуки, на «Волейбол в зале: смешанные команды».",
        "/events/e-volley-hall#inventory",
        day - 30,
        True,
    )
    notice(
        "n-inv-4",
        "u-andrey",
        "support_new",
        "Клубу нужна помощь",
        "Сообщество «Бодрое утро»: нужен тёплый зал на зиму для утренней зарядки, 10 мест.",
        "/inventory?tab=needs",
        4 * day,
        True,
    )

    return {"lines": lines, "pledges": pledges, "shelf": shelf, "loans": loans, "support": support}
