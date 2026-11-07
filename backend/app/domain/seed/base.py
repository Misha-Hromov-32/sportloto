"""Демо-данные.

Всё вымышленное, места — реальные районы Красноярска.
Даты считаются от момента сброса, поэтому «сегодня», «завтра» и «выходные» всегда актуальны.
Набор позволяет пройти сценарии S1–S6 без подготовки (подсказки по шагам — на странице /demo).
"""

import copy
from datetime import UTC, datetime, time, timedelta
from typing import Any

from app.domain import clock
from app.domain.features import analytics, digest, family, imports, invite_only, reports, stop_list
from app.domain.lib.cities import builtin_cities
from app.domain.seed.catalog import CATEGORIES, COVERS, DISTRICTS, RULES, build_sports
from app.domain.seed.cities import seed_cities
from app.domain.seed.community import seed_community  # В2, С1, С2, С3, Н2
from app.domain.seed.companion_people import seed_companion_people
from app.domain.seed.engagement import seed_engagement  # С8, С14, С15
from app.domain.seed.inventory import seed_inventory  # В3 + С7
from app.domain.seed.mcp import seed_mcp  # В1
from app.domain.seed.participation import seed_participation_demo
from app.domain.seed.payments import seed_payments, with_sale_items  # оплата на сайте
from app.domain.seed.venues import seed_venues  # В4, В5, Н1
from app.domain.types import Entity

# family — Н6, invite_only — С13, analytics — В6, imports — В8, reports — С16

PLACE_TZ = "Asia/Krasnoyarsk"

SCHEMA_VERSION = 13

HOUR = 60
DAY = 24 * HOUR
SAT = 6
SUN = 7

PIXEL_REJECT = (
    "Не понятно, что проходит в центре и кто может прийти: в описании только «Игры, турниры». "
    "Расскажите, какие занятия вы проводите, для какого возраста и уровня, и укажите телефон для связи."
)
VOLAN_RETURN = "Укажите адрес зала и как к вам попасть: без этого участники не найдут место."


def build_seed(now: datetime) -> dict[str, Any]:
    """Демо-данные на момент `now`: все коллекции базы в одном словаре.

    Чистая функция: время берётся только из параметра.
    """
    now = now.astimezone(UTC)

    def ago(minutes: float) -> str:
        return clock.iso(now - timedelta(minutes=minutes))

    # Все демо-встречи проходят в Красноярске: «07:30» — это 07:30 по местному времени,
    # на каком бы устройстве и в каком поясе ни открыли сайт.
    place_today = clock.local(now, PLACE_TZ).date()

    def at(day_offset: int, hhmm: str) -> str:
        """Через `day_offset` дней в `hhmm` по местному времени Красноярска."""
        hour, minute = (int(x) for x in hhmm.split(":"))
        day = place_today + timedelta(days=day_offset)
        return clock.iso(datetime.combine(day, time(hour, minute), tzinfo=clock.zone_info(PLACE_TZ)))

    def next_(iso_dow: int, hhmm: str) -> str:
        """Ближайший будущий день недели (1 — пн … 7 — вс), не раньше завтрашнего."""
        offset = (iso_dow - place_today.isoweekday()) % 7 or 7
        return at(offset, hhmm)

    # Справочники копируются: записи демо-данных не должны делить списки со справочниками модуля.
    districts = copy.deepcopy(DISTRICTS)

    sports: list[Entity] = build_sports(ago(400 * DAY))
    sports.extend(
        [
            {
                "id": "s-gorodki",
                "name": "Городки",
                "synonyms": ["рюхи"],
                "categoryIds": ["c-games", "c-senior"],
                "icon": None,
                "kind": "custom",
                "popular": False,
                "fields": [],
                "mergedInto": None,
                "createdBy": "u-petr",
                "createdAt": ago(20 * DAY),
            },
            {
                "id": "s-phygital-football",
                "name": "Фиджитал-футбол",
                "synonyms": [],
                "categoryIds": ["c-phygital"],
                "icon": None,
                "kind": "custom",
                "popular": False,
                "fields": [],
                "mergedInto": None,
                "createdBy": "u-timur",
                "createdAt": ago(9 * DAY),
            },
            {
                "id": "s-skandinavka",
                "name": "Скандинавка",
                "synonyms": [],
                "categoryIds": [],
                "icon": None,
                "kind": "custom",
                "popular": False,
                "fields": [],
                "mergedInto": None,
                "createdBy": "u-galina",
                "createdAt": ago(2 * DAY),
            },
            {
                "id": "s-padel",
                "name": "Падел",
                "synonyms": [],
                "categoryIds": ["c-games", "c-racket"],
                "icon": None,
                "kind": "custom",
                "popular": False,
                "fields": [],
                "mergedInto": None,
                "createdBy": "u-alina",
                "createdAt": ago(3 * DAY),
            },
        ]
    )

    def district(id_: str) -> Entity:
        return next(d for d in districts if d["id"] == id_)

    # ---------- Люди ----------
    def person(id_: str, name: str, extra: Entity) -> Entity:
        return {
            "id": id_,
            "name": name,
            "avatarUrl": None,
            "age": None,
            "role": "user",
            "city": "Красноярск",
            "districtId": None,
            "about": "",
            "interests": [],
            "levels": {},
            "readiness": None,
            "home": None,
            "radiusKm": 5,
            "email": f"{id_[2:]}@vmeste.demo",
            "phone": "",
            "demo": None,
            "createdAt": ago(120 * DAY),
            **extra,
        }

    def home(district_id: str) -> Entity:
        d = district(district_id)
        return {"lat": d["lat"], "lng": d["lng"]}

    users: list[Entity] = [
        person(
            "u-anna",
            "Анна Соколова",
            {
                "age": 27,
                "districtId": "d-center",
                "home": home("d-center"),
                "radiusKm": 5,
                "about": "Переехала в Красноярск весной. Бегаю по утрам, в школе играла в волейбол, хочу вернуться.",
                "interests": ["s-volleyball", "s-running", "s-yoga"],
                "levels": {"s-volleyball": "beginner", "s-running": "amateur", "s-yoga": "beginner"},
                "readiness": "join",
                "phone": "+7 913 500-11-27",
                "demo": {
                    "title": "Участница, новичок",
                    "hint": "Свободная запись (S3), заявка (S4), вопрос организатору (S5), «Ищу компанию»",
                    "order": 1,
                },
                "createdAt": ago(60 * DAY),
            },
        ),
        person(
            "u-petr",
            "Пётр Иванович Морозов",
            {
                "age": 68,
                "districtId": "d-akadem",
                "home": home("d-akadem"),
                "radiusKm": 3,
                "about": "На пенсии. Гуляю с палками, играю в шахматы и городки, научу любого.",
                "interests": ["s-nordic", "s-workout", "s-chess", "s-gorodki"],
                "levels": {
                    "s-nordic": "amateur",
                    "s-chess": "experienced",
                    "s-gorodki": "experienced",
                    "s-workout": "beginner",
                },
                "readiness": "organize",
                "phone": "+7 391 222-14-68",
                "demo": {
                    "title": "Участник 68 лет, простой режим",
                    "hint": "Крупный текст, простой режим, запись в два касания",
                    "order": 2,
                },
                "createdAt": ago(200 * DAY),
            },
        ),
        person(
            "u-dmitry",
            "Дмитрий Орлов",
            {
                "age": 34,
                "districtId": "d-oct",
                "home": home("d-oct"),
                "about": "Собираю стритбол и волейбол в Октябрьском районе. Играю 15 лет, рад всем, кто держит мяч.",
                "interests": ["s-basketball", "s-volleyball", "s-running"],
                "levels": {
                    "s-basketball": "experienced",
                    "s-volleyball": "experienced",
                    "s-running": "amateur",
                },
                "readiness": "organize",
                "phone": "+7 902 940-33-44",
                "demo": {
                    "title": "Организатор",
                    "hint": "Создаёт встречу (S1), принимает и отклоняет заявки (S4), отвечает в обсуждении (S5)",
                    "order": 3,
                },
                "createdAt": ago(300 * DAY),
            },
        ),
        person(
            "u-olga",
            "Ольга Ветрова",
            {
                "age": 45,
                "districtId": "d-center",
                "home": home("d-center"),
                "about": "Руковожу шахматным клубом «Ладья». Кандидат в мастера спорта.",
                "interests": ["s-chess", "s-checkers"],
                "levels": {"s-chess": "experienced"},
                "phone": "+7 391 205-40-40",
                "demo": {
                    "title": "Представитель клуба «Ладья»",
                    "hint": "Публикует события от имени клуба, страница организации",
                    "order": 4,
                },
                "createdAt": ago(250 * DAY),
            },
        ),
        person(
            "u-sergey",
            "Сергей Лаптев",
            {
                "age": 39,
                "districtId": "d-center",
                "home": home("d-center"),
                "about": "Тренер по бегу, основатель бегового клуба «Енисей».",
                "interests": ["s-running", "s-skiing"],
                "levels": {"s-running": "experienced", "s-skiing": "experienced"},
                "phone": "+7 923 310-55-10",
                "demo": {
                    "title": "Представитель клуба «Енисей»",
                    "hint": "Заявка клуба ждёт проверки (S2): публиковать от имени клуба можно после допуска",
                    "order": 5,
                },
                "createdAt": ago(30 * DAY),
            },
        ),
        person(
            "u-igor",
            "Игорь Ким",
            {
                "age": 29,
                "districtId": "d-sov",
                "home": home("d-sov"),
                "about": "Открыл фиджитал-центр: сначала матч в приставке, потом на настоящем поле.",
                "interests": ["s-phygital", "s-phygital-football", "s-football"],
                "levels": {"s-football": "amateur"},
                "phone": "+7 950 418-77-01",
                "demo": {
                    "title": "Представитель «Пикселя»",
                    "hint": "Видит причину отказа (S2), исправляет заявку и отправляет снова",
                    "order": 7,
                },
                "createdAt": ago(14 * DAY),
            },
        ),
        person(
            "u-maria",
            "Мария Белова",
            {
                "age": 36,
                "role": "admin",
                "districtId": "d-center",
                "about": "Администратор платформы.",
                "demo": {
                    "title": "Администратор",
                    "hint": "Допуск организаций (S2), модерация обсуждений (S5), снятие событий (S6)",
                    "order": 8,
                },
                "createdAt": ago(400 * DAY),
            },
        ),
        person(
            "u-galina",
            "Галина Ивановна Кравцова",
            {
                "age": 71,
                "districtId": "d-akadem",
                "home": home("d-akadem"),
                "interests": ["s-workout", "s-nordic", "s-checkers"],
                "levels": {"s-workout": "amateur", "s-nordic": "beginner"},
                "readiness": "join",
            },
        ),
        person(
            "u-maxim",
            "Максим Егоров",
            {
                "age": 22,
                "districtId": "d-oct",
                "home": home("d-oct"),
                "interests": ["s-basketball", "s-football", "s-badminton"],
                "levels": {"s-basketball": "experienced", "s-football": "amateur", "s-badminton": "amateur"},
                "readiness": "organize",
            },
        ),
        person(
            "u-nikita",
            "Никита Белов",
            {
                "age": 19,
                "districtId": "d-vetluzh",
                "home": home("d-vetluzh"),
                "interests": ["s-basketball", "s-volleyball"],
                "levels": {"s-basketball": "beginner", "s-volleyball": "amateur"},
                "readiness": "join",
            },
        ),
        person(
            "u-ksenia",
            "Ксения Морозова",
            {
                "age": 26,
                "districtId": "d-center",
                "home": home("d-center"),
                "interests": ["s-volleyball", "s-swimming"],
                "levels": {"s-volleyball": "experienced", "s-swimming": "experienced"},
            },
        ),
        person(
            "u-timur",
            "Тимур Галиев",
            {
                "age": 24,
                "districtId": "d-sov",
                "home": home("d-sov"),
                "interests": ["s-phygital-football", "s-football"],
                "levels": {"s-football": "amateur"},
                "readiness": "organize",
            },
        ),
        person(
            "u-oleg",
            "Олег Смирнов",
            {
                "age": 41,
                "districtId": "d-zhd",
                "home": home("d-zhd"),
                "interests": ["s-football", "s-hockey"],
                "levels": {"s-football": "amateur", "s-hockey": "amateur"},
            },
        ),
        person(
            "u-valentina",
            "Валентина Петровна Сорокина",
            {
                "age": 63,
                "districtId": "d-akadem",
                "home": home("d-akadem"),
                "about": "Инструктор по скандинавской ходьбе, веду соседскую зарядку.",
                "interests": ["s-nordic", "s-workout", "s-taichi"],
                "levels": {"s-nordic": "experienced", "s-workout": "experienced"},
            },
        ),
        person(
            "u-elena",
            "Елена Воронцова",
            {
                "age": 38,
                "districtId": "d-center",
                "home": home("d-center"),
                "about": "Преподаю йогу девять лет. Занятия для тех, кто никогда не пробовал.",
                "interests": ["s-yoga"],
                "levels": {"s-yoga": "experienced"},
            },
        ),
        person(
            "u-artem",
            "Артём Шестаков",
            {
                "age": 17,
                "districtId": "d-oct",
                "home": home("d-oct"),
                "interests": ["s-tennis", "s-tabletennis"],
                "levels": {"s-tennis": "amateur", "s-tabletennis": "experienced"},
                "readiness": "join",
            },
        ),
        person(
            "u-vasily",
            "Василий Степанович Гуров",
            {
                "age": 74,
                "districtId": "d-sverd",
                "home": home("d-sverd"),
                "interests": ["s-chess", "s-gorodki", "s-nordic"],
                "levels": {"s-chess": "amateur", "s-gorodki": "amateur"},
            },
        ),
        person(
            "u-irina",
            "Ирина Жукова",
            {
                "age": 45,
                "districtId": "d-kirov",
                "home": home("d-kirov"),
                "interests": ["s-yoga", "s-taichi", "s-swimming"],
                "levels": {"s-yoga": "amateur"},
                "readiness": "join",
            },
        ),
        person(
            "u-ruslan",
            "Руслан Байрамов",
            {
                "age": 31,
                "districtId": "d-zhd",
                "home": home("d-zhd"),
                "about": "Тренер по боксу, КМС. Первую тренировку провожу бесплатно.",
                "interests": ["s-boxing"],
                "levels": {"s-boxing": "experienced"},
            },
        ),
        person(
            "u-alina",
            "Алина Ершова",
            {
                "age": 29,
                "districtId": "d-pokrovka",
                "home": home("d-pokrovka"),
                "interests": ["s-tennis", "s-padel", "s-yoga"],
                "levels": {"s-tennis": "amateur"},
                "readiness": "join",
            },
        ),
        person(
            "u-konstantin",
            "Константин Белых",
            {
                "age": 52,
                "districtId": "d-kirov",
                "home": home("d-kirov"),
                "about": "Хожу на Столбы с 1990-х. Вожу небольшие группы по простым маршрутам.",
                "interests": ["s-hiking", "s-skiing"],
                "levels": {"s-hiking": "experienced", "s-skiing": "experienced"},
                "readiness": "organize",
            },
        ),
        person(
            "u-sofia",
            "Софья Миронова",
            {
                "age": 33,
                "districtId": "d-vzlet",
                "home": home("d-vzlet"),
                "interests": ["s-cycling", "s-running", "s-streetworkout"],
                "levels": {"s-cycling": "amateur", "s-running": "beginner"},
            },
        ),
        person(
            "u-roman",
            "Роман Ткачёв",
            {
                "age": 36,
                "districtId": "d-sov",
                "home": home("d-sov"),
                "about": "Капитан «Дворовых легенд».",
                "interests": ["s-football"],
                "levels": {"s-football": "experienced"},
            },
        ),
        person(
            "u-natalia",
            "Наталья Орехова",
            {
                "age": 58,
                "districtId": "d-akadem",
                "home": home("d-akadem"),
                "about": "Руковожу клубом северной ходьбы «Шаг» в Академгородке.",
                "interests": ["s-nordic"],
                "levels": {"s-nordic": "experienced"},
                "phone": "+7 391 249-12-12",
                "demo": {
                    "title": "Представитель клуба «Шаг»",
                    "hint": "Заявка клуба ждёт проверки (S2): на ней удобно показать отказ с причиной",
                    "order": 6,
                },
            },
        ),
        person("u-egor", "Егор Лукин", {"age": 27, "districtId": "d-center"}),
        person(
            "u-pavel",
            "Павел Зуев",
            {
                "age": 40,
                "districtId": "d-solnech",
                "home": home("d-solnech"),
                "interests": ["s-badminton"],
                "levels": {"s-badminton": "experienced"},
            },
        ),
        person(
            "u-lyudmila",
            "Людмила Фёдоровна Ким",
            {
                "age": 66,
                "districtId": "d-akadem",
                "home": home("d-akadem"),
                "interests": ["s-taichi", "s-workout"],
                "levels": {"s-workout": "beginner"},
            },
        ),
    ]

    # ---------- Организации ----------
    def org(id_: str, name: str, owner_id: str, status: str, extra: Entity) -> Entity:
        return {
            "id": id_,
            "name": name,
            "type": "club",
            "description": "",
            "sportIds": [],
            "city": "Красноярск",
            "districtId": None,
            "address": "",
            "contacts": {"phone": "", "email": "", "social": ""},
            "logoUrl": None,
            "ownerId": owner_id,
            "status": status,
            "reviews": [],
            "createdWithAssistant": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(60 * DAY),
            "updatedAt": ago(60 * DAY),
            **extra,
        }

    def submitted(minutes_ago: int) -> Entity:
        return {
            "id": f"rv-s-{minutes_ago}",
            "decision": "submitted",
            "reason": "",
            "adminId": None,
            "at": ago(minutes_ago),
        }

    def approved(minutes_ago: int) -> Entity:
        return {
            "id": f"rv-a-{minutes_ago}",
            "decision": "approved",
            "reason": "",
            "adminId": "u-maria",
            "at": ago(minutes_ago),
        }

    organizations: list[Entity] = [
        org(
            "o-ladya",
            "Шахматный клуб «Ладья»",
            "u-olga",
            "approved",
            {
                "type": "club",
                "description": "Шахматный клуб в центре Красноярска. По средам блиц, по воскресеньям турниры по рапиду, по субботам занятия для детей 7–10 лет. Доски и часы есть, приходите со своим уровнем.",
                "sportIds": ["s-chess", "s-checkers"],
                "districtId": "d-center",
                "address": "пр. Мира, 30, второй этаж",
                "contacts": {
                    "phone": "+7 391 205-40-40",
                    "email": "info@ladya-kras.ru",
                    "social": "vk.com/ladya_krsk",
                },
                "reviews": [submitted(200 * DAY), approved(199 * DAY)],
                "createdAt": ago(200 * DAY),
            },
        ),
        org(
            "o-morning",
            "Сообщество «Бодрое утро»",
            "u-valentina",
            "approved",
            {
                "type": "initiative",
                "description": "Соседская зарядка во дворах Академгородка. Мягкие упражнения для суставов и дыхания, подходят людям старшего возраста. Занимаемся круглый год, в дождь в холле библиотеки.",
                "sportIds": ["s-workout", "s-nordic", "s-taichi"],
                "districtId": "d-akadem",
                "address": "Академгородок, сквер у дома 17",
                "contacts": {"phone": "+7 391 290-03-03", "email": "", "social": ""},
                "reviews": [submitted(120 * DAY), approved(119 * DAY)],
                "createdAt": ago(120 * DAY),
            },
        ),
        org(
            "o-legends",
            "ФК «Дворовые легенды»",
            "u-roman",
            "approved",
            {
                "type": "club",
                "description": "Любительский футбол с 2019 года. Играем 7×7 на искусственном поле и 5×5 в зале. Мячи и манишки наши, составы делим поровну. По воскресеньям детская группа с родителями.",
                "sportIds": ["s-football"],
                "districtId": "d-sov",
                "address": "ул. Партизана Железняка, 42",
                "contacts": {
                    "phone": "+7 913 040-00-01",
                    "email": "igra@dvorlegends-kras.ru",
                    "social": "vk.com/dvor_legends",
                },
                "reviews": [submitted(160 * DAY), approved(159 * DAY)],
                "createdAt": ago(160 * DAY),
            },
        ),
        org(
            "o-vorontsova",
            "Йога с Еленой Воронцовой",
            "u-elena",
            "approved",
            {
                "type": "coach",
                "description": "Авторские занятия йогой для начинающих. Летом на набережной, зимой в зале на Красной площади. Без сложных поз, с объяснением каждого движения.",
                "sportIds": ["s-yoga"],
                "districtId": "d-center",
                "address": "Набережная Енисея, площадка у Коммунального моста",
                "contacts": {"phone": "+7 923 555-70-07", "email": "zapis@yoga-enisey-kras.ru", "social": ""},
                "reviews": [submitted(90 * DAY), approved(89 * DAY)],
                "createdAt": ago(90 * DAY),
            },
        ),
        org(
            "o-enisey",
            "Беговой клуб «Енисей»",
            "u-sergey",
            "pending",
            {
                "type": "club",
                "description": "Бегаем по субботам на острове Татышев: группы 5 и 10 км, отдельная группа для новичков с тренером. Зимой лыжи в Ветлужанке. Хотим собирать новичков через платформу.",
                "sportIds": ["s-running", "s-skiing"],
                "districtId": "d-center",
                "address": "Остров Татышев, вход с Коммунального моста",
                "contacts": {
                    "phone": "+7 923 310-55-10",
                    "email": "run@enisey-run-kras.ru",
                    "social": "vk.com/enisey_run",
                },
                "reviews": [submitted(2 * HOUR)],
                "createdAt": ago(3 * HOUR),
                "updatedAt": ago(2 * HOUR),
            },
        ),
        org(
            "o-shag",
            "Клуб северной ходьбы «Шаг»",
            "u-natalia",
            "pending",
            {
                "type": "circle",
                "description": "Ходим с палками по Академгородку и вдоль Енисея три раза в неделю. Палки даём на первое занятие. Группа в основном 55+, темп спокойный.",
                "sportIds": ["s-nordic"],
                "districtId": "d-akadem",
                "address": "Академгородок, остановка «Академгородок»",
                "contacts": {"phone": "+7 391 249-12-12", "email": "", "social": ""},
                "reviews": [submitted(6 * HOUR)],
                "createdAt": ago(7 * HOUR),
                "updatedAt": ago(6 * HOUR),
            },
        ),
        org(
            "o-promo",
            "Фитнес Скидки 90%",
            "u-egor",
            "pending",
            {
                "type": "company",
                "description": "АБОНЕМЕНТЫ СО СКИДКОЙ 90%!!! Пишите в телеграм t.me/fit_sale_krsk, переходите на fit-sale.example и fit-sale2.example. Только сегодня!",
                "sportIds": ["s-workout"],
                "districtId": "d-center",
                "contacts": {"phone": "", "email": "sale@fit-skidki-kras.ru", "social": "t.me/fit_sale_krsk"},
                "reviews": [submitted(40)],
                "aiFlag": "suspicious",
                "aiReason": "Похоже на рекламу: продажа абонементов, три ссылки на сторонние сайты, текст капсом. О совместных занятиях ничего нет.",
                "createdAt": ago(45),
                "updatedAt": ago(40),
            },
        ),
        org(
            "o-tropa",
            "Туристический клуб «Тропа»",
            "u-konstantin",
            "draft",
            {
                "type": "club",
                "description": "Водим небольшие группы на Столбы по простым маршрутам.",
                "sportIds": ["s-hiking"],
                "districtId": "d-kirov",
                "createdAt": ago(2 * DAY),
                "updatedAt": ago(2 * DAY),
            },
        ),
        org(
            "o-champion",
            "Секция бокса «Чемпион»",
            "u-ruslan",
            "blocked",
            {
                "type": "circle",
                "description": "Тренировки по боксу для взрослых и подростков. Просили предоплату на карту, после жалоб участников организация заблокирована.",
                "sportIds": ["s-boxing"],
                "districtId": "d-zhd",
                "address": "ул. Ленина, 110",
                "contacts": {"phone": "+7 913 222-00-10", "email": "", "social": ""},
                "reviews": [submitted(80 * DAY), approved(79 * DAY)],
                "createdAt": ago(80 * DAY),
                "updatedAt": ago(10 * DAY),
            },
        ),
        org(
            "o-pixel",
            "Фиджитал-центр «Пиксель»",
            "u-igor",
            "rejected",
            {
                "type": "company",
                "description": "Игры, турниры.",
                "sportIds": ["s-phygital"],
                "districtId": "d-sov",
                "address": "ул. 9 Мая, 77",
                "contacts": {"phone": "", "email": "hello@pixel-kras.ru", "social": ""},
                "reviews": [
                    submitted(2 * DAY),
                    {
                        "id": "rv-r-pixel",
                        "decision": "rejected",
                        "reason": PIXEL_REJECT,
                        "adminId": "u-maria",
                        "at": ago(DAY + 5 * HOUR),
                    },
                ],
                "createdAt": ago(2 * DAY),
                "updatedAt": ago(DAY + 5 * HOUR),
            },
        ),
        org(
            "o-volan",
            "Бадминтонный клуб «Волан»",
            "u-pavel",
            "returned",
            {
                "type": "club",
                "description": "Играем в бадминтон по вторникам и четвергам, ракетки выдаём. Тренер ставит удар с нуля.",
                "sportIds": ["s-badminton"],
                "districtId": "d-solnech",
                "contacts": {"phone": "+7 913 777-21-21", "email": "", "social": ""},
                "reviews": [
                    submitted(4 * DAY),
                    {
                        "id": "rv-ret-volan",
                        "decision": "returned",
                        "reason": VOLAN_RETURN,
                        "adminId": "u-maria",
                        "at": ago(3 * DAY),
                    },
                ],
                "createdAt": ago(4 * DAY),
                "updatedAt": ago(3 * DAY),
            },
        ),
    ]

    # ---------- События ----------
    def place(address: str, district_id: str, lat: float, lng: float, landmark: str = "") -> Entity:
        return {"address": address, "landmark": landmark, "districtId": district_id, "lat": lat, "lng": lng}

    P = {  # noqa: N806
        "tatyshev": place(
            "Остров Татышев, вход с Коммунального моста",
            "d-center",
            56.0279,
            92.9381,
            "У синего указателя «Татышев-парк»",
        ),
        "centralPark": place(
            "Центральный парк, главный вход с ул. Карла Маркса",
            "d-center",
            56.0105,
            92.8755,
            "У фонтана за воротами",
        ),
        "embankment": place(
            "Набережная Енисея у Коммунального моста",
            "d-center",
            56.0086,
            92.8935,
            "Деревянный настил под мостом",
        ),
        "akademSquare": place(
            "Академгородок, сквер у дома 17", "d-akadem", 56.0046, 92.7712, "У летней сцены"
        ),
        "akademLibrary": place(
            "Библиотека в Академгородке, ул. Академгородок, 15",
            "d-akadem",
            56.0039,
            92.7726,
            "Читальный зал на первом этаже",
        ),
        "ladya": place(
            "Клуб «Ладья», пр. Мира, 30", "d-center", 56.0128, 92.8794, "Второй этаж, вход со двора"
        ),
        "octCourt": place(
            "Площадка у лицея на ул. Высотной, 21",
            "d-oct",
            56.0307,
            92.7978,
            "Корт с синими щитами за школой",
        ),
        "octGym": place(
            "Спортзал школы № 10, ул. Ладо Кецховели, 22",
            "d-oct",
            56.0262,
            92.8047,
            "Вход со двора, звонок «Спортзал»",
        ),
        "legendsField": place(
            "Поле «Дворовых легенд», ул. Партизана Железняка, 42",
            "d-sov",
            56.0421,
            92.9214,
            "Искусственное поле за забором с сеткой",
        ),
        "islandRest": place(
            "Остров Отдыха, спортивная площадка",
            "d-sverd",
            55.9995,
            92.8871,
            "Справа от входа с моста",
        ),
        "sfu": place(
            "Спорткомплекс СФУ, пр. Свободный, 79",
            "d-akadem",
            56.0049,
            92.7697,
            "Главный вход, на вахте сказать «на бадминтон»",
        ),
        "lokomotiv": place(
            "Бассейн «Локомотив», ул. Ленина, 156",
            "d-zhd",
            56.0253,
            92.8472,
            "Касса слева от входа",
        ),
        "stolby": place(
            "Нацпарк «Красноярские Столбы», Центральный вход",
            "d-kirov",
            55.9592,
            92.8132,
            "Парковка у визит-центра",
        ),
        "vetluzhanka": place("Лыжная база в Ветлужанке", "d-vetluzh", 56.0312, 92.7268, "У проката"),
        "vzletka": place(
            "Воркаут-площадка, ул. Весны, 7",
            "d-vzlet",
            56.0476,
            92.9149,
            "Между домами, рядом с футбольной коробкой",
        ),
        "pixel": place("Клуб «Арена», ул. 9 Мая, 77", "d-sov", 56.0601, 92.9284, "Цокольный этаж"),
        "tennisCourts": place("Корты на ул. Взлётной, 26", "d-vzlet", 56.0461, 92.8984, "Корт № 2"),
        "boxingGym": place("Зал бокса, ул. Ленина, 110", "d-zhd", 56.0234, 92.8611, "Подвал, вход с торца"),
        "ice": place(
            "Ледовая арена «Кристалл», ул. Партизана Железняка, 4",
            "d-sov",
            56.0367,
            92.9208,
            "Малая арена",
        ),
        "tennisHall": place(
            "Крытые теннисные корты, ул. Дубровинского, 72",
            "d-center",
            56.0072,
            92.8975,
            "Вход с набережной, корт № 3",
        ),
        "yogaStudio": place(
            "Студия «Асана», ул. Красной Армии, 10",
            "d-center",
            56.0136,
            92.8828,
            "Второй этаж, зал № 2",
        ),
        "pokrovka": place(
            "Двор на ул. Свердловской, 17",
            "d-sverd",
            55.9952,
            92.8874,
            "За гаражами, ровная площадка",
        ),
    }

    def first_step(extra: Entity) -> Entity:
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

    def ev(id_: str, f: Entity) -> Entity:
        return {
            "id": id_,
            "description": "",
            "durationMin": 90,
            "level": "any",
            "beginnersWelcome": False,
            "firstStep": first_step({}),
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
            "createdAt": ago(5 * DAY),
            "updatedAt": ago(5 * DAY),
            **f,
        }

    def by_user(id_: str) -> Entity:
        return {"kind": "user", "id": id_}

    def by_org(id_: str) -> Entity:
        return {"kind": "org", "id": id_}

    workout_series = {"id": "series-morning", "rule": "weekly", "until": at(42, "23:59")}

    events: list[Entity] = [
        ev(
            "e-run-tatyshev",
            {
                "title": "Утренняя пробежка по острову Татышев",
                "sportId": "s-running",
                "organizer": by_user("u-dmitry"),
                "createdBy": "u-dmitry",
                "startsAt": at(1, "07:30"),
                "durationMin": 60,
                "place": P["tatyshev"],
                "description": "Бежим 5 км вокруг острова в разговорном темпе. Никого не оставляем позади: если устали, переходим на шаг. После пробежки желающие пьют кофе у входа на остров.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Удобная обувь, вода",
                        "preparation": "Специальная подготовка не нужна",
                        "howToFind": "От остановки «Стадион Енисей» 7 минут пешком по мосту",
                        "amenities": ["Туалет у входа", "Можно оставить сумку организатору"],
                        "firstTimeNote": "Если вы раньше не бегали, чередуйте бег с шагом. Я подожду.",
                    }
                ),
                "capacity": 20,
                "extra": {"distance": "5 км"},
                "privateInfo": "Встречаемся в 07:20 у синего указателя. Телефон Дмитрия: +7 902 940-33-44.",
                "coverUrl": COVERS["running"],
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-volley-hall",
            {
                "title": "Волейбол в зале: смешанные команды",
                "sportId": "s-volleyball",
                "organizer": by_user("u-dmitry"),
                "createdBy": "u-dmitry",
                "startsAt": at(2, "19:30"),
                "durationMin": 120,
                "place": P["octGym"],
                "description": "Играем 6×6, составы перемешиваем каждую партию. Запись по заявке, чтобы команды были ровными: напишите, играли ли вы раньше. Аренду зала делим на всех.",
                "level": "amateur",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "medium",
                        "bring": "Сменная обувь со светлой подошвой, вода",
                        "preparation": "Правила объясним на месте, опыт не обязателен",
                        "amenities": ["Раздевалка", "Душ"],
                        "firstTimeNote": "Новичков ставлю в пару с опытными игроками.",
                    }
                ),
                "price": {"kind": "split", "total": 2400, "note": "на аренду зала"},
                "paymentNote": "Переводом организатору после игры",
                "cancelPolicy": {"kind": "eveBefore", "time": "18:00"},
                "joinMode": "approval",
                "capacity": 12,
                "minParticipants": 8,
                "privateInfo": "Код на калитке 2580. В зал пропускают по списку, назовите фамилию.",
                "coverUrl": COVERS["volleyball"],
                "createdAt": ago(2 * DAY),
            },
        ),
        ev(
            "e-streetball",
            {
                "title": "Стритбол 3×3 на открытой площадке",
                "sportId": "s-basketball",
                "organizer": by_user("u-dmitry"),
                "createdBy": "u-dmitry",
                "startsAt": next_(SAT, "17:00"),
                "durationMin": 120,
                "place": P["octCourt"],
                "description": "Играем до 11 очков, победитель остаётся. Напишите в заявке, как давно играете, чтобы я поделил тройки поровну.",
                "level": "amateur",
                "firstStep": first_step(
                    {
                        "intensity": "high",
                        "bring": "Кроссовки, вода, своя майка",
                        "preparation": "Нужен опыт игры в баскетбол",
                    }
                ),
                "joinMode": "approval",
                "capacity": 12,
                "privateInfo": "Если пойдёт дождь, переносим в зал школы № 10, напишу в обсуждении.",
                "coverUrl": COVERS["basketball"],
                "createdAt": ago(4 * DAY),
            },
        ),
        ev(
            "e-football-77",
            {
                "title": "Футбол 7×7 на искусственном поле",
                "sportId": "s-football",
                "organizer": by_org("o-legends"),
                "createdBy": "u-roman",
                "startsAt": at(1, "20:00"),
                "durationMin": 90,
                "place": P["legendsField"],
                "description": "Собираем две команды по семь человек плюс замены. Мячи и манишки наши. Играем два тайма по 40 минут.",
                "level": "amateur",
                "firstStep": first_step(
                    {
                        "intensity": "high",
                        "bring": "Бутсы или сороконожки, тёмная и светлая футболки",
                        "amenities": ["Раздевалка", "Душ", "Парковка"],
                    }
                ),
                "price": {"kind": "fixed", "amount": 250},
                "paymentNote": "Наличными капитану перед игрой",
                "cancelPolicy": {"kind": "hoursBefore", "hours": 12},
                "capacity": 14,
                "minParticipants": 10,
                "extra": {"format": "7×7"},
                "privateInfo": "Раздевалка № 3. На входе скажите охране «на футбол к легендам».",
                "coverUrl": COVERS["football"],
                "createdAt": ago(6 * DAY),
            },
        ),
        ev(
            "e-chess-blitz",
            {
                "title": "Блиц-вечер и разбор партий",
                "sportId": "s-chess",
                "organizer": by_org("o-ladya"),
                "createdBy": "u-olga",
                "startsAt": at(1, "18:30"),
                "durationMin": 150,
                "place": P["ladya"],
                "description": "Играем блиц 5+3 по швейцарской системе, потом разбираем интересные позиции на демонстрационной доске. Новичкам покажем базовые дебюты за отдельным столом.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Ничего, доски и часы есть",
                        "preparation": "Достаточно знать, как ходят фигуры",
                        "amenities": ["Чай", "Гардероб"],
                        "firstTimeNote": "За отдельным столом тренер объяснит правила с нуля.",
                    }
                ),
                "capacity": 24,
                "extra": {"timeControl": "Блиц 5+3"},
                "privateInfo": "Код домофона 30К1234. Если опаздываете, звоните Ольге: +7 391 205-40-40.",
                "coverUrl": COVERS["chess"],
                "createdAt": ago(7 * DAY),
            },
        ),
        ev(
            "e-chess-rapid",
            {
                "title": "Воскресный турнир по рапиду",
                "sportId": "s-chess",
                "organizer": by_org("o-ladya"),
                "createdBy": "u-olga",
                "startsAt": next_(SUN, "12:00"),
                "durationMin": 240,
                "place": P["ladya"],
                "description": "Семь туров по швейцарской системе, контроль 15+10. Заявки принимаем, чтобы составить пары заранее. Призы: шахматные книги.",
                "level": "amateur",
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Ручку для записи партий",
                        "preparation": "Нужно знать правила и уметь записывать ходы",
                    }
                ),
                "price": {"kind": "fixed", "amount": 300},
                "paymentNote": "Взнос на месте, идёт на призы",
                "joinMode": "approval",
                "capacity": 16,
                "minParticipants": 8,
                "extra": {"timeControl": "Рапид 15+10"},
                "coverUrl": COVERS["chess2"],
                "createdAt": ago(5 * DAY),
            },
        ),
        ev(
            "e-chess-kids",
            {
                "title": "Шахматы для детей 7–10 лет",
                "sportId": "s-chess",
                "organizer": by_org("o-ladya"),
                "createdBy": "u-olga",
                "startsAt": next_(SAT, "11:00"),
                "durationMin": 60,
                "place": P["ladya"],
                "description": "Занятие в игровой форме: учим ходы фигур, играем простые задачи. Родители могут остаться в зале.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "age": "Дети 7–10 лет вместе со взрослым",
                        "bring": "Ничего, всё дадим",
                    }
                ),
                "joinMode": "approval",
                "capacity": 10,
                "coverUrl": None,
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-workout-akadem",
            {
                "title": "Зарядка во дворе для всех возрастов",
                "sportId": "s-workout",
                "organizer": by_org("o-morning"),
                "createdBy": "u-valentina",
                "startsAt": at(1, "09:00"),
                "durationMin": 40,
                "place": P["akademSquare"],
                "description": "Мягкая разминка суставов, растяжка и дыхательные упражнения. Каждое упражнение можно делать сидя на скамейке.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Коврик по желанию",
                        "age": "Любой возраст, много участников 60+",
                        "howToFind": "Сквер между домами 15 и 17, у летней сцены",
                        "amenities": ["Скамейки", "В дождь занимаемся в холле библиотеки"],
                        "firstTimeNote": "Покажем каждое упражнение и облегчённый вариант.",
                    }
                ),
                "capacity": 30,
                "series": workout_series,
                "coverUrl": COVERS["workout"],
                "createdAt": ago(30 * DAY),
            },
        ),
        ev(
            "e-taichi",
            {
                "title": "Тайцзи в Центральном парке",
                "sportId": "s-taichi",
                "organizer": by_org("o-morning"),
                "createdBy": "u-valentina",
                "startsAt": at(2, "10:00"),
                "durationMin": 60,
                "place": P["centralPark"],
                "description": "Медленные движения и дыхание. Помогает при болях в спине и для равновесия.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Удобная одежда по погоде",
                        "age": "Подходит людям 60+",
                    }
                ),
                "capacity": 20,
                "coverUrl": None,
                "createdAt": ago(4 * DAY),
            },
        ),
        ev(
            "e-nordic-park",
            {
                "title": "Скандинавская ходьба в Центральном парке",
                "sportId": "s-nordic",
                "organizer": by_user("u-valentina"),
                "createdBy": "u-valentina",
                "startsAt": next_(SAT, "11:00"),
                "durationMin": 90,
                "place": P["centralPark"],
                "description": "Покажу технику и пройдём 4 км по аллеям, не спеша, с остановками.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Палки, если есть. Три пары дам напрокат",
                        "age": "Любой возраст",
                        "firstTimeNote": "Технику показываю с нуля, первые 15 минут учимся.",
                    }
                ),
                "capacity": 15,
                "changes": [
                    {
                        "id": "ch-nordic-1",
                        "at": ago(5 * HOUR),
                        "items": [{"field": "startsAt", "label": "Время", "from": "10:00", "to": "11:00"}],
                        "acknowledgedBy": ["u-galina"],
                    },
                ],
                "coverUrl": COVERS["nordic"],
                "createdAt": ago(8 * DAY),
                "updatedAt": ago(5 * HOUR),
            },
        ),
        ev(
            "e-yoga-embankment",
            {
                "title": "Йога для начинающих в студии",
                "sportId": "s-yoga",
                "organizer": by_org("o-vorontsova"),
                "createdBy": "u-elena",
                "startsAt": at(3, "19:00"),
                "durationMin": 60,
                "place": P["yogaStudio"],
                "description": "Спокойная практика в тёплом зале без сложных поз. Летом занимаемся на набережной, с октября — в студии. Подойдёт тем, кто пробует впервые.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Удобная одежда, носки",
                        "amenities": ["Коврики напрокат, 3 штуки", "Раздевалка"],
                    }
                ),
                "price": {"kind": "fixed", "amount": 300},
                "paymentNote": "Оплата на месте наличными или переводом",
                "cancelPolicy": {"kind": "eveBefore", "time": "18:00"},
                "capacity": 25,
                "coverUrl": COVERS["yoga"],
                "createdAt": ago(6 * DAY),
            },
        ),
        ev(
            "e-badminton",
            {
                "title": "Бадминтон пара на пару",
                "sportId": "s-badminton",
                "organizer": by_user("u-maxim"),
                "createdBy": "u-maxim",
                "startsAt": at(4, "19:00"),
                "durationMin": 90,
                "place": P["sfu"],
                "description": "Корт один, поэтому мест четыре. Играем пары, меняемся каждые 15 минут.",
                "level": "amateur",
                "firstStep": first_step(
                    {"intensity": "medium", "bring": "Сменная обувь, ракетка, если есть"}
                ),
                "price": {"kind": "split", "total": 1200, "note": "на аренду корта"},
                "cancelPolicy": {"kind": "hoursBefore", "hours": 24},
                "capacity": 4,
                "coverUrl": COVERS["badminton"],
                "createdAt": ago(2 * DAY),
            },
        ),
        ev(
            "e-gorodki",
            {
                "title": "Городки во дворе: научу с нуля",
                "sportId": "s-gorodki",
                "organizer": by_user("u-petr"),
                "createdBy": "u-petr",
                "startsAt": next_(SAT, "12:00"),
                "durationMin": 120,
                "place": P["pokrovka"],
                "description": "Старая русская игра: выбиваем битой фигуры из «города». Биты на всех есть. Покажу, как держать биту и с какой фигуры начать.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {"intensity": "low", "bring": "Перчатки", "age": "Подростки и взрослые"}
                ),
                "capacity": 10,
                "coverUrl": None,
                "createdAt": ago(9 * DAY),
            },
        ),
        ev(
            "e-phygital",
            {
                "title": "Фиджитал-футбол: тайм в приставке, тайм на поле",
                "sportId": "s-phygital-football",
                "organizer": by_user("u-timur"),
                "createdBy": "u-timur",
                "startsAt": at(6, "15:00"),
                "durationMin": 150,
                "place": P["pixel"],
                "description": "Сначала играем тайм в футбольном симуляторе, потом тайм на настоящем поле. Счёт общий.",
                "level": "any",
                "firstStep": first_step({"intensity": "medium", "bring": "Спортивная форма, сменная обувь"}),
                "price": {"kind": "split", "total": 3200, "note": "на аренду клуба"},
                "cancelPolicy": {"kind": "hoursBefore", "hours": 24},
                "capacity": 16,
                "minParticipants": 8,
                "coverUrl": None,
                "createdAt": ago(4 * DAY),
            },
        ),
        ev(
            "e-tennis",
            {
                "title": "Теннис: ищем пару на корт",
                "sportId": "s-tennis",
                "organizer": by_user("u-alina"),
                "createdBy": "u-alina",
                "startsAt": at(2, "18:00"),
                "durationMin": 90,
                "place": P["tennisCourts"],
                "description": "Корт забронирован, играем 2×2. Уровень любительский: держим розыгрыш, подаём через раз.",
                "level": "amateur",
                "firstStep": first_step({"intensity": "medium", "bring": "Ракетка, кроссовки для корта"}),
                "price": {"kind": "split", "total": 1600, "note": "на аренду корта"},
                "joinMode": "approval",
                "capacity": 4,
                "extra": {"surface": "Хард"},
                "coverUrl": COVERS["tennis"],
                "createdAt": ago(DAY),
            },
        ),
        ev(
            "e-tennis-beginners",
            {
                "title": "Теннис для начинающих: первая тренировка",
                "sportId": "s-tennis",
                "organizer": by_user("u-alina"),
                "createdBy": "u-alina",
                "startsAt": next_(SAT, "10:00"),
                "durationMin": 90,
                "place": P["tennisHall"],
                "description": "Крытый корт, тепло в любую погоду. Учимся держать ракетку, набивать мяч и перекидывать через сетку. Играть уметь не нужно.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "low",
                        "bring": "Кроссовки со светлой подошвой, вода. Ракетки дам",
                        "preparation": "Подготовка не нужна",
                        "amenities": ["Раздевалка", "Ракетки напрокат"],
                        "firstTimeNote": "Первые полчаса только держим ракетку и набиваем мяч, ничего сложного.",
                    }
                ),
                "price": {"kind": "fixed", "amount": 300},
                "paymentNote": "На месте, на аренду корта",
                "cancelPolicy": {"kind": "hoursBefore", "hours": 12},
                "capacity": 6,
                "extra": {"surface": "Хард"},
                "coverUrl": COVERS["tennis"],
                "createdAt": ago(DAY),
            },
        ),
        ev(
            "e-swim",
            {
                "title": "Плавание для взрослых: учимся с нуля",
                "sportId": "s-swimming",
                "organizer": by_user("u-ksenia"),
                "createdBy": "u-ksenia",
                "startsAt": at(5, "08:00"),
                "durationMin": 60,
                "place": P["lokomotiv"],
                "description": "Небольшая группа на одной дорожке. Учимся держаться на воде и дышать, потом кроль на груди.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "medium",
                        "bring": "Шапочка, очки, полотенце, справка не нужна",
                        "amenities": ["Душ", "Фен"],
                    }
                ),
                "price": {"kind": "fixed", "amount": 350},
                "paymentNote": "Билет на дорожку в кассе бассейна",
                "joinMode": "approval",
                "capacity": 6,
                "coverUrl": COVERS["swimming"],
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-football-kids",
            {
                "title": "Футбол для детей 8–12 лет с родителями",
                "sportId": "s-football",
                "organizer": by_org("o-legends"),
                "createdBy": "u-roman",
                "startsAt": next_(SUN, "11:00"),
                "durationMin": 60,
                "place": P["legendsField"],
                "description": "Игры с мячом, пасы, удары. Родители могут играть вместе с детьми.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {
                        "intensity": "medium",
                        "age": "Дети 8–12 лет со взрослым",
                        "bring": "Кроссовки, вода",
                    }
                ),
                "capacity": 20,
                "coverUrl": COVERS["footballKids"],
                "createdAt": ago(5 * DAY),
            },
        ),
        ev(
            "e-hiking",
            {
                "title": "Прогулка на Столбы по лёгкому маршруту",
                "sportId": "s-hiking",
                "organizer": by_user("u-konstantin"),
                "createdBy": "u-konstantin",
                "startsAt": next_(SAT, "09:00"),
                "durationMin": 300,
                "place": P["stolby"],
                "description": "Идём к Первому столбу по асфальтовой тропе, около 14 км туда и обратно. Состоится, если наберётся пять человек.",
                "level": "any",
                "firstStep": first_step(
                    {
                        "intensity": "medium",
                        "bring": "Удобная обувь, термос, перекус, дождевик",
                        "preparation": "Нужно уверенно пройти 14 км",
                    }
                ),
                "capacity": 12,
                "minParticipants": 5,
                "extra": {"distance": "14 км"},
                "coverUrl": None,
                "createdAt": ago(2 * DAY),
            },
        ),
        ev(
            "e-cycling",
            {
                "title": "Велопрогулка по Татышеву: закрываем сезон",
                "sportId": "s-cycling",
                "organizer": by_user("u-sofia"),
                "createdBy": "u-sofia",
                "startsAt": at(6, "13:00"),
                "durationMin": 90,
                "place": P["tatyshev"],
                "description": "Последняя прогулка сезона: 12 км по асфальтовым дорожкам острова, днём, пока тепло. Едем со скоростью самого неспешного. Если пойдёт снег, перенесём и напишем в обсуждении.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {"intensity": "low", "bring": "Велосипед, шлем, перчатки, тёплая куртка"}
                ),
                "capacity": 20,
                "extra": {"distance": "12 км"},
                "coverUrl": COVERS["cycling"],
                "createdAt": ago(DAY),
            },
        ),
        ev(
            "e-tabletennis-live",
            {
                "title": "Настольный теннис в Академгородке",
                "sportId": "s-tabletennis",
                "organizer": by_user("u-artem"),
                "createdBy": "u-artem",
                # Уже идёт: началась на границе четверти часа, 30–45 минут назад
                "startsAt": clock.iso(
                    now.replace(minute=now.minute // 15 * 15, second=0, microsecond=0) - timedelta(minutes=30)
                ),
                "durationMin": 120,
                "place": P["akademLibrary"],
                "description": "Два стола в холле библиотеки. Играем на вылет до 11.",
                "level": "any",
                "firstStep": first_step({"intensity": "low", "bring": "Ракетка, если есть"}),
                "capacity": 8,
                "coverUrl": None,
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-boxing",
            {
                "title": "Бокс для начинающих: первая тренировка",
                "sportId": "s-boxing",
                "organizer": by_user("u-ruslan"),
                "createdBy": "u-ruslan",
                "startsAt": at(3, "18:00"),
                "durationMin": 90,
                "place": P["boxingGym"],
                "description": "Стойка, передвижение, прямые удары. Спаррингов нет. Перчатки и бинты дам.",
                "level": "beginner",
                "beginnersWelcome": True,
                "firstStep": first_step(
                    {"intensity": "high", "bring": "Спортивная форма, полотенце", "age": "С 16 лет"}
                ),
                "joinMode": "approval",
                "capacity": 10,
                "coverUrl": COVERS["boxing"],
                "createdAt": ago(2 * DAY),
            },
        ),
        ev(
            "e-streetworkout",
            {
                "title": "Воркаут на Взлётке: турники для всех",
                "sportId": "s-streetworkout",
                "organizer": by_user("u-sofia"),
                "createdBy": "u-sofia",
                "startsAt": at(1, "19:00"),
                "durationMin": 60,
                "place": P["vzletka"],
                "description": "Разминка, подтягивания с резинкой, отжимания. Каждому подберём посильный вариант.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step({"intensity": "medium", "bring": "Перчатки для турника"}),
                "coverUrl": COVERS["streetworkout"],
                "createdAt": ago(DAY),
            },
        ),
        ev(
            "e-hockey",
            {
                "title": "Хоккей на крытом льду: ночная игра",
                "sportId": "s-hockey",
                "organizer": by_user("u-oleg"),
                "createdBy": "u-oleg",
                "startsAt": at(5, "22:00"),
                "durationMin": 90,
                "place": P["ice"],
                "description": "Любительская игра, без силовых приёмов. Нужна полная экипировка.",
                "level": "amateur",
                "firstStep": first_step(
                    {
                        "intensity": "high",
                        "bring": "Полная хоккейная экипировка",
                        "preparation": "Уверенно стоять на коньках",
                    }
                ),
                "price": {"kind": "split", "total": 9000, "note": "на аренду льда"},
                "cancelPolicy": {"kind": "hoursBefore", "hours": 48},
                "joinMode": "approval",
                "capacity": 20,
                "minParticipants": 14,
                "extra": {"rental": "Нет, нужен свой"},
                "coverUrl": None,
                "createdAt": ago(4 * DAY),
            },
        ),
        ev(
            "e-checkers",
            {
                "title": "Шашки и шахматы в библиотеке",
                "sportId": "s-checkers",
                "organizer": by_user("u-galina"),
                "createdBy": "u-galina",
                "startsAt": at(1, "15:00"),
                "durationMin": 120,
                "place": P["akademLibrary"],
                "description": "Тихие партии за чаем. Доски есть, правила объясним.",
                "level": "any",
                "beginnersWelcome": True,
                "firstStep": first_step({"intensity": "low", "bring": "Ничего", "age": "Любой"}),
                "capacity": 12,
                "coverUrl": None,
                "createdAt": ago(2 * DAY),
            },
        ),
        ev(
            "e-basket-collect",
            {
                "title": "Баскетбол 5×5 в зале: ищем ещё людей",
                "sportId": "s-basketball",
                "organizer": by_user("u-nikita"),
                "createdBy": "u-nikita",
                "startsAt": at(4, "20:00"),
                "durationMin": 90,
                "place": P["sfu"],
                "description": "Зал оплачен, нужна полная игра 5×5. Если не наберёмся до 10, перенесу.",
                "level": "amateur",
                "firstStep": first_step({"intensity": "high", "bring": "Кроссовки для зала"}),
                "price": {"kind": "split", "total": 2000, "note": "на аренду зала"},
                "capacity": 12,
                "minParticipants": 10,
                "coverUrl": COVERS["basketball2"],
                "createdAt": ago(DAY),
            },
        ),
        ev(
            "e-skiing",
            {
                "title": "Лыжероллеры в Ветлужанке: готовимся к сезону",
                "sportId": "s-skiing",
                "organizer": by_user("u-konstantin"),
                "createdBy": "u-konstantin",
                "startsAt": next_(SUN, "10:00"),
                "durationMin": 90,
                "place": P["vetluzhanka"],
                "description": "Отрабатываем коньковый ход на роллерах, чтобы к снегу быть в форме.",
                "level": "amateur",
                "firstStep": first_step({"intensity": "high", "bring": "Роллеры, палки, шлем"}),
                "capacity": 10,
                "extra": {"rental": "Есть на месте"},
                "coverUrl": COVERS["skiing"],
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-flagged",
            {
                "title": "БЕСПЛАТНЫЕ ТРЕНИРОВКИ!!! Пиши в телеграм",
                "sportId": "s-workout",
                "organizer": by_user("u-egor"),
                "createdBy": "u-egor",
                "startsAt": at(2, "12:00"),
                "durationMin": 60,
                "place": place("Центр города", "d-center", 56.0109, 92.8648),
                "description": "Пиши в телеграм t.me/fit_sale_krsk, абонементы со скидкой 90%! Переходи на fit-sale.example!",
                "aiFlag": "spam",
                "aiReason": "Похоже на рекламу: ссылки на сторонний канал и сайт, продажа абонементов, заголовок капсом.",
                "coverUrl": None,
                "createdAt": ago(50),
            },
        ),
        # Прошедшие, отменённые, снятые и удалённые — для истории, баннеров и архива.
        ev(
            "e-football-cancelled",
            {
                "title": "Футбол 5×5 в зале после работы",
                "sportId": "s-football",
                "organizer": by_user("u-maxim"),
                "createdBy": "u-maxim",
                "startsAt": at(2, "20:30"),
                "place": P["octGym"],
                "description": "Зал на час, играем 5×5.",
                "level": "amateur",
                "capacity": 12,
                "status": "cancelled",
                "cancelReason": "Школа закрыла зал на ремонт до конца месяца. Найду другой зал и создам новое событие.",
                "price": {"kind": "fixed", "amount": 200},
                "coverUrl": COVERS["footballYard"],
                "createdAt": ago(6 * DAY),
                "updatedAt": ago(10 * HOUR),
            },
        ),
        ev(
            "e-removed",
            {
                "title": "Продам абонемент в фитнес-клуб",
                "sportId": "s-workout",
                "organizer": by_user("u-oleg"),
                "createdBy": "u-oleg",
                "startsAt": at(3, "12:00"),
                "place": place("Онлайн", "d-zhd", 56.0255, 92.841),
                "description": "Абонемент на полгода, недорого. Пишите в обсуждении.",
                "status": "removed",
                "moderation": {
                    "action": "removed",
                    "ruleId": "rule-1",
                    "comment": "Это объявление о продаже, а не совместное занятие.",
                    "by": "u-maria",
                    "at": ago(5 * HOUR),
                },
                "createdAt": ago(DAY),
                "updatedAt": ago(5 * HOUR),
            },
        ),
        ev(
            "e-deleted",
            {
                "title": "бегаем",
                "sportId": "s-running",
                "organizer": by_user("u-egor"),
                "createdBy": "u-egor",
                "startsAt": at(4, "10:00"),
                "place": place("Не указано", "d-center", 56.0153, 92.8932),
                "status": "deleted",
                "moderation": {
                    "action": "deleted",
                    "ruleId": "rule-2",
                    "comment": "Пустая карточка: нет описания, места и условий.",
                    "by": "u-maria",
                    "at": ago(2 * DAY),
                },
                "createdAt": ago(3 * DAY),
            },
        ),
        ev(
            "e-past-chess",
            {
                "title": "Шахматный турнир выходного дня",
                "sportId": "s-chess",
                "organizer": by_org("o-ladya"),
                "createdBy": "u-olga",
                "startsAt": at(-6, "12:00"),
                "durationMin": 180,
                "place": P["ladya"],
                "description": "Турнир по рапиду, семь туров.",
                "capacity": 16,
                "extra": {"timeControl": "Рапид 15+10"},
                "coverUrl": COVERS["chess2"],
                "createdAt": ago(20 * DAY),
            },
        ),
        ev(
            "e-past-run",
            {
                "title": "Пробежка по острову Татышев",
                "sportId": "s-running",
                "organizer": by_user("u-dmitry"),
                "createdBy": "u-dmitry",
                "startsAt": at(-7, "07:30"),
                "durationMin": 60,
                "place": P["tatyshev"],
                "description": "5 км в спокойном темпе.",
                "beginnersWelcome": True,
                "capacity": 20,
                "coverUrl": COVERS["running2"],
                "createdAt": ago(14 * DAY),
            },
        ),
        ev(
            "e-past-workout",
            {
                "title": "Зарядка во дворе для всех возрастов",
                "sportId": "s-workout",
                "organizer": by_org("o-morning"),
                "createdBy": "u-valentina",
                "startsAt": at(-6, "09:00"),
                "durationMin": 40,
                "place": P["akademSquare"],
                "beginnersWelcome": True,
                "series": workout_series,
                "coverUrl": COVERS["workout2"],
                "createdAt": ago(30 * DAY),
            },
        ),
        ev(
            "e-past-yoga",
            {
                "title": "Йога для начинающих в студии",
                "sportId": "s-yoga",
                "organizer": by_org("o-vorontsova"),
                "createdBy": "u-elena",
                "startsAt": at(-4, "19:00"),
                "durationMin": 60,
                "place": P["yogaStudio"],
                "beginnersWelcome": True,
                "price": {"kind": "fixed", "amount": 300},
                "coverUrl": COVERS["yoga2"],
                "createdAt": ago(12 * DAY),
            },
        ),
        ev(
            "e-past-volley",
            {
                "title": "Волейбол в зале: смешанные команды",
                "sportId": "s-volleyball",
                "organizer": by_user("u-dmitry"),
                "createdBy": "u-dmitry",
                "startsAt": at(-5, "19:30"),
                "durationMin": 120,
                "place": P["octGym"],
                "joinMode": "approval",
                "capacity": 12,
                "coverUrl": COVERS["volleyball2"],
                "createdAt": ago(12 * DAY),
            },
        ),
    ]

    # ---------- Записи ----------
    p_seq = 0
    participations: list[Entity] = []

    def join(
        event_id: str, user_ids: list[str], status: str = "confirmed", extra: Entity | None = None
    ) -> None:
        nonlocal p_seq
        extra = extra or {}
        for user_id in user_ids:
            p_seq += 1
            participations.append(
                {
                    "id": f"p-{p_seq}",
                    "eventId": event_id,
                    "userId": user_id,
                    "status": status,
                    "prevStatus": None,
                    "note": "",
                    "rejectReason": "",
                    "source": "self",
                    "createdAt": ago(3 * DAY - p_seq * 20),
                    "decidedAt": None if status in {"pending", "waitlist"} else ago(2 * DAY - p_seq * 10),
                    **extra,
                }
            )

    join("e-run-tatyshev", ["u-maxim", "u-sofia", "u-ksenia", "u-nikita", "u-alina", "u-galina"])
    join("e-volley-hall", ["u-ksenia", "u-nikita", "u-maxim", "u-alina", "u-timur", "u-artem", "u-sofia"])
    join("e-volley-hall", ["u-irina"], "pending", {"note": "Играла в студенчестве, давно не тренировалась."})
    join("e-streetball", ["u-artem", "u-timur", "u-oleg", "u-roman"])
    join("e-streetball", ["u-maxim"], "pending", {"note": "Играю пять лет, могу разыгрывающим."})
    join("e-streetball", ["u-nikita"], "pending", {"note": "Играл только на физкультуре, хочу попробовать."})
    join(
        "e-football-77",
        [
            "u-roman",
            "u-oleg",
            "u-maxim",
            "u-timur",
            "u-artem",
            "u-nikita",
            "u-igor",
            "u-dmitry",
            "u-konstantin",
            "u-ruslan",
            "u-pavel",
            "u-egor",
            "u-sergey",
            "u-vasily",
        ],
    )
    join("e-football-77", ["u-sofia", "u-anna"], "waitlist")
    join("e-chess-blitz", ["u-petr", "u-vasily", "u-galina", "u-artem"])
    join("e-chess-rapid", ["u-vasily", "u-artem", "u-konstantin", "u-oleg", "u-pavel"])
    join("e-chess-rapid", ["u-anna"], "pending", {"note": "Играю для себя, хочу попробовать турнир."})
    join("e-chess-rapid", ["u-petr"], "pending", {"note": "Играю сорок лет, первый разряд."})
    join("e-chess-kids", ["u-irina"], "pending", {"note": "Записываю сына Мишу, 8 лет."})
    join(
        "e-workout-akadem",
        [
            "u-petr",
            "u-galina",
            "u-lyudmila",
            "u-natalia",
            "u-vasily",
            "u-irina",
            "u-sofia",
            "u-elena",
            "u-ksenia",
            "u-konstantin",
            "u-alina",
            "u-pavel",
        ],
    )
    join("e-taichi", ["u-lyudmila", "u-galina", "u-irina"])
    join("e-nordic-park", ["u-petr", "u-galina", "u-natalia", "u-vasily", "u-lyudmila"])
    join("e-yoga-embankment", ["u-anna", "u-irina", "u-alina", "u-ksenia", "u-sofia"])
    join("e-badminton", ["u-pavel", "u-nikita", "u-alina", "u-artem"])
    join("e-badminton", ["u-anna"], "waitlist")
    join("e-gorodki", ["u-vasily", "u-galina", "u-konstantin"])
    join("e-phygital", ["u-igor", "u-artem", "u-nikita", "u-maxim", "u-roman"])
    join("e-tennis", ["u-artem"])
    join("e-tennis-beginners", ["u-irina", "u-egor"])
    join("e-swim", ["u-irina", "u-galina"])
    join("e-swim", ["u-sofia"], "pending", {"note": "Боюсь воды, но очень хочу научиться."})
    join("e-football-kids", ["u-roman", "u-oleg", "u-timur"])
    join("e-hiking", ["u-sofia", "u-alina", "u-pavel"])
    join("e-cycling", ["u-ksenia", "u-nikita"])
    join("e-tabletennis-live", ["u-nikita", "u-vasily", "u-maxim"])
    join("e-boxing", ["u-oleg"])
    join("e-boxing", ["u-timur", "u-egor"], "pending", {"note": "Хочу попробовать, раньше не занимался."})
    join("e-streetworkout", ["u-nikita", "u-roman"])
    join("e-hockey", ["u-oleg", "u-roman", "u-timur", "u-maxim", "u-konstantin", "u-igor"])
    join("e-checkers", ["u-vasily", "u-lyudmila"])
    join("e-basket-collect", ["u-maxim", "u-artem", "u-timur", "u-roman", "u-oleg", "u-dmitry", "u-pavel"])
    join("e-skiing", ["u-sergey", "u-sofia"])
    join("e-flagged", ["u-oleg"])
    join("e-football-cancelled", ["u-anna", "u-oleg", "u-timur"])
    join("e-removed", ["u-egor"], "event_removed", {"prevStatus": "confirmed"})
    join("e-past-chess", ["u-petr", "u-anna", "u-vasily", "u-artem"])
    join("e-past-run", ["u-anna", "u-maxim", "u-sofia"])
    join("e-past-workout", ["u-petr", "u-galina", "u-lyudmila"])
    join("e-past-yoga", ["u-anna", "u-irina"])
    join(
        "e-past-volley",
        [
            "u-ksenia",
            "u-nikita",
            "u-maxim",
            "u-alina",
            "u-timur",
            "u-artem",
            "u-sofia",
            "u-roman",
        ],
    )
    join(
        "e-past-volley",
        ["u-egor"],
        "rejected",
        {
            "rejectReason": "Состав на эту игру уже собран, приходите в следующий раз.",
        },
    )

    egor_rejected_id = f"p-{p_seq}"

    # ---------- Обсуждения ----------
    m_seq = 0
    messages: list[Entity] = []

    def say(
        event_id: str, author_id: str | None, text: str, minutes_ago: int, extra: Entity | None = None
    ) -> str:
        nonlocal m_seq
        extra = extra or {}
        m_seq += 1
        id_ = f"m-{m_seq}"
        messages.append(
            {
                "id": id_,
                "eventId": event_id,
                "authorId": author_id,
                "asOrgId": None,
                "text": text,
                "replyTo": None,
                "reactions": {},
                "status": "visible",
                "hiddenReason": "",
                "system": False,
                "aiFlag": "none",
                "aiReason": "",
                "createdAt": ago(minutes_ago),
                **extra,
            }
        )
        return id_

    q1 = say(
        "e-run-tatyshev",
        "u-galina",
        "А если я раньше не бегала, справлюсь? Мне 71 год.",
        20 * HOUR,
    )
    say(
        "e-run-tatyshev",
        "u-dmitry",
        "Справитесь. Бежим медленно, можно переходить на шаг. Я бегу последним, так что никто не отстанет.",
        19 * HOUR,
        {
            "replyTo": q1,
            "reactions": {"thanks": ["u-galina", "u-sofia"]},
        },
    )
    q2 = say("e-volley-hall", "u-nikita", "Сколько примерно выйдет с человека за зал?", 30 * HOUR)
    say(
        "e-volley-hall",
        "u-dmitry",
        "Зал 2 400 ₽ на всех. Если придут 12 человек, выйдет по 200. Точная сумма в карточке, она пересчитывается.",
        29 * HOUR,
        {
            "replyTo": q2,
            "reactions": {"thanks": ["u-nikita"]},
        },
    )
    q3 = say("e-streetball", "u-timur", "Сетки на кольцах есть?", 26 * HOUR)
    say("e-streetball", "u-dmitry", "Есть, повесил новые на прошлой неделе.", 25 * HOUR, {"replyTo": q3})
    say(
        "e-streetball",
        "u-artem",
        "Могу взять свой мяч, он поновее.",
        8 * HOUR,
        {
            "reactions": {"agree": ["u-timur", "u-roman"]},
        },
    )
    q4 = say("e-football-77", "u-oleg", "Мяч нужен свой?", 40 * HOUR)
    say(
        "e-football-77",
        "u-roman",
        "Нет, мячи и манишки привезём сами.",
        39 * HOUR,
        {
            "replyTo": q4,
            "asOrgId": "o-legends",
        },
    )
    q5 = say(
        "e-chess-blitz",
        "u-galina",
        "Можно прийти, если я давно не играла и забыла дебюты?",
        22 * HOUR,
    )
    say(
        "e-chess-blitz",
        "u-olga",
        "Приходите, конечно. За отдельным столом тренер напомнит основы, а блиц можно и просто посмотреть.",
        21 * HOUR,
        {
            "replyTo": q5,
            "asOrgId": "o-ladya",
            "reactions": {"thanks": ["u-galina", "u-petr"]},
        },
    )
    say(
        "e-chess-blitz",
        "u-egor",
        "Курсы по шахматам со скидкой 90%!!! Пишите t.me/fit_sale_krsk, t.me/fit_sale_krsk, t.me/fit_sale_krsk",
        35,
        {
            "aiFlag": "spam",
            "aiReason": "Похоже на спам: три одинаковые ссылки на сторонний канал и реклама скидки.",
        },
    )
    say("e-chess-rapid", "u-vasily", "А разбор партий после турнира будет?", 10 * HOUR)
    q6 = say("e-workout-akadem", "u-lyudmila", "А если пойдёт дождь?", 48 * HOUR)
    say(
        "e-workout-akadem",
        "u-valentina",
        "Если дождь, уходим в холл библиотеки, она рядом. Напишем здесь с утра.",
        47 * HOUR,
        {
            "replyTo": q6,
            "asOrgId": "o-morning",
        },
    )
    say(
        "e-nordic-park",
        None,
        "Организатор изменил время: было 10:00, стало 11:00.",
        5 * HOUR,
        {
            "system": True,
        },
    )
    say("e-yoga-embankment", "u-irina", "Коврики дадите, если своего нет?", 12 * HOUR)
    say(
        "e-gorodki",
        "u-vasily",
        "В детстве играл, посмотрим, вспомню ли «письмо»!",
        30 * HOUR,
        {
            "reactions": {"agree": ["u-petr"]},
        },
    )
    say(
        "e-hockey",
        "u-maxim",
        "Да вы там все безрукие, играть с вами позорище",
        3 * HOUR,
        {
            "aiFlag": "toxic",
            "aiReason": "Грубость: оскорбление участников («безрукие», «позорище»).",
        },
    )
    say(
        "e-football-77",
        "u-timur",
        "Продаю бутсы 42 размера, пишите в личку!!!",
        60 * HOUR,
        {
            "id": "m-hidden",
            "status": "hidden",
            "hiddenReason": "Реклама, не относится к событию (правило 4).",
        },
    )
    say(
        "e-football-cancelled",
        None,
        "Организатор отменил событие: школа закрыла зал на ремонт до конца месяца.",
        10 * HOUR,
        {"system": True},
    )
    say(
        "e-removed",
        None,
        "Событие снято с публикации модератором: правило 1. Это объявление о продаже, а не совместное занятие.",
        5 * HOUR,
        {
            "system": True,
        },
    )

    # ---------- «Ищу компанию» ----------
    def companion(id_: str, c: Entity) -> Entity:
        return {
            "id": id_,
            "districtId": None,
            "point": None,
            "when": "",
            "level": "beginner",
            "readiness": "join",
            "metoo": [],
            "status": "open",
            "eventId": None,
            "createdWithAssistant": False,
            "createdAt": ago(DAY),
            **c,
        }

    companions: list[Entity] = [
        companion(
            "c-anna-volley",
            {
                "authorId": "u-anna",
                "sportId": "s-volleyball",
                "text": "Играла в волейбол в школе, хочу вернуться. Ищу компанию на будние вечера, лучше в центре.",
                "districtId": "d-center",
                "point": home("d-center"),
                "when": "Будни после 19:00",
                "level": "beginner",
                "readiness": "join",
                "metoo": [
                    {"userId": "u-nikita", "at": ago(10 * HOUR)},
                    {"userId": "u-ksenia", "at": ago(6 * HOUR)},
                ],
                "createdAt": ago(2 * DAY),
            },
        ),
        companion(
            "c-petr-nordic",
            {
                "authorId": "u-petr",
                "sportId": "s-nordic",
                "text": "Хожу с палками по утрам в Академгородке, вдвоём-втроём веселее. Могу показать технику.",
                "districtId": "d-akadem",
                "point": home("d-akadem"),
                "when": "Утро, 8:00–10:00, кроме воскресенья",
                "level": "amateur",
                "readiness": "organize",
                "metoo": [
                    {"userId": "u-galina", "at": ago(20 * HOUR)},
                    {"userId": "u-lyudmila", "at": ago(15 * HOUR)},
                    {"userId": "u-natalia", "at": ago(4 * HOUR)},
                ],
                "createdAt": ago(3 * DAY),
            },
        ),
        companion(
            "c-alina-tennis",
            {
                "authorId": "u-alina",
                "sportId": "s-tennis",
                "text": "Ищу партнёра по теннису примерно моего уровня: держу розыгрыш, подача пока нестабильная.",
                "districtId": "d-pokrovka",
                "point": home("d-pokrovka"),
                "when": "Вторник и четверг вечером",
                "level": "amateur",
                "readiness": "join",
                "metoo": [{"userId": "u-artem", "at": ago(5 * HOUR)}],
                "createdAt": ago(DAY),
            },
        ),
        companion(
            "c-nikita-basket",
            {
                "authorId": "u-nikita",
                "sportId": "s-basketball",
                "text": "Хочу научиться играть в баскетбол нормально, ищу тех, кто тоже начинает. Ветлужанка или Академгородок.",
                "districtId": "d-vetluzh",
                "point": home("d-vetluzh"),
                "when": "Выходные днём",
                "level": "beginner",
                "readiness": "join",
                "metoo": [],
                "createdAt": ago(9 * HOUR),
            },
        ),
        companion(
            "c-konstantin-ski",
            {
                "authorId": "u-konstantin",
                "sportId": "s-skiing",
                "text": "Соберу группу на беговые лыжи в Ветлужанке, как ляжет снег. Покажу классический ход.",
                "districtId": "d-vetluzh",
                "point": home("d-vetluzh"),
                "when": "Суббота утром",
                "level": "beginner",
                "readiness": "organize",
                "metoo": [
                    {"userId": "u-sofia", "at": ago(30 * HOUR)},
                    {"userId": "u-sergey", "at": ago(28 * HOUR)},
                ],
                "createdAt": ago(4 * DAY),
            },
        ),
        companion(
            "c-irina-yoga",
            {
                "authorId": "u-irina",
                "sportId": "s-yoga",
                "text": "Ищу компанию на йогу у воды, одной идти неловко.",
                "districtId": "d-kirov",
                "point": home("d-kirov"),
                "when": "Вечер в будни",
                "level": "beginner",
                "readiness": "join",
                "metoo": [{"userId": "u-anna", "at": ago(8 * DAY)}],
                "status": "gathered",
                "eventId": "e-past-yoga",
                "createdAt": ago(10 * DAY),
            },
        ),
        companion(
            "c-galina-skandinavka",
            {
                "authorId": "u-galina",
                "sportId": "s-skandinavka",
                "text": "Ищу, с кем ходить на скандинавку по утрам в Академгородке. Палки есть, темп спокойный.",
                "districtId": "d-akadem",
                "point": home("d-akadem"),
                "when": "Будни утром",
                "level": "beginner",
                "readiness": "join",
                "metoo": [{"userId": "u-lyudmila", "at": ago(20 * HOUR)}],
                "createdAt": ago(2 * DAY),
            },
        ),
        companion(
            "c-timur-phygital",
            {
                "authorId": "u-timur",
                "sportId": "s-phygital-football",
                "text": "Собираю людей на фиджитал-футбол: тайм в приставке и тайм на поле. Нужны ещё человек шесть.",
                "districtId": "d-sov",
                "point": home("d-sov"),
                "when": "Выходные",
                "level": "amateur",
                "readiness": "organize",
                "metoo": [{"userId": "u-igor", "at": ago(3 * DAY)}],
                "status": "closed",
                "createdAt": ago(7 * DAY),
            },
        ),
    ]

    invites: list[Entity] = [
        {
            "id": "inv-1",
            "eventId": "e-volley-hall",
            "fromUserId": "u-dmitry",
            "toUserId": "u-nikita",
            "companionId": "c-nikita-basket",
            "createdAt": ago(7 * HOUR),
        },
    ]

    # ---------- Уведомления ----------
    n_seq = 0
    notifications: list[Entity] = []

    def notify(
        user_id: str, type_: str, title: str, text: str, link: str, minutes_ago: int, read: bool = False
    ) -> None:
        nonlocal n_seq
        n_seq += 1
        notifications.append(
            {
                "id": f"n-{n_seq}",
                "userId": user_id,
                "type": type_,
                "title": title,
                "text": text,
                "link": link,
                "read": read,
                "createdAt": ago(minutes_ago),
            }
        )

    notify(
        "u-dmitry",
        "application",
        "Новая заявка",
        "Максим Егоров хочет на «Стритбол 3×3 на открытой площадке».",
        "/events/e-streetball/manage",
        9 * HOUR,
    )
    notify(
        "u-dmitry",
        "application",
        "Новая заявка",
        "Никита Белов хочет на «Стритбол 3×3 на открытой площадке».",
        "/events/e-streetball/manage",
        8 * HOUR,
    )
    notify(
        "u-dmitry",
        "application",
        "Новая заявка",
        "Ирина Жукова хочет на «Волейбол в зале: смешанные команды».",
        "/events/e-volley-hall/manage",
        6 * HOUR,
    )
    notify(
        "u-dmitry",
        "question",
        "Вопрос в обсуждении",
        "Галина Ивановна спрашивает про «Утреннюю пробежку по острову Татышев».",
        "/events/e-run-tatyshev",
        20 * HOUR,
        True,
    )
    notify(
        "u-olga",
        "application",
        "Новая заявка",
        "Анна Соколова хочет на «Воскресный турнир по рапиду».",
        "/events/e-chess-rapid/manage",
        5 * HOUR,
    )
    notify(
        "u-olga",
        "application",
        "Новая заявка",
        "Пётр Иванович Морозов хочет на «Воскресный турнир по рапиду».",
        "/events/e-chess-rapid/manage",
        4 * HOUR,
    )
    notify(
        "u-anna",
        "cancelled",
        "Событие отменено",
        "«Футбол 5×5 в зале после работы» отменён: школа закрыла зал на ремонт. Если вы платили, деньги вернут полностью.",
        "/events/e-football-cancelled",
        10 * HOUR,
    )
    notify(
        "u-anna",
        "metoo",
        "Откликнулись на ваше объявление",
        "Ксения Морозова тоже хочет играть в волейбол.",
        "/companions",
        6 * HOUR,
    )
    notify(
        "u-anna",
        "waitlist_joined",
        "Вы в листе ожидания",
        "На «Бадминтон пара на пару» вы первая в очереди. Если место освободится, придержим его за вами и напишем.",
        "/events/e-badminton",
        2 * DAY,
        True,
    )
    notify(
        "u-petr",
        "changed",
        "Изменилось время",
        "«Скандинавская ходьба в Центральном парке»: было 10:00, стало 11:00.",
        "/events/e-nordic-park",
        5 * HOUR,
    )
    notify(
        "u-petr",
        "metoo",
        "Откликнулись на ваше объявление",
        "Наталья Орехова тоже хочет гулять с палками по утрам.",
        "/companions",
        4 * HOUR,
    )
    notify(
        "u-sergey",
        "org_submitted",
        "Заявка отправлена",
        "Беговой клуб «Енисей» на проверке. Обычно это занимает до одного дня.",
        "/org/o-enisey",
        2 * HOUR,
        True,
    )
    notify(
        "u-igor",
        "org_rejected",
        "Заявка отклонена",
        f"Фиджитал-центр «Пиксель»: {PIXEL_REJECT}",
        "/org/o-pixel",
        DAY + 5 * HOUR,
    )
    notify(
        "u-pavel",
        "org_returned",
        "Заявку вернули на доработку",
        f"Бадминтонный клуб «Волан»: {VOLAN_RETURN}",
        "/org/o-volan",
        3 * DAY,
    )
    notify(
        "u-oleg",
        "removed",
        "Событие снято с публикации",
        "«Продам абонемент в фитнес-клуб» снято модератором. Правило 1: событие — это совместное занятие.",
        "/events/e-removed",
        5 * HOUR,
    )
    notify(
        "u-egor",
        "removed",
        "Событие снято с публикации",
        "«Продам абонемент в фитнес-клуб» снято модератором.",
        "/events/e-removed",
        5 * HOUR,
    )
    notify(
        "u-maria",
        "org_submitted",
        "Новая заявка организации",
        "Беговой клуб «Енисей» ждёт решения.",
        "/admin/organizations/o-enisey",
        2 * HOUR,
    )
    notify(
        "u-maria",
        "org_submitted",
        "Новая заявка организации",
        "Клуб северной ходьбы «Шаг» ждёт решения.",
        "/admin/organizations/o-shag",
        6 * HOUR,
    )
    notify(
        "u-maria",
        "org_submitted",
        "Новая заявка организации",
        "«Фитнес Скидки 90%» ждёт решения. Помощник пометил заявку как подозрительную.",
        "/admin/organizations/o-promo",
        40,
    )
    notify(
        "u-nikita",
        "invite",
        "Вас позвали",
        "Дмитрий Орлов зовёт вас на «Волейбол в зале: смешанные команды».",
        "/events/e-volley-hall",
        7 * HOUR,
    )

    # ---------- Журнал ----------
    audit: list[Entity] = [
        {
            "id": "a-1",
            "actorId": "u-maria",
            "action": "org.approve",
            "targetType": "org",
            "targetId": "o-vorontsova",
            "targetTitle": "Йога с Еленой Воронцовой",
            "ruleId": None,
            "reason": "",
            "at": ago(89 * DAY),
        },
        {
            "id": "a-2",
            "actorId": "u-maria",
            "action": "org.reject",
            "targetType": "org",
            "targetId": "o-pixel",
            "targetTitle": "Фиджитал-центр «Пиксель»",
            "ruleId": "rule-7",
            "reason": PIXEL_REJECT,
            "at": ago(DAY + 5 * HOUR),
        },
        {
            "id": "a-3",
            "actorId": "u-maria",
            "action": "org.return",
            "targetType": "org",
            "targetId": "o-volan",
            "targetTitle": "Бадминтонный клуб «Волан»",
            "ruleId": None,
            "reason": VOLAN_RETURN,
            "at": ago(3 * DAY),
        },
        {
            "id": "a-4",
            "actorId": "u-maria",
            "action": "event.remove",
            "targetType": "event",
            "targetId": "e-removed",
            "targetTitle": "Продам абонемент в фитнес-клуб",
            "ruleId": "rule-1",
            "reason": "Это объявление о продаже, а не совместное занятие.",
            "at": ago(5 * HOUR),
        },
        {
            "id": "a-5",
            "actorId": "u-maria",
            "action": "event.delete",
            "targetType": "event",
            "targetId": "e-deleted",
            "targetTitle": "бегаем",
            "ruleId": "rule-2",
            "reason": "Пустая карточка: нет описания, места и условий.",
            "at": ago(2 * DAY),
        },
        {
            "id": "a-6",
            "actorId": "u-maria",
            "action": "message.hide",
            "targetType": "message",
            "targetId": "m-hidden",
            "targetTitle": "Сообщение в «Футбол 7×7 на искусственном поле»",
            "ruleId": "rule-4",
            "reason": "Реклама, не относится к событию.",
            "at": ago(50 * HOUR),
        },
        {
            "id": "a-7",
            "actorId": "u-maxim",
            "action": "event.cancel",
            "targetType": "event",
            "targetId": "e-football-cancelled",
            "targetTitle": "Футбол 5×5 в зале после работы",
            "ruleId": None,
            "reason": "Школа закрыла зал на ремонт до конца месяца.",
            "at": ago(10 * HOUR),
        },
        {
            "id": "a-8",
            "actorId": "u-valentina",
            "action": "event.reschedule",
            "targetType": "event",
            "targetId": "e-nordic-park",
            "targetTitle": "Скандинавская ходьба в Центральном парке",
            "ruleId": None,
            "reason": "время: было 10:00, стало 11:00",
            "at": ago(5 * HOUR),
        },
        {
            "id": "a-9",
            "actorId": "u-dmitry",
            "action": "participation.reject",
            "targetType": "participation",
            "targetId": egor_rejected_id,
            "targetTitle": "Волейбол в зале: смешанные команды",
            "ruleId": None,
            "reason": "Состав на эту игру уже собран.",
            "at": ago(6 * DAY),
        },
    ]

    audit.sort(key=lambda a: a["at"], reverse=True)

    # В7, С4, С6, С9, С10: состав, придержанное место, план Б, напоминание, серия
    seed_participation_demo(
        {"users": users, "events": events, "participations": participations, "notifications": notifications},
        now,
    )

    # С13, Н6: компания с закрытой встречей, семейные и детское занятия
    invite_only.seed_invite_only(
        {"users": users, "organizations": organizations, "events": events, "participations": participations},
        at,
        ago,
    )
    family.seed_family({"events": events, "participations": participations}, at, ago)

    # В4, В5, Н1: площадки, их окна и встречи на них
    venues = seed_venues(
        {
            "now": now,
            "ago": ago,
            "at": at,
            "users": users,
            "organizations": organizations,
            "events": events,
            "participations": participations,
            "notifications": notifications,
        }
    )

    # Оплата на сайте: две встречи Дмитрия с оплатой, проданный насос; мяч на продажу — на полке
    pay = seed_payments(
        {
            "ev": ev,
            "at": at,
            "ago": ago,
            "place": P["octGym"],
            "covers": {"basketball": COVERS["basketball"], "volleyball": COVERS["volleyball"]},
            "events": events,
            "participations": participations,
            "notifications": notifications,
        }
    )

    # Порядок вызовов важен: сиды ниже дописывают в общие списки (события, записи, уведомления).
    data: dict[str, Any] = {
        "version": SCHEMA_VERSION,
        "seededAt": clock.iso(now),
        # Новые номера — base36 от счётчика. Часть демо-записей нумерована десятично (до dl-592), а 592 в base36 —
        # это 6806: счётчик стартует выше, иначе новая запись получила бы номер существующей.
        "seq": 10000,
        "settings": {
            "assistantFailure": False,
            "assistantFailureMode": "error",
            "datesShiftedAt": None,
            "datesShiftedDays": 0,
        },
        "users": users,
        "cities": builtin_cities(),
        "districts": districts,
        "categories": copy.deepcopy(CATEGORIES),
        "sports": sports,
        "rules": copy.deepcopy(RULES),
        "organizations": organizations,
        "events": events,
        "participations": participations,
        "messages": messages,
        "companions": companions,
        "invites": invites,
    }
    # В3 + С7: добавляет партнёра и уведомления, поэтому стоит до сортировки уведомлений
    data["inventory"] = with_sale_items(
        seed_inventory(
            {
                "users": users,
                "organizations": organizations,
                "events": events,
                "notifications": notifications,
                "now": now,
            }
        ),
        ago,
    )
    # В2, С1, С2, С3, Н2: добавляет события, записи, объявление и уведомление — тоже до сортировки
    data.update(
        seed_community(
            {
                "at": at,
                "next": next_,
                "ago": ago,
                "events": events,
                "participations": participations,
                "companions": companions,
                "notifications": notifications,
            }
        )
    )
    # С8, С14, С15: избранное, подписки, управляющие, ответы участников; добавляет сообщение и уведомление
    data.update(seed_engagement({"ago": ago, "messages": messages, "notifications": notifications}))
    # D-16: стоп-листы; меняет записи и добавляет уведомления — до сортировки уведомлений
    data["stopList"] = stop_list.seed_stop_list(
        {"ago": ago, "now": now, "participations": participations, "notifications": notifications}
    )
    data.update(pay)  # оплата на сайте
    notifications.sort(key=lambda n: n["createdAt"], reverse=True)
    data["notifications"] = notifications
    data["audit"] = audit
    data["aiRequests"] = []
    data["idempotency"] = []
    data["venues"] = venues
    # В8, С16, В6: очередь постов сообществ, жалобы, история спроса за 30 дней
    data.update(imports.seed_imports({"sports": sports, "districts": districts, "now": now}))
    data["reports"] = reports.seed_reports({"events": events, "messages": messages, "ago": ago})
    data["demandLog"] = analytics.seed_demand_log({"now": now, "districts": districts})
    # Москва и Брянск: люди, клубы, площадки, встречи, обсуждения, «Ищу компанию», полка и спрос;
    # Красноярску — обложки клубов и встреч без фото, фото вещей на полке
    seed_cities(
        {
            "now": now,
            "ago": ago,
            "users": users,
            "organizations": organizations,
            "events": events,
            "participations": participations,
            "messages": messages,
            "companions": companions,
            "venues": venues,
            "shelf": data["inventory"]["shelf"],
            "districts": districts,
            "demand_log": data["demandLog"],
        }
    )
    # В1: токен ассистента у Анны и журнал его вызовов
    data.update(seed_mcp(ago))
    # Подборка дня: у демо-аккаунтов включена на 8:00, на сайте
    data["digestPrefs"] = digest.seed_digest_prefs(users, now)
    data["digests"] = []
    seed_companion_people(data, now)
    return data
