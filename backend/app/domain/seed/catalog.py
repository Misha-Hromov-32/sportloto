"""Справочники: районы Красноярска, дерево направлений, правила платформы.

Всё — данные, а не код.
"""

import copy
from typing import Any

from app.domain.types import Entity

DISTRICTS: list[Entity] = [
    {"id": "d-center", "name": "Центральный", "lat": 56.0153, "lng": 92.8932},
    {"id": "d-zhd", "name": "Железнодорожный", "lat": 56.0255, "lng": 92.841},
    {"id": "d-oct", "name": "Октябрьский", "lat": 56.029, "lng": 92.784},
    {"id": "d-akadem", "name": "Академгородок", "lat": 56.004, "lng": 92.771},
    {"id": "d-vetluzh", "name": "Ветлужанка", "lat": 56.027, "lng": 92.739},
    {"id": "d-sov", "name": "Советский", "lat": 56.056, "lng": 92.93},
    {"id": "d-vzlet", "name": "Взлётка", "lat": 56.049, "lng": 92.906},
    {"id": "d-solnech", "name": "Солнечный", "lat": 56.073, "lng": 92.984},
    {"id": "d-north", "name": "Северный", "lat": 56.064, "lng": 92.902},
    {"id": "d-sverd", "name": "Свердловский", "lat": 55.985, "lng": 92.883},
    {"id": "d-kirov", "name": "Кировский", "lat": 55.997, "lng": 92.931},
    {"id": "d-lenin", "name": "Ленинский", "lat": 56.001, "lng": 92.995},
    {"id": "d-pokrovka", "name": "Покровка", "lat": 56.024, "lng": 92.864},
]

_chess_clock: Entity = {
    "key": "timeControl",
    "label": "Контроль времени",
    "type": "select",
    "options": ["Блиц 3+2", "Блиц 5+3", "Рапид 15+10", "Классика 60+30", "Без часов"],
}
_tennis_surface: Entity = {
    "key": "surface",
    "label": "Покрытие",
    "type": "select",
    "options": ["Хард", "Грунт", "Трава", "Ковёр"],
}
_football_format: Entity = {
    "key": "format",
    "label": "Формат игры",
    "type": "select",
    "options": ["5×5", "6×6", "7×7", "8×8", "11×11"],
}
_distance: Entity = {
    "key": "distance",
    "label": "Дистанция",
    "type": "text",
    "placeholder": "Например, 5 км",
}
_rental: Entity = {
    "key": "rental",
    "label": "Прокат инвентаря",
    "type": "select",
    "options": ["Есть на месте", "Нет, нужен свой"],
}

CATEGORIES: list[Entity] = [
    {"id": "c-games", "name": "Игровые", "icon": "SoccerBall", "order": 1, "parentId": None, "fields": []},
    {
        "id": "c-cyclic",
        "name": "Циклические",
        "icon": "PersonSimpleRun",
        "order": 2,
        "parentId": None,
        "fields": [_distance],
    },
    {
        "id": "c-combat",
        "name": "Единоборства",
        "icon": "BoxingGlove",
        "order": 3,
        "parentId": None,
        "fields": [],
    },
    {
        "id": "c-mind",
        "name": "Интеллектуальные",
        "icon": "Strategy",
        "order": 4,
        "parentId": None,
        "fields": [],
    },
    {
        "id": "c-phygital",
        "name": "Фиджитал",
        "icon": "GameController",
        "order": 5,
        "parentId": None,
        "fields": [],
    },
    {
        "id": "c-fitness",
        "name": "Фитнес и здоровье",
        "icon": "Heartbeat",
        "order": 6,
        "parentId": None,
        "fields": [],
    },
    {
        "id": "c-winter",
        "name": "Зимние",
        "icon": "Snowflake",
        "order": 7,
        "parentId": None,
        "fields": [_rental],
    },
    {
        "id": "c-senior",
        "name": "Для старшего поколения",
        "icon": "HandHeart",
        "order": 8,
        "parentId": None,
        "fields": [],
    },
    {
        "id": "c-ball",
        "name": "С мячом",
        "icon": "Volleyball",
        "order": 1,
        "parentId": "c-games",
        "fields": [],
    },
    {
        "id": "c-racket",
        "name": "С ракеткой",
        "icon": "TennisBall",
        "order": 2,
        "parentId": "c-games",
        "fields": [],
    },
]

# SportSeed: [id, name, icon, categoryIds, synonyms, popular?, fields?]
_CATALOG: list[tuple[Any, ...]] = [
    (
        "s-football",
        "Футбол",
        "SoccerBall",
        ["c-games", "c-ball"],
        ["мини-футбол", "футзал", "дворовый футбол", "футик", "футбик", "футбольчик"],
        True,
        [_football_format],
    ),
    (
        "s-basketball",
        "Баскетбол",
        "Basketball",
        ["c-games", "c-ball"],
        ["стритбол", "баскет", "баскетбольчик"],
        True,
    ),
    (
        "s-volleyball",
        "Волейбол",
        "Volleyball",
        ["c-games", "c-ball"],
        ["пляжный волейбол", "волейбол в зале", "волик", "волейбольчик"],
        True,
    ),
    (
        "s-tennis",
        "Теннис",
        "TennisBall",
        ["c-games", "c-racket"],
        ["большой теннис"],
        True,
        [_tennis_surface],
    ),
    (
        "s-tabletennis",
        "Настольный теннис",
        "PingPong",
        ["c-games", "c-racket"],
        ["пинг-понг", "пингпонг", "теннис настольный"],
    ),
    ("s-badminton", "Бадминтон", "Racquet", ["c-games", "c-racket"], ["воланчик", "бадик", "воланы"]),
    ("s-hockey", "Хоккей", "Hockey", ["c-games", "c-winter"], ["хоккей с шайбой", "хоккей на льду"]),
    (
        "s-running",
        "Бег",
        "PersonSimpleRun",
        ["c-cyclic"],
        ["пробежка", "джоггинг", "бегать", "бегаем", "бегаю", "побегать", "марафон"],
        True,
    ),
    (
        "s-nordic",
        "Скандинавская ходьба",
        "PersonSimpleWalk",
        ["c-cyclic", "c-senior"],
        ["северная ходьба", "ходьба с палками", "ходить с палками", "палки"],
        True,
    ),
    (
        "s-cycling",
        "Велопрогулки",
        "PersonSimpleBike",
        ["c-cyclic"],
        ["велосипед", "вело", "велопрогулка", "велик", "велики", "покататься на велосипеде"],
    ),
    (
        "s-swimming",
        "Плавание",
        "PersonSimpleSwim",
        ["c-cyclic"],
        ["бассейн", "плавать", "плаваем", "поплавать", "плаванье"],
    ),
    ("s-hiking", "Походы", "PersonSimpleHike", ["c-cyclic"], ["поход", "треккинг", "столбы", "хайкинг"]),
    ("s-boxing", "Бокс", "BoxingGlove", ["c-combat"], ["кикбоксинг"]),
    ("s-karate", "Карате", "PersonSimpleTaiChi", ["c-combat"], ["киокушинкай"]),
    (
        "s-martial",
        "Единоборства",
        "BoxingGlove",
        ["c-combat"],
        ["самбо", "борьба", "дзюдо", "вольная борьба", "айкидо", "рукопашный бой"],
    ),
    (
        "s-chess",
        "Шахматы",
        "Strategy",
        ["c-mind", "c-senior"],
        ["блиц", "шахматный турнир"],
        True,
        [_chess_clock],
    ),
    ("s-checkers", "Шашки", "Strategy", ["c-mind", "c-senior"], ["русские шашки"]),
    (
        "s-phygital",
        "Фиджитал-игры",
        "GameController",
        ["c-phygital"],
        ["фиджитал", "phygital", "киберспорт и спорт"],
    ),
    (
        "s-workout",
        "Зарядка",
        "Sun",
        ["c-fitness", "c-senior"],
        ["зарядка во дворе", "утренняя зарядка", "гимнастика"],
        True,
    ),
    ("s-yoga", "Йога", "FlowerLotus", ["c-fitness"], [], True),
    (
        "s-dance",
        "Танцы",
        "Heartbeat",
        ["c-fitness"],
        ["бачата", "сальса", "хастл", "латина", "бальные танцы", "потанцевать"],
    ),
    ("s-streetworkout", "Воркаут", "Barbell", ["c-fitness"], ["турники", "брусья", "street workout"]),
    (
        "s-taichi",
        "Тайцзи и цигун",
        "PersonSimpleTaiChi",
        ["c-fitness", "c-senior"],
        ["тай чи", "цигун", "дыхательная гимнастика"],
    ),
    (
        "s-skiing",
        "Лыжи",
        "PersonSimpleSki",
        ["c-winter", "c-cyclic"],
        ["беговые лыжи", "лыжня", "лыжная прогулка"],
    ),
    ("s-skating", "Коньки", "Snowflake", ["c-winter"], ["каток", "катке", "катание на коньках"]),
]


def build_sports(created_at: str) -> list[Entity]:
    out: list[Entity] = []
    for seed in _CATALOG:
        id_, name, icon, category_ids, synonyms = seed[:5]
        popular = seed[5] if len(seed) > 5 else False
        fields = seed[6] if len(seed) > 6 else []
        # Списки копируются, чтобы правки направления не меняли справочник модуля.
        out.append(
            {
                "id": id_,
                "name": name,
                "icon": icon,
                "categoryIds": list(category_ids),
                "synonyms": list(synonyms),
                "popular": popular,
                "fields": copy.deepcopy(fields),
                "kind": "catalog",
                "mergedInto": None,
                "createdBy": None,
                "createdAt": created_at,
            }
        )
    return out


RULES: list[Entity] = [
    {
        "id": "rule-1",
        "number": 1,
        "title": "Событие — это совместное занятие",
        "text": "На платформе публикуют живые встречи для спорта и движения. Продажа абонементов и вещей, реклама и сбор денег без встречи сюда не подходят.",
    },
    {
        "id": "rule-2",
        "number": 2,
        "title": "Честные условия",
        "text": "Время, место, цена, уровень и правила записи указаны так, как будет на самом деле. Если что-то меняется, организатор меняет карточку, а не пишет об этом в стороннем чате.",
    },
    {
        "id": "rule-3",
        "number": 3,
        "title": "Уважение к людям",
        "text": "Без оскорблений, грубости и насмешек над уровнем подготовки, возрастом, внешностью или происхождением.",
    },
    {
        "id": "rule-4",
        "number": 4,
        "title": "Без спама и рекламы",
        "text": "В обсуждении задают вопросы о событии и отвечают на них. Повторяющиеся сообщения, ссылки на сторонние магазины и каналы скрываются.",
    },
    {
        "id": "rule-5",
        "number": 5,
        "title": "Безопасность",
        "text": "Организатор предупреждает о нагрузке и нужной подготовке. Дети участвуют вместе со взрослым, если в карточке не сказано иное.",
    },
    {
        "id": "rule-6",
        "number": 6,
        "title": "Личные данные",
        "text": "Не публикуйте чужие телефоны, адреса и фотографии без согласия. Контакты организатора видят только подтверждённые участники.",
    },
    {
        "id": "rule-7",
        "number": 7,
        "title": "Организации",
        "text": "Страница организации появляется после проверки администратором. От имени организации публикует только её представитель.",
    },
    {
        "id": "rule-8",
        "number": 8,
        "title": "Деньги",
        "text": "Платформа не принимает платежи. Организатор указывает цену и правило отмены заранее и не требует предоплату на сторонние карты. Если событие отменяет организатор, деньги возвращаются полностью.",
    },
]


def _photo(id_: str, w: int = 900) -> str:
    """Фотографии для обложек событий (Unsplash). К этапу 2 заменяются локальными копиями."""
    return f"https://images.unsplash.com/photo-{id_}?w={w}&q=70&auto=format&fit=crop"


COVERS: dict[str, str] = {
    "running": _photo("1552674605-db6ffd4facb5"),
    "running2": _photo("1540539234-c14a20fb7c7b"),
    "football": _photo("1574629810360-7efbbe195018"),
    "football2": _photo("1517466787929-bc90951d0974"),
    "footballKids": _photo("1494778696781-8f23fd5553c4"),
    "footballYard": _photo("1598399615261-adafbbb044fc"),
    "chess": _photo("1529699211952-734e80c4d42b"),
    "chess2": _photo("1586165368502-1bad197a6461"),
    "workout": _photo("1549576490-b0b4831ef60a"),
    "workout2": _photo("1527933053326-89d1746b76b9"),
    "volleyball": _photo("1612872087720-bb876e2e67d1"),
    "volleyball2": _photo("1790599313518-dfb206424b36"),
    "nordic": _photo("1607962837359-5e7e89f86776"),
    "yoga": _photo("1545205597-3d9d02c29597"),
    "yoga2": _photo("1588286840104-8957b019727f"),
    "basketball": _photo("1519861531473-9200262188bf"),
    "basketball2": _photo("1546519638-68e109498ffc"),
    "badminton": _photo("1599474924187-334a4ae5bd3c"),
    "cycling": _photo("1517649763962-0c623066013b"),
    "tennis": _photo("1622279457486-62dcc4a431d6"),
    "swimming": _photo("1530549387789-4c1017266635"),
    "boxing": _photo("1673131064273-f63a54f1352e"),
    "karate": _photo("1729166240656-9646bc66b705"),
    "skiing": _photo("1505985098938-d1db678d02b3"),
    "streetworkout": _photo("1646743933969-e977d2c046fa"),
    "friends": _photo("1529156069898-49953e39b3ac"),
}
