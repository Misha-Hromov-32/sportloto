"""С11 «Быстрое создание встречи».

Четыре шаблона в начале мастера: выбор заполняет поля, остальное человек дописывает сам.
Шаблоны — данные, а не код экрана: их отдаёт сервер, и администратор сможет
добавить новые без правки интерфейса.
"""

from app.domain.features.kit import db
from app.domain.routing import Route, route
from app.domain.types import Entity

TEMPLATES: list[Entity] = [
    {
        "id": "tpl-run",
        "name": "Пробежка",
        "hint": "5 км в разговорном темпе, утром",
        "sportId": "s-running",
        "fields": {
            "title": "Пробежка в спокойном темпе",
            "description": "Бежим 5 км в разговорном темпе, никого не оставляем позади. Можно чередовать бег и шаг. После пробежки немного растягиваемся.",
            "durationMin": 60,
            "capacity": 20,
            "minParticipants": None,
            "level": "any",
            "beginnersWelcome": True,
            "joinMode": "open",
            "time": "08:00",
            "bring": "Удобные кроссовки, вода",
            "preparation": "Специальная подготовка не нужна",
            "intensity": "medium",
            "firstTimeNote": "Если бежите впервые, скажите в начале, подстроим темп.",
        },
    },
    {
        "id": "tpl-football",
        "name": "Игра 5×5",
        "hint": "Мини-футбол, 10 игроков и пара запасных",
        "sportId": "s-football",
        "extra": {"format": "5×5"},
        "fields": {
            "title": "Мини-футбол 5×5",
            "description": "Играем 5×5 с заменами, команды делим на месте. Уровень любой, играем без грубости.",
            "durationMin": 90,
            "capacity": 12,
            "minParticipants": 10,
            "level": "amateur",
            "beginnersWelcome": False,
            "joinMode": "open",
            "time": "19:00",
            "bring": "Сменная обувь, тёмная и светлая футболка",
            "preparation": "Умеете отдать пас и ударить по воротам",
            "intensity": "high",
            "firstTimeNote": "",
        },
    },
    {
        "id": "tpl-chess",
        "name": "Шахматный вечер",
        "hint": "Партии и разбор, доски дадим",
        "sportId": "s-chess",
        "extra": {"timeControl": "Рапид 15+10"},
        "fields": {
            "title": "Шахматный вечер: партии и разбор",
            "description": "Играем партии с контролем 15+10, потом вместе разбираем интересные позиции. Подойдёт и тем, кто давно не играл.",
            "durationMin": 150,
            "capacity": 16,
            "minParticipants": None,
            "level": "any",
            "beginnersWelcome": True,
            "joinMode": "open",
            "time": "18:30",
            "bring": "Ничего, доски и часы будут на месте",
            "preparation": "Знаете, как ходят фигуры",
            "intensity": "low",
            "firstTimeNote": "Новичку подберём соперника по силам.",
        },
    },
    {
        "id": "tpl-workout",
        "name": "Зарядка во дворе",
        "hint": "Полчаса утром, для любого возраста",
        "sportId": "s-workout",
        "fields": {
            "title": "Зарядка во дворе для всех возрастов",
            "description": "Полчаса мягкой зарядки на улице: разминаем суставы, делаем простые упражнения и дышим. Каждый в своём темпе.",
            "durationMin": 30,
            "capacity": None,
            "minParticipants": None,
            "level": "any",
            "beginnersWelcome": True,
            "joinMode": "open",
            "time": "09:00",
            "bring": "Удобную одежду по погоде",
            "preparation": "Не нужна",
            "intensity": "low",
            "firstTimeNote": "Если что-то болит, скажите ведущему, он подскажет замену.",
        },
    },
]


def list_templates() -> list[Entity]:
    sports = db().sports
    return [
        {
            **t,
            "icon": next((s for s in sports if s["id"] == t["sportId"]), {}).get("icon"),
            "extra": t.get("extra", {}),
        }
        for t in TEMPLATES
        if any(s["id"] == t["sportId"] and not s.get("mergedInto") for s in sports)
    ]


def templates_routes() -> list[Route]:
    return [route("get", r"^/event-templates$", lambda _p, _b, _q: list_templates())]
