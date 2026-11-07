"""В4, В5, Н1: демо-данные площадок Красноярска.

Названия вымышленные, районы и точки примерные.
Две допущенные организации-площадки и одна на проверке; часть событий сидов привязана к площадкам.
"""

import zlib
from collections.abc import Callable
from typing import Any

from app.domain.lib.geo import distance_km
from app.domain.lib.venues import local_date, slot_starts
from app.domain.seed.catalog import COVERS
from app.domain.types import Entity

# Контекст сидов: now (момент сборки), ago, at, users, organizations, events,
# participations, notifications

TZ = "Asia/Krasnoyarsk"
HOUR = 60
DAY = 24 * HOUR

ALL_ACCESS: list[str] = ["ramp", "elevator", "accessibleToilet", "accessibleParking"]

# Доля занятых окон по типу площадки, в процентах.
BUSY: dict[str, int] = {
    "hall": 45,
    "court": 40,
    "pool": 50,
    "ice": 55,
    "studio": 35,
    "field": 35,
    "yard": 10,
    "park": 0,
}


def _hash(text: str) -> int:
    """Детерминированный «случай» от 0 до 99: одинаковое расписание при каждом сбросе."""
    return zlib.crc32(text.encode()) % 100


def seed_venues(ctx: dict[str, Any]) -> list[Entity]:
    ago: Callable[[float], str] = ctx["ago"]
    at: Callable[[int, str], str] = ctx["at"]
    user_template = next(u for u in ctx["users"] if u["role"] == "user")

    def person(patch: Entity) -> Entity:
        return {
            **user_template,
            "avatarUrl": None,
            "age": None,
            "role": "user",
            "city": "Красноярск",
            "about": "",
            "interests": [],
            "levels": {},
            "readiness": None,
            "home": None,
            "radiusKm": 5,
            "email": f"{patch['id'][2:]}@vmeste.demo",
            "phone": "",
            "demo": None,
            "createdAt": ago(90 * DAY),
            **patch,
        }

    ctx["users"].extend(
        [
            person(
                {
                    "id": "u-elena-k",
                    "name": "Елена Кузнецова",
                    "age": 41,
                    "districtId": "d-zhd",
                    "about": "Управляю спорткомплексом «Енисей-Арена»: залы, бассейн и корты.",
                    "phone": "+7 391 290-44-10",
                    "demo": {
                        "title": "Представитель площадки «Енисей-Арена»",
                        "hint": "Отмечает свободные и занятые окна, меняет цены и условия доступности",
                        "order": 7.5,
                    },
                    "createdAt": ago(120 * DAY),
                }
            ),
            person(
                {
                    "id": "u-vladimir",
                    "name": "Владимир Седов",
                    "age": 52,
                    "districtId": "d-oct",
                    "about": "Веду расписание школьных залов и дворовых площадок.",
                    "phone": "+7 391 255-18-30",
                }
            ),
            person(
                {
                    "id": "u-irina-l",
                    "name": "Ирина Лосева",
                    "age": 38,
                    "districtId": "d-kirov",
                    "about": "Администратор бассейна «Волна».",
                    "phone": "+7 913 044-52-19",
                }
            ),
        ]
    )

    org_template = ctx["organizations"][0]

    def org(patch: Entity) -> Entity:
        return {
            **org_template,
            "type": "venue",
            "city": "Красноярск",
            "logoUrl": None,
            "reviews": [],
            "createdWithAssistant": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(150 * DAY),
            "updatedAt": ago(150 * DAY),
            **patch,
        }

    def reviewed(id_: str, days: int) -> list[Entity]:
        return [
            {
                "id": f"rv-{id_}-s",
                "decision": "submitted",
                "reason": "",
                "adminId": None,
                "at": ago(days * DAY),
            },
            {
                "id": f"rv-{id_}-a",
                "decision": "approved",
                "reason": "",
                "adminId": "u-maria",
                "at": ago(days * DAY - 300),
            },
        ]

    ctx["organizations"].extend(
        [
            org(
                {
                    "id": "o-venue-arena",
                    "name": "Спорткомплекс «Енисей-Арена»",
                    "ownerId": "u-elena-k",
                    "status": "approved",
                    "description": "Спорткомплекс с двумя залами, бассейном на 25 метров и крытыми кортами. Вход без ступенек, лифт на второй этаж, туалеты и парковка для маломобильных гостей. Свободные окна отмечаем сами, аренду обсуждаем по телефону.",
                    "sportIds": [
                        "s-volleyball",
                        "s-basketball",
                        "s-badminton",
                        "s-swimming",
                        "s-tennis",
                        "s-tabletennis",
                        "s-yoga",
                    ],
                    "districtId": "d-zhd",
                    "address": "ул. Копылова, 66",
                    "contacts": {
                        "phone": "+7 391 290-44-10",
                        "email": "arenda@enisey-arena-kras.ru",
                        "social": "vk.com/enisey_arena",
                    },
                    "reviews": reviewed("arena", 100),
                    "createdAt": ago(101 * DAY),
                    "updatedAt": ago(100 * DAY),
                }
            ),
            org(
                {
                    "id": "o-venue-city",
                    "name": "Городские спортплощадки",
                    "ownerId": "u-vladimir",
                    "status": "approved",
                    "description": "Ведём расписание школьных спортзалов, дворовых площадок и кортов в разных районах города. Дворовые площадки бесплатны, залы — по почасовой аренде вечером и в выходные.",
                    "sportIds": [
                        "s-volleyball",
                        "s-basketball",
                        "s-football",
                        "s-tennis",
                        "s-workout",
                        "s-boxing",
                    ],
                    "districtId": "d-oct",
                    "address": "ул. Высотная, 21",
                    "contacts": {
                        "phone": "+7 391 255-18-30",
                        "email": "raspisanie@sportploshadki-kras.ru",
                        "social": "",
                    },
                    "reviews": reviewed("city", 200),
                    "createdAt": ago(201 * DAY),
                    "updatedAt": ago(200 * DAY),
                }
            ),
            org(
                {
                    "id": "o-venue-volna",
                    "name": "Бассейн «Волна»",
                    "ownerId": "u-irina-l",
                    "status": "pending",
                    "description": "Бассейн на 6 дорожек и детская ванна. Хотим показывать свободные дорожки для групп и секций, аренда дорожки почасовая.",
                    "sportIds": ["s-swimming"],
                    "districtId": "d-kirov",
                    "address": "ул. Мичурина, 2",
                    "contacts": {"phone": "+7 913 044-52-19", "email": "admin@volna-kras.ru", "social": ""},
                    "reviews": [
                        {
                            "id": "rv-volna-s",
                            "decision": "submitted",
                            "reason": "",
                            "adminId": None,
                            "at": ago(5 * HOUR),
                        }
                    ],
                    "createdAt": ago(6 * HOUR),
                    "updatedAt": ago(5 * HOUR),
                }
            ),
        ]
    )

    arena = {"address": "Спорткомплекс «Енисей-Арена», ул. Копылова, 66", "districtId": "d-zhd"}
    arena_contacts = {
        "phone": "+7 391 290-44-10",
        "email": "arenda@enisey-arena-kras.ru",
        "site": "vk.com/enisey_arena",
    }
    city_contacts = {"phone": "+7 391 255-18-30", "email": "raspisanie@sportploshadki-kras.ru", "site": ""}

    seeds: list[Entity] = [
        {
            "id": "v-arena-big",
            "orgId": "o-venue-arena",
            "name": "«Енисей-Арена», большой зал",
            "kind": "hall",
            "description": "Зал 36 на 18 метров с разметкой для волейбола, баскетбола и мини-футбола. Сетки, мячи и ракетки для бадминтона выдаём бесплатно.",
            "address": arena["address"],
            "landmark": "Главный вход, на ресепшене сказать «в большой зал»",
            "districtId": arena["districtId"],
            "lat": 56.0242,
            "lng": 92.8268,
            "sportIds": ["s-volleyball", "s-basketball", "s-badminton", "s-football"],
            "indoor": True,
            "pricePerHour": 2500,
            "peakPricePerHour": 3500,
            "features": [*ALL_ACCESS, "lockerRoom", "shower", "lighting"],
            "photoUrl": COVERS["volleyball2"],
            "contacts": arena_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 0,
        },
        {
            "id": "v-arena-small",
            "orgId": "o-venue-arena",
            "name": "«Енисей-Арена», малый зал",
            "kind": "hall",
            "description": "Светлый зал на втором этаже: коврики, три теннисных стола, зеркала. Лифт от входа, поручни вдоль стен, есть адаптивные ракетки.",
            "address": arena["address"],
            "landmark": "Второй этаж, лифт справа от ресепшена",
            "districtId": arena["districtId"],
            "lat": 56.0243,
            "lng": 92.8271,
            "sportIds": ["s-yoga", "s-tabletennis", "s-taichi", "s-workout", "s-dance"],
            "indoor": True,
            "pricePerHour": 1200,
            "peakPricePerHour": 1600,
            "features": [*ALL_ACCESS, "lockerRoom", "shower"],
            "photoUrl": COVERS["yoga2"],
            "contacts": arena_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 0,
        },
        {
            "id": "v-arena-pool",
            "orgId": "o-venue-arena",
            "name": "«Енисей-Арена», бассейн 25 метров",
            "kind": "pool",
            "description": "Шесть дорожек, подъёмник для спуска в воду, тёплая вода 28 градусов. Цена — за одну дорожку.",
            "address": arena["address"],
            "landmark": "Вход в бассейн с торца здания",
            "districtId": arena["districtId"],
            "lat": 56.0238,
            "lng": 92.8275,
            "sportIds": ["s-swimming"],
            "indoor": True,
            "pricePerHour": 1800,
            "peakPricePerHour": 2400,
            "features": [*ALL_ACCESS, "lockerRoom", "shower"],
            "photoUrl": COVERS["swimming"],
            "contacts": arena_contacts,
            "hours": {"open": "07:00", "close": "21:00"},
            "updatedDaysAgo": 1,
        },
        {
            "id": "v-arena-courts",
            "orgId": "o-venue-arena",
            "name": "«Енисей-Арена», крытые корты",
            "kind": "court",
            "description": "Два крытых корта с хардовым покрытием. Можно арендовать корт для тенниса или поставить четыре поля для бадминтона.",
            "address": arena["address"],
            "landmark": "Пристройка слева от главного входа",
            "districtId": arena["districtId"],
            "lat": 56.0246,
            "lng": 92.8262,
            "sportIds": ["s-tennis", "s-badminton"],
            "indoor": True,
            "pricePerHour": 1800,
            "peakPricePerHour": 2400,
            "features": ["ramp", "accessibleToilet", "accessibleParking", "lockerRoom", "shower", "lighting"],
            "photoUrl": COVERS["tennis"],
            "contacts": arena_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 2,
        },
        {
            "id": "v-oct-gym",
            "orgId": "o-venue-city",
            "name": "Спортзал школы № 10",
            "kind": "hall",
            "description": "Школьный зал, свободен вечером и в выходные. Есть сетка, кольца и ворота для мини-футбола.",
            "address": "Спортзал школы № 10, ул. Ладо Кецховели, 22",
            "landmark": "Вход со двора, звонок «Спортзал»",
            "districtId": "d-oct",
            "lat": 56.0262,
            "lng": 92.8047,
            "sportIds": ["s-volleyball", "s-basketball", "s-badminton", "s-football"],
            "indoor": True,
            "pricePerHour": 1500,
            "peakPricePerHour": 2000,
            "features": ["lockerRoom", "lighting"],
            "photoUrl": COVERS["volleyball"],
            "contacts": city_contacts,
            "hours": {"open": "16:00", "close": "22:00"},
            "updatedDaysAgo": 3,
        },
        {
            "id": "v-oct-court",
            "orgId": "o-venue-city",
            "name": "Площадка у лицея на ул. Высотной",
            "kind": "yard",
            "description": "Открытая площадка с двумя баскетбольными кольцами и волейбольной сеткой. Бесплатно, вечером горят фонари.",
            "address": "Площадка у лицея на ул. Высотной, 21",
            "landmark": "Корт с синими щитами за школой",
            "districtId": "d-oct",
            "lat": 56.0307,
            "lng": 92.7978,
            "sportIds": ["s-basketball", "s-volleyball"],
            "indoor": False,
            "pricePerHour": 0,
            "peakPricePerHour": None,
            "features": ["lighting"],
            "photoUrl": COVERS["basketball2"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 6,
        },
        {
            "id": "v-vzlet-courts",
            "orgId": "o-venue-city",
            "name": "Открытые корты на Взлётной",
            "kind": "court",
            "description": "Три открытых корта с искусственной травой. Ракетки и мячи — в прокате у входа.",
            "address": "Корты на ул. Взлётной, 26",
            "landmark": "Корт № 2, ближний к парковке",
            "districtId": "d-vzlet",
            "lat": 56.0461,
            "lng": 92.8984,
            "sportIds": ["s-tennis", "s-badminton"],
            "indoor": False,
            "pricePerHour": 800,
            "peakPricePerHour": 1200,
            "features": ["accessibleParking", "lockerRoom", "lighting"],
            "photoUrl": COVERS["tennis"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 4,
        },
        {
            "id": "v-tennis-hall",
            "orgId": "o-venue-city",
            "name": "Крытые корты на Дубровинского",
            "kind": "court",
            "description": "Три крытых корта у набережной. Вход без ступенек, туалет для маломобильных на первом этаже.",
            "address": "Крытые теннисные корты, ул. Дубровинского, 72",
            "landmark": "Вход с набережной, корт № 3",
            "districtId": "d-center",
            "lat": 56.0072,
            "lng": 92.8975,
            "sportIds": ["s-tennis"],
            "indoor": True,
            "pricePerHour": 2200,
            "peakPricePerHour": 2800,
            "features": ["ramp", "accessibleToilet", "lockerRoom", "shower", "lighting"],
            "photoUrl": COVERS["tennis"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 2,
        },
        {
            "id": "v-vzletka-workout",
            "orgId": "o-venue-city",
            "name": "Воркаут-площадка на ул. Весны",
            "kind": "yard",
            "description": "Турники разной высоты, брусья, шведская стенка. Резиновое покрытие, работает круглый год.",
            "address": "Воркаут-площадка, ул. Весны, 7",
            "landmark": "Между домами, рядом с футбольной коробкой",
            "districtId": "d-vzlet",
            "lat": 56.0476,
            "lng": 92.9149,
            "sportIds": ["s-workout", "s-streetworkout"],
            "indoor": False,
            "pricePerHour": 0,
            "peakPricePerHour": None,
            "features": ["lighting"],
            "photoUrl": COVERS["streetworkout"],
            "contacts": city_contacts,
            "hours": {"open": "07:00", "close": "23:00"},
            "updatedDaysAgo": 9,
        },
        {
            "id": "v-boxing",
            "orgId": "o-venue-city",
            "name": "Зал единоборств на Ленина",
            "kind": "hall",
            "description": "Ринг, шесть мешков, татами на 40 квадратных метров. Перчатки можно взять на месте.",
            "address": "Зал бокса, ул. Ленина, 110",
            "landmark": "Подвал, вход с торца",
            "districtId": "d-zhd",
            "lat": 56.0234,
            "lng": 92.8611,
            "sportIds": ["s-boxing", "s-martial", "s-karate"],
            "indoor": True,
            "pricePerHour": 1000,
            "peakPricePerHour": 1400,
            "features": ["lockerRoom", "shower"],
            "photoUrl": COVERS["boxing"],
            "contacts": city_contacts,
            "hours": {"open": "10:00", "close": "22:00"},
            "updatedDaysAgo": 5,
        },
        {
            "id": "v-sverd-yard",
            "orgId": "o-venue-city",
            "name": "Дворовая площадка на Свердловской",
            "kind": "yard",
            "description": "Ровная утоптанная площадка во дворе: городки, мяч, зарядка. Бесплатно.",
            "address": "Двор на ул. Свердловской, 17",
            "landmark": "За гаражами, ровная площадка",
            "districtId": "d-sverd",
            "lat": 55.9952,
            "lng": 92.8874,
            "sportIds": ["s-gorodki", "s-football", "s-workout"],
            "indoor": False,
            "pricePerHour": 0,
            "peakPricePerHour": None,
            "features": [],
            "photoUrl": COVERS["footballYard"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 12,
        },
        {
            "id": "v-akadem-stadium",
            "orgId": "o-venue-city",
            "name": "Стадион в Академгородке",
            "kind": "field",
            "description": "Футбольное поле с беговой дорожкой 400 метров. Дорожка открыта для всех, поле — по аренде.",
            "address": "Стадион, ул. Академгородок, 50",
            "landmark": "Вход с улицы, у табло",
            "districtId": "d-akadem",
            "lat": 56.0062,
            "lng": 92.7658,
            "sportIds": ["s-football", "s-running", "s-nordic"],
            "indoor": False,
            "pricePerHour": 1200,
            "peakPricePerHour": 1600,
            "features": ["ramp", "accessibleToilet", "accessibleParking", "lockerRoom", "lighting"],
            "photoUrl": COVERS["football2"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 1,
        },
        {
            "id": "v-solnech-hall",
            "orgId": "o-venue-city",
            "name": "Спортзал на Солнечном",
            "kind": "hall",
            "description": "Зал при центре досуга: три поля для бадминтона, волейбольная сетка, два теннисных стола.",
            "address": "Центр досуга, пр. 60 лет образования СССР, 46",
            "landmark": "Первый этаж, вход без ступенек",
            "districtId": "d-solnech",
            "lat": 56.0716,
            "lng": 92.9788,
            "sportIds": ["s-badminton", "s-volleyball", "s-tabletennis"],
            "indoor": True,
            "pricePerHour": 1300,
            "peakPricePerHour": 1700,
            "features": ["ramp", "accessibleToilet", "lockerRoom"],
            "photoUrl": COVERS["badminton"],
            "contacts": city_contacts,
            "hours": {"open": "09:00", "close": "21:00"},
            "updatedDaysAgo": 3,
        },
        {
            "id": "v-sov-field",
            "orgId": "o-venue-city",
            "name": "Мини-поле на 78-й Добровольческой бригады",
            "kind": "field",
            "description": "Поле 40 на 20 метров с искусственной травой и бортами. Манишки выдаём.",
            "address": "Мини-поле, ул. 78-й Добровольческой бригады, 15",
            "landmark": "За школой, вход через калитку",
            "districtId": "d-sov",
            "lat": 56.0521,
            "lng": 92.9179,
            "sportIds": ["s-football"],
            "indoor": False,
            "pricePerHour": 1500,
            "peakPricePerHour": 2000,
            "features": ["lockerRoom", "lighting"],
            "photoUrl": COVERS["football"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 2,
        },
        {
            "id": "v-kirov-pool",
            "orgId": "o-venue-city",
            "name": "Бассейн на Кировском",
            "kind": "pool",
            "description": "Бассейн 25 метров на 4 дорожки, подъёмник для спуска в воду. Цена — за дорожку.",
            "address": "Бассейн, ул. Кутузова, 1",
            "landmark": "Вход со двора, касса слева",
            "districtId": "d-kirov",
            "lat": 55.9978,
            "lng": 92.9318,
            "sportIds": ["s-swimming"],
            "indoor": True,
            "pricePerHour": 1500,
            "peakPricePerHour": 2000,
            "features": ["ramp", "elevator", "accessibleToilet", "lockerRoom", "shower"],
            "photoUrl": COVERS["swimming"],
            "contacts": city_contacts,
            "hours": {"open": "07:00", "close": "21:00"},
            "updatedDaysAgo": 7,
        },
        {
            "id": "v-lenin-ice",
            "orgId": "o-venue-city",
            "name": "Крытый каток в Ленинском",
            "kind": "ice",
            "description": "Каток 56 на 26 метров, прокат коньков. Днём массовое катание, вечером аренда для хоккея.",
            "address": "Крытый каток, ул. Московская, 7",
            "landmark": "Вход с парковки",
            "districtId": "d-lenin",
            "lat": 56.0011,
            "lng": 92.9962,
            "sportIds": ["s-skating", "s-hockey"],
            "indoor": True,
            "pricePerHour": 4000,
            "peakPricePerHour": 6000,
            "features": ["ramp", "accessibleToilet", "accessibleParking", "lockerRoom", "shower"],
            "photoUrl": COVERS["skiing"],
            "contacts": city_contacts,
            "hours": {"open": "10:00", "close": "22:00"},
            "updatedDaysAgo": 4,
        },
        {
            "id": "v-center-studio",
            "orgId": "o-venue-city",
            "name": "Студия у Театральной площади",
            "kind": "studio",
            "description": "Небольшая студия на 12 человек: коврики, зеркала, музыка. Лифт до третьего этажа.",
            "address": "ул. Перенсона, 20, третий этаж",
            "landmark": "Вход через арку, лифт сразу справа",
            "districtId": "d-center",
            "lat": 56.0116,
            "lng": 92.8931,
            "sportIds": ["s-yoga", "s-dance", "s-taichi"],
            "indoor": True,
            "pricePerHour": 900,
            "peakPricePerHour": 1200,
            "features": ["elevator", "accessibleToilet", "lockerRoom", "shower"],
            "photoUrl": COVERS["yoga"],
            "contacts": city_contacts,
            "hours": {"open": "08:00", "close": "22:00"},
            "updatedDaysAgo": 1,
        },
        {
            "id": "v-tatyshev",
            "orgId": "o-venue-city",
            "name": "Остров Татышев, спортивная зона",
            "kind": "park",
            "description": "Беговые и велосипедные дорожки, площадки для зарядки. Пологие спуски без ступенек, туалеты для маломобильных у входа.",
            "address": "Остров Татышев, вход с Коммунального моста",
            "landmark": "У синего указателя «Татышев-парк»",
            "districtId": "d-center",
            "lat": 56.0279,
            "lng": 92.9381,
            "sportIds": ["s-running", "s-cycling", "s-workout", "s-nordic"],
            "indoor": False,
            "pricePerHour": 0,
            "peakPricePerHour": None,
            "features": ["ramp", "accessibleToilet", "accessibleParking", "lighting"],
            "photoUrl": COVERS["running2"],
            "contacts": city_contacts,
            "hours": {"open": "07:00", "close": "23:00"},
            "updatedDaysAgo": 8,
        },
    ]

    venues: list[Entity] = []
    for seed in seeds:
        v = {k: x for k, x in seed.items() if k not in {"updatedDaysAgo", "contacts"}}
        venues.append(
            {
                **v,
                "contacts": seed.get("contacts") or city_contacts,
                "timeZone": TZ,
                "slots": [],
                "status": "active",
                "ownerUpdatedAt": ago(seed["updatedDaysAgo"] * DAY + 3 * HOUR),
                "createdAt": ago(90 * DAY),
            }
        )

    # ---------- События на площадках ----------
    def arena_place(venue_id: str) -> Entity:
        v = next(x for x in venues if x["id"] == venue_id)
        return {
            "address": v["address"],
            "landmark": "",
            "districtId": v["districtId"],
            "lat": v["lat"],
            "lng": v["lng"],
        }

    event_template = ctx["events"][0]

    def event(patch: Entity) -> Entity:
        return {
            **event_template,
            "description": "",
            "durationMin": 90,
            "level": "any",
            "beginnersWelcome": False,
            "firstStep": {
                **event_template["firstStep"],
                "intensity": "medium",
                "bring": "",
                "preparation": "",
                "age": "",
                "howToFind": "",
                "amenities": [],
                "firstTimeNote": "",
            },
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
            "createdAt": ago(4 * DAY),
            "updatedAt": ago(4 * DAY),
            "venueId": None,
            "accessExtras": [],
            **patch,
        }

    ctx["events"].extend(
        [
            event(
                {
                    "id": "e-venue-tabletennis",
                    "title": "Настольный теннис: открытая группа для всех, в том числе на колясках",
                    "sportId": "s-tabletennis",
                    "organizer": {"kind": "org", "id": "o-venue-arena"},
                    "createdBy": "u-elena-k",
                    "startsAt": at(3, "12:00"),
                    "durationMin": 90,
                    "place": arena_place("v-arena-small"),
                    "venueId": "v-arena-small",
                    "accessExtras": ["escort", "adaptiveGear"],
                    "description": "Играем за тремя столами, один из них для игры сидя. Тренер покажет удары с нуля. Сопровождающий встретит у входа и проводит до зала, адаптивные ракетки выдадим. Можно прийти с близким человеком.",
                    "level": "any",
                    "beginnersWelcome": True,
                    "capacity": 10,
                    "firstStep": {
                        **event_template["firstStep"],
                        "intensity": "low",
                        "bring": "Удобную одежду и сменную обувь",
                        "preparation": "Не нужна",
                        "age": "С 14 лет",
                        "howToFind": "Второй этаж, лифт справа от ресепшена",
                        "amenities": ["Раздевалка", "Душ", "Туалет"],
                        "firstTimeNote": "Если вы впервые, скажите тренеру, начнём с простого.",
                    },
                    "coverUrl": COVERS["friends"],
                    "privateInfo": "Телефон сопровождающего: +7 391 290-44-12 (Анастасия).",
                    "createdAt": ago(3 * DAY),
                    "updatedAt": ago(3 * DAY),
                }
            ),
            event(
                {
                    "id": "e-venue-volley-arena",
                    "title": "Волейбол в большом зале «Енисей-Арены»",
                    "sportId": "s-volleyball",
                    "organizer": {"kind": "user", "id": "u-maxim"},
                    "createdBy": "u-maxim",
                    "startsAt": at(2, "20:00"),
                    "durationMin": 120,
                    "place": arena_place("v-arena-big"),
                    "venueId": "v-arena-big",
                    "description": "Арендуем зал на два часа и делим аренду на всех. Играем шестёрками, составы перемешиваем.",
                    "level": "amateur",
                    "capacity": 14,
                    "minParticipants": 10,
                    "price": {"kind": "split", "total": 7000, "note": "на аренду зала"},
                    "coverUrl": COVERS["volleyball2"],
                    "createdAt": ago(2 * DAY),
                    "updatedAt": ago(2 * DAY),
                }
            ),
        ]
    )

    # Существующие события сидов в тех же точках привязываем к площадкам
    for e in ctx["events"]:
        if e.get("venueId"):
            continue
        found = next((x for x in venues if (distance_km(x, e["place"]) or 1) < 0.05), None)
        if found is not None:
            e["venueId"] = found["id"]
    # Н1: встречи, где организатор сам встречает новичков и помогает на месте
    for id_ in ["e-nordic-park", "e-workout-akadem", "e-taichi"]:
        e = next((x for x in ctx["events"] if x["id"] == id_), None)
        if e is not None:
            e["accessExtras"] = ["escort"]

    # ---------- Участники ----------
    participation_template = ctx["participations"][0]

    def join(id_: str, event_id: str, user_id: str, minutes_ago: int, needs_escort: bool = False) -> Entity:
        return {
            **participation_template,
            "id": id_,
            "eventId": event_id,
            "userId": user_id,
            "status": "confirmed",
            "prevStatus": None,
            "note": "",
            "rejectReason": "",
            "source": "self",
            "createdAt": ago(minutes_ago),
            "decidedAt": ago(minutes_ago),
            "needsEscort": needs_escort,
        }

    ctx["participations"].extend(
        [
            join("p-venue-1", "e-venue-tabletennis", "u-petr", 30 * HOUR, True),
            join("p-venue-2", "e-venue-tabletennis", "u-lyudmila", 26 * HOUR),
            join("p-venue-3", "e-venue-tabletennis", "u-galina", 20 * HOUR, True),
            join("p-venue-4", "e-venue-volley-arena", "u-pavel", 40 * HOUR),
            join("p-venue-5", "e-venue-volley-arena", "u-egor", 38 * HOUR),
            join("p-venue-6", "e-venue-volley-arena", "u-timur", 30 * HOUR),
            join("p-venue-7", "e-venue-volley-arena", "u-nikita", 12 * HOUR),
        ]
    )
    ctx["notifications"].append(
        {
            "id": "n-venue-escort",
            "userId": "u-elena-k",
            "type": "escort_needed",
            "title": "Участнику нужно сопровождение",
            "text": "Пётр Иванович Морозов идёт на «Настольный теннис: открытая группа для всех, в том числе на колясках» и просит сопровождение. Договоритесь, кто встретит у входа.",
            "link": "/events/e-venue-tabletennis/manage?tab=participants",
            "read": False,
            "createdAt": ago(30 * HOUR),
        }
    )

    # ---------- Занятые окна на две недели ----------
    now = ctx["now"]
    for v in venues:
        busy = BUSY[v["kind"]]
        for day in range(15):
            date = local_date(now, TZ, day)
            for i, starts_at in enumerate(slot_starts(v, date)):
                if _hash(f"{v['id']}:{day}:{i}") < busy:
                    v["slots"].append({"startsAt": starts_at, "free": False, "price": None})
    # Утренняя скидка в большом зале — пример цены, которую владелец поменял сам
    big = next(v for v in venues if v["id"] == "v-arena-big")
    tomorrow = local_date(now, TZ, 1)
    for starts_at in slot_starts(big, tomorrow)[:2]:
        big["slots"] = [s for s in big["slots"] if s["startsAt"] != starts_at]
        big["slots"].append({"startsAt": starts_at, "free": True, "price": 1800})

    return venues
