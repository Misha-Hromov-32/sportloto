"""Демо оплаты на сайте.

У Дмитрия две встречи с оплатой на сайте: баскетбол «с человека» (двое оплатили) и складчина на
волейбол с порогом 8 (у двоих деньги заморожены на карте, один оплатил по СБП, Наталья ещё не
оплатила). На полке Дмитрий продаёт мяч, а насос он уже продал Сергею: 400 ₽ на его балансе.
"""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

from app.domain import clock
from app.domain.lib.payments import payment_settings, quote, split_max_share
from app.domain.types import Entity

HOUR_MIN = 60
DAY_MIN = 24 * HOUR_MIN


def seed_payments(x: dict[str, Any]) -> dict[str, list[Entity]]:
    ev: Callable[[str, Entity], Entity] = x["ev"]
    at: Callable[[int, str], str] = x["at"]
    ago: Callable[[float], str] = x["ago"]
    events: list[Entity] = x["events"]
    participations: list[Entity] = x["participations"]
    notifications: list[Entity] = x["notifications"]
    s = payment_settings(None)
    dmitry = {"kind": "user", "id": "u-dmitry"}

    basket = ev(
        "e-pay-basket",
        {
            "title": "Баскетбол 5×5 в зале",
            "sportId": "s-basketball",
            "organizer": dict(dmitry),
            "createdBy": "u-dmitry",
            "startsAt": at(3, "20:00"),
            "durationMin": 120,
            "place": dict(x["place"]),
            "description": "Играем 5×5 на полную площадку, составы делим на месте. Зал арендован на два часа, мячи мои. Оплата на сайте: так проще всем, и деньги вернутся сами, если игру отменят.",
            "level": "amateur",
            "firstStep": {
                "intensity": "high",
                "bring": "Кроссовки для зала, вода, светлая и тёмная футболки",
                "preparation": "Нужно уметь вести мяч и бросать",
                "age": "",
                "howToFind": "Вход со двора, звонок «Спортзал»",
                "amenities": ["Раздевалка", "Душ"],
                "firstTimeNote": "",
            },
            "price": {"kind": "fixed", "amount": 350},
            "paymentNote": "Оплата на сайте",
            "cancelPolicy": {"kind": "hoursBefore", "hours": 6},
            "capacity": 12,
            "privateInfo": "Пропуск в зал по фамилии, телефон Дмитрия: +7 902 940-33-44.",
            "coverUrl": x["covers"]["basketball"],
            "createdAt": ago(2 * DAY_MIN),
            "updatedAt": ago(2 * DAY_MIN),
            "paymentMode": "online",
        },
    )
    total = 3600
    min_ = 8
    volley = ev(
        "e-pay-volley",
        {
            "title": "Волейбол: аренда зала на всех",
            "sportId": "s-volleyball",
            "organizer": dict(dmitry),
            "createdBy": "u-dmitry",
            "startsAt": at(5, "19:00"),
            "durationMin": 120,
            "place": dict(x["place"]),
            "description": "Сняли зал на два часа, аренду делим поровну. Чем больше нас, тем меньше доля. По карте деньги только замораживаются, а за два часа до игры спишется итоговая доля. Если не наберёмся восьмером, всё вернётся.",
            "level": "any",
            "beginnersWelcome": True,
            "firstStep": {
                "intensity": "medium",
                "bring": "Сменная обувь со светлой подошвой, вода",
                "preparation": "Правила объясню на месте",
                "age": "",
                "howToFind": "Вход со двора, звонок «Спортзал»",
                "amenities": ["Раздевалка"],
                "firstTimeNote": "Новичков ставлю в пару с опытными игроками.",
            },
            "price": {"kind": "split", "total": total, "note": "на аренду зала"},
            "paymentNote": "Оплата на сайте",
            "cancelPolicy": {"kind": "eveBefore", "time": "18:00"},
            "capacity": 12,
            "minParticipants": min_,
            "privateInfo": "Код на калитке 2580.",
            "coverUrl": x["covers"]["volleyball"],
            "createdAt": ago(3 * DAY_MIN),
            "updatedAt": ago(3 * DAY_MIN),
            "paymentMode": "online",
        },
    )
    events.extend([basket, volley])

    payments: list[Entity] = []
    dues: list[Entity] = []

    def shift(iso: str, minutes: float) -> str:
        return clock.iso(clock.parse(iso) + timedelta(minutes=minutes))

    start = clock.parse(volley["startsAt"])
    collect_at = clock.iso(start - timedelta(hours=s["collectHoursBefore"]))
    opens_at = clock.iso(start - timedelta(days=s["splitOpenDays"]))
    max_share = split_max_share(total, min_)

    def member(n: int, e: Entity, user_id: str, minutes_ago: float, pay: tuple[str, bool] | None) -> None:
        created = ago(minutes_ago)
        participation_id = f"p-pay-{n}"
        participations.append(
            {
                "id": participation_id,
                "eventId": e["id"],
                "userId": user_id,
                "status": "confirmed",
                "prevStatus": None,
                "note": "",
                "rejectReason": "",
                "source": "self",
                "createdAt": created,
                "decidedAt": created,
            }
        )
        split = e["price"]["kind"] == "split"
        dues.append(
            {
                "id": f"pdue-pay-{n}",
                "eventId": e["id"],
                "participationId": participation_id,
                "userId": user_id,
                "dueAt": collect_at if split else shift(created, s["holdMinutes"]),
                "opensAt": opens_at if split else None,
                "notifiedAt": created,
                "status": "paid" if pay else "open",
                "createdAt": created,
            }
        )
        if pay is None:
            return
        method, held = pay
        base = e["price"]["amount"] if e["price"]["kind"] == "fixed" else max_share
        q = quote(base, method, s, 0)
        payments.append(
            {
                "id": f"pay-demo-{n}",
                "userId": user_id,
                "kind": "event_share",
                "targetId": e["id"],
                "method": method,
                "base": q["base"],
                "fee": q["fee"],
                "total": q["total"],
                "feeParts": q["feeParts"],
                "initialTotal": q["total"],
                "capture": not held,
                "provider": "fake",
                "providerPaymentId": None,
                "status": "held" if held else "paid",
                "capturedAmount": 0 if held else q["total"],
                "refundedAmount": 0,
                "confirmationUrl": None,
                "forfeited": False,
                "creditedAt": None,
                "test": True,
                "createdAt": shift(created, 2),
                "updatedAt": shift(created, 4),
                "paidAt": None if held else shift(created, 4),
                "reason": "",
            }
        )

    member(1, basket, "u-timur", 30 * HOUR_MIN, ("sbp", False))
    member(2, basket, "u-ruslan", 20 * HOUR_MIN, ("bank_card", False))
    member(3, volley, "u-konstantin", 26 * HOUR_MIN, ("bank_card", True))
    member(4, volley, "u-oleg", 22 * HOUR_MIN, ("sbp", False))
    member(5, volley, "u-pavel", 10 * HOUR_MIN, ("bank_card", True))
    member(6, volley, "u-natalia", 3 * HOUR_MIN, None)
    notifications.append(
        {
            "id": "n-pay-natalia",
            "userId": "u-natalia",
            "type": "pay_due",
            "title": "Открыта оплата складчины",
            "text": f"Оплатите долю за «{volley['title']}» до {{{{date:{collect_at}}}}}. По карте деньги заморозятся, спишем итоговую долю за {s['collectHoursBefore']} ч до начала.",
            "link": "/events/e-pay-volley#pay",
            "read": False,
            "createdAt": ago(3 * HOUR_MIN),
        }
    )

    # Насос Дмитрий уже продал: Сергей получил его, деньги на балансе Дмитрия
    pump = quote(400, "sbp", s, s["goodsMarkup"])
    payments.append(
        {
            "id": "pay-demo-pump",
            "userId": "u-sergey",
            "kind": "item_order",
            "targetId": "ord-demo-pump",
            "method": "sbp",
            "base": pump["base"],
            "fee": pump["fee"],
            "total": pump["total"],
            "feeParts": pump["feeParts"],
            "initialTotal": pump["total"],
            "capture": True,
            "provider": "fake",
            "providerPaymentId": None,
            "status": "paid",
            "capturedAmount": pump["total"],
            "refundedAmount": 0,
            "confirmationUrl": None,
            "forfeited": False,
            "creditedAt": ago(2 * DAY_MIN),
            "test": True,
            "createdAt": ago(4 * DAY_MIN),
            "updatedAt": ago(4 * DAY_MIN - 3),
            "paidAt": ago(4 * DAY_MIN - 3),
            "reason": "",
        }
    )
    orders = [
        {
            "id": "ord-demo-pump",
            "itemId": "sh-dmitry-pump",
            "itemName": "Насос для мячей с иглой",
            "buyerId": "u-sergey",
            "seller": dict(dmitry),
            "quantity": 1,
            "price": 400,
            "amount": 400,
            "paymentId": "pay-demo-pump",
            "status": "received",
            "payDueAt": ago(4 * DAY_MIN - s["holdMinutes"]),
            "autoCompleteAt": ago(4 * DAY_MIN - 3 - s["autoCompleteDays"] * DAY_MIN),
            "createdAt": ago(4 * DAY_MIN),
            "updatedAt": ago(2 * DAY_MIN),
            "paidAt": ago(4 * DAY_MIN - 3),
            "receivedAt": ago(2 * DAY_MIN),
            "canceledAt": None,
            "canceledBy": None,
            "reason": "",
        }
    ]
    credit_rows = [
        {
            "id": "cr-demo-pump",
            "recipient": dict(dmitry),
            "amount": 400,
            "source": "order",
            "targetId": "ord-demo-pump",
            "title": "Насос для мячей с иглой",
            "at": ago(2 * DAY_MIN),
        }
    ]
    return {
        "payments": payments,
        "paymentOps": [],
        "paymentDues": dues,
        "orders": orders,
        "credits": credit_rows,
        "payouts": [],
    }


def with_sale_items(inventory: dict[str, Any], ago: Callable[[float], str]) -> dict[str, Any]:
    """Мяч Дмитрия на полке с пометкой «Продаю»."""
    inventory["shelf"].append(
        {
            "id": "sh-dmitry-ball",
            "owner": {"kind": "user", "id": "u-dmitry"},
            "createdBy": "u-dmitry",
            "name": "Баскетбольный мяч Molten, размер 7",
            "kind": "ball",
            "sportId": "s-basketball",
            "quantity": 1,
            "condition": "good",
            "districtId": "d-oct",
            "terms": ["pickup"],
            "note": "Почти новый, играл пару раз. Отдам у школы № 10 на Кецховели.",
            "createdAt": ago(DAY_MIN),
            "updatedAt": ago(DAY_MIN),
            "sale": {"price": 2500},
        }
    )
    return inventory
