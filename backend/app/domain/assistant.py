"""Помощник на правилах для русского языка.

Разбор фразы поиска в фильтры, черновики карточек (событие, «Ищу компанию», заявка организации),
объяснение «почему вам подходит» для ленты и предмодерация текстов. Работает без модели: это
запасной путь, когда модель недоступна. Качество разбора меряет tests/test_assistant_eval.py
на наборе фраз tests/assistant_eval_cases.json.
"""

import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from app.domain import clock
from app.domain.lib import dates
from app.domain.lib.dates import day_part, is_weekend
from app.domain.lib.geo import distance_km, format_distance
from app.domain.lib.labels import EVENT_LEVEL, SKILL_LEVEL
from app.domain.lib.money import format_rub
from app.domain.lib.numbers import parse_number
from app.domain.lib.text import capitalize, edit_distance, normalize
from app.domain.text import STOP_WORDS, stem_ru, word_matches
from app.domain.text import words as split_words
from app.domain.types import Entity

# Контекст разбора: {"sports": [...], "districts": [...], "now": текущий момент}.
AssistantContext = dict[str, Any]
# Контекст подбора (собирает Domain._match_context): user, districts, now; по прошлым подтверждённым
# посещениям — pastDayParts, pastWeekends, pastSportIds, pastOrganizers {"kind:id": имя}, companions
# {userId: имя}; favoriteSportIds; facts(event) → {"going": [userId], "spotsLeft", "toThreshold"}.
MatchContext = dict[str, Any]

_WS_SPLIT = re.compile(r"\s+")

# ---------- Числа словами («в семь вечера», «человек восемь») ----------

UNITS: dict[str, int] = {
    "ноль": 0, "один": 1, "одна": 1, "одного": 1, "два": 2, "две": 2, "двух": 2, "три": 3, "трех": 3, "четыре": 4,
    "четырех": 4, "пять": 5, "пяти": 5, "шесть": 6, "шести": 6, "семь": 7, "семи": 7, "восемь": 8, "восьми": 8,
    "девять": 9, "девяти": 9, "десять": 10, "десяти": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13,
    "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18,
    "девятнадцать": 19,
}  # fmt: skip
TENS: dict[str, int] = {
    "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70,
    "восемьдесят": 80, "девяносто": 90,
}  # fmt: skip
HUNDREDS: dict[str, int] = {
    "сто": 100, "двести": 200, "триста": 300, "четыреста": 400, "пятьсот": 500, "шестьсот": 600, "семьсот": 700,
    "восемьсот": 800, "девятьсот": 900, "тысяча": 1000, "тысячу": 1000,
}  # fmt: skip

_SPLIT_KEEP_WS = re.compile(r"(\s+)")
_NOT_CYRILLIC = re.compile(r"[^а-я]")


def _numberize(raw: str) -> str:
    """Текст в нижнем регистре, где числа словами заменены цифрами. Знаки препинания сохраняются."""
    parts = _SPLIT_KEEP_WS.split(raw.lower().replace("ё", "е"))
    out: list[str] = []
    acc: int | None = None
    pending_space = ""

    def flush() -> None:
        nonlocal acc
        if acc is not None:
            out.append(str(acc))
            acc = None

    for part in parts:
        if part.isspace():
            pending_space = part
            continue
        word = _NOT_CYRILLIC.sub("", part)
        tail = part[part.find(word) + len(word) :]
        value = HUNDREDS.get(word)
        if value is None:
            value = TENS.get(word)
        if value is None:
            value = UNITS.get(word)
        if word and value is not None and part.startswith(word):
            if acc is None:
                if out:
                    out.append(pending_space)
                acc = value
            elif acc % 10 == 0 and value < acc:
                acc += value
            else:
                flush()
                out.append(pending_space)
                acc = value
            if tail:
                flush()
                out.append(tail)
        else:
            flush()
            if out:
                out.append(pending_space)
            out.append(part)
        pending_space = ""
    flush()
    return "".join(out)


# ---------- Направления ----------

# Токен: {"w": слово, "group": номер составного слова через дефис («фиджитал-футбол») или None},
# чтобы не делить его на два направления.
_TOKEN_SPLIT = re.compile(r"[^a-zа-я0-9-]+")


def _tokenize(raw: str) -> list[Entity]:
    out: list[Entity] = []
    group = 0
    for chunk in _TOKEN_SPLIT.split(raw.lower().replace("ё", "е")):
        parts = [p for p in chunk.split("-") if p]
        if not parts:
            continue
        g: int | None = None
        if len(parts) > 1:
            group += 1
            g = group
        out.extend({"w": w, "group": g} for w in parts)
    return out


def _token_matches(word: str, term: str) -> bool:
    return word == term if len(term) <= 3 else word_matches(word, term)


def _scan_sports(raw: str, sports: list[Entity]) -> Entity:
    """Направления во фразе: {"sports", "hits": [{sport, start, end, term}], "compounds"}.

    `compounds` — составные слова, которые не нашлись целиком, — кандидаты в новое направление.
    """
    tokens = _tokenize(raw)
    all_hits: list[Entity] = []
    for sport in sports:
        if sport.get("mergedInto"):
            continue
        for term in [sport["name"], *sport["synonyms"]]:
            parts = [p for p in normalize(term).split(" ") if p]
            if not parts:
                continue
            i = 0
            while i + len(parts) <= len(tokens):
                if all(_token_matches(tokens[i + k]["w"], p) for k, p in enumerate(parts)):
                    all_hits.append({"sport": sport, "start": i, "end": i + len(parts), "term": term})
                i += 1

    compounds: list[str] = []
    groups: dict[int, list[int]] = {}
    for i, t in enumerate(tokens):
        if t["group"] is None:
            continue
        span = groups.get(t["group"])
        groups[t["group"]] = [span[0], i + 1] if span else [i, i + 1]
    hits = all_hits
    for start, end in groups.values():
        whole = any(h["start"] <= start and h["end"] >= end for h in all_hits)
        inside = any(h["start"] < end and h["end"] > start for h in all_hits)
        if whole or not inside:
            continue
        hits = [h for h in hits if h["end"] <= start or h["start"] >= end]
        compounds.append("-".join(t["w"] for t in tokens[start:end]))

    # Самое длинное совпадение побеждает: «беговые лыжи» — это лыжи, а не бег
    ranked = sorted(hits, key=lambda h: (h["start"] - h["end"], -len(h["term"])))
    taken: list[Entity] = []
    for h in ranked:
        if any(h["start"] < t["end"] and h["end"] > t["start"] for t in taken):
            continue
        taken.append(h)
    taken.sort(key=lambda h: h["start"])
    unique: list[Entity] = []
    for h in taken:
        if not any(u is h["sport"] for u in unique):
            unique.append(h["sport"])
    return {"sports": unique, "hits": taken, "compounds": compounds}


def _common_prefix(a: str, b: str) -> int:
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]:
        i += 1
    return i


# Слова-уточнения: совпадение только по ним («русская лапта» и «русские шашки») — не похожесть.
QUALIFIER = re.compile(
    r"^(русск|пляжн|настольн|мини|больш|мал|детск|женск|мужск|спортивн|уличн|дворов|зимн|летн|командн|классическ|быстр|скоростн|северн|любительск|семейн|парн|одиночн)"
)


def _close_words(a: str, b: str) -> bool:
    def meaningful(s: str) -> list[str]:
        return [w for w in s.split(" ") if len(w) >= 4 and not QUALIFIER.search(w)]

    aw = meaningful(a)
    bw = meaningful(b)
    return any(
        word_matches(x, y) or word_matches(y, x) or (min(len(x), len(y)) >= 6 and _common_prefix(x, y) >= 6)
        for x in aw
        for y in bw
    )


_SUGGESTION_KEYS = ["id", "name", "icon", "kind", "popular", "categoryIds", "synonyms", "fields"]


def suggest_sports(query: str, sports: list[Entity], limit: int = 6) -> list[Entity]:
    q = normalize(query)
    if not q:
        return []
    scored: list[Entity] = []
    for s in sports:
        if s.get("mergedInto"):
            continue
        name = normalize(s["name"])
        synonyms = [normalize(x) for x in s["synonyms"]]
        terms = [name, *synonyms]
        match: str | None = None
        rank = 9
        if name == q:
            match, rank = "exact", 0
        elif q in synonyms:
            match, rank = "synonym", 1
        elif len(q) >= 3 and (any(x.startswith(q) for x in terms) or q in name):
            match, rank = "prefix", 2
        elif any(edit_distance(x, q) <= max(1, len(q) // 4) for x in terms):
            match, rank = "typo", 3
        elif any(len(x.split(" ")) == len(q.split(" ")) and _stems_equal(x, q) for x in terms):
            match, rank = "synonym", 1
        elif len(q) >= 4 and any(_close_words(x, q) for x in terms):
            match, rank = "typo", 4
        if match is not None:
            scored.append({"s": s, "match": match, "rank": rank})
    # Среди равных по совпадению популярные направления — первыми
    scored.sort(key=lambda x: (x["rank"], not x["s"].get("popular")))
    return [
        {**{k: x["s"][k] for k in _SUGGESTION_KEYS if k in x["s"]}, "match": x["match"]}
        for x in scored[:limit]
    ]


def _stems_equal(a: str, b: str) -> bool:
    aw = a.split(" ")
    bw = b.split(" ")
    return len(aw) == len(bw) and all(stem_ru(w) == stem_ru(bw[i]) for i, w in enumerate(aw))


# ---------- Дата и время ----------

WEEKDAYS: list[tuple[re.Pattern[str], int, str]] = [
    (re.compile(r"(^| )понедельник"), 1, "В понедельник"),
    (re.compile(r"(^| )вторник"), 2, "Во вторник"),
    (re.compile(r"(^| )сред(а|у|ы|ам)( |$)"), 3, "В среду"),
    (re.compile(r"(^| )четверг"), 4, "В четверг"),
    (re.compile(r"(^| )пятниц"), 5, "В пятницу"),
    (re.compile(r"(^| )субб?от"), 6, "В субботу"),
    (re.compile(r"(^| )воскресен"), 7, "В воскресенье"),
]

REPEAT_RE = re.compile(
    r"кажд(ую|ый|ое|ой) (понедельник|вторник|сред|четверг|пятниц|суббот|воскресен|недел)|(^| )по (понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)|еженедельн|раз в неделю"
)

MONTHS = [
    "январ", "феврал", "март", "апрел", "ма[яй]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр",
]  # fmt: skip
_MONTH_RES = [re.compile(r"(?:^| )(\d{1,2}) " + m) for m in MONTHS]


def _next_weekday(iso_dow: int, now: datetime) -> datetime:
    """Ближайший такой день недели после сегодняшнего — местная полночь."""
    offset = (iso_dow - now.isoweekday()) % 7 or 7
    return dates.start_of_day(now + timedelta(days=offset))


def _weekday_next_week(iso_dow: int, now: datetime) -> datetime:
    """День недели на следующей неделе: «в следующую субботу»."""
    return dates.start_of_day(now) + timedelta(days=7 + iso_dow - now.isoweekday())


def _upcoming_date(now: datetime, month: int, day: int) -> datetime | None:
    """Ближайшее такое число (сегодня или позже) — местная полночь; None, если такой даты нет в календаре."""
    today = dates.start_of_day(now)
    for year in (today.year, today.year + 1):
        try:
            d = today.replace(year=year, month=month, day=day)
        except ValueError:
            continue
        if d >= today:
            return d
    return None


_NUMERIC_DATE = re.compile(r"(?<![вкс] )(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d:])")


def _explicit_date(text: str, now: datetime) -> datetime | None:
    """«25.10», «1 ноября» — ближайшая такая дата."""
    numeric = _NUMERIC_DATE.search(text)
    if numeric:
        day = int(numeric.group(1))
        month = int(numeric.group(2))
        if 1 <= day <= 31 and 1 <= month <= 12:
            return _upcoming_date(now, month, day)
    for i, month_re in enumerate(_MONTH_RES):
        m = month_re.search(text)
        if m:
            return _upcoming_date(now, i + 1, int(m.group(1)))
    return None


def _date_label(day: datetime) -> str:
    """«Суббота, 25 октября»."""
    return capitalize(f"{dates.weekday_name(day)}, {dates.day_month(day)}")


_TIME_EXACT = re.compile(r"(?:^|[^\d.])([01]?\d|2[0-3]):([0-5]\d)(?!\d)")
_TIME_DOTTED = re.compile(r"(?:^|\s)(?:в|к|с)\s([01]?\d|2[0-3])\.([0-5]\d)(?!\d)")
_TIME_HOUR = re.compile(
    r"(?:^|\s)(?:в|к|с)\s([01]?\d|2[0-3])(?![\d.:])(?:\s?(утра|вечера|дня|ночи|часов|часа|час|ч)(?![а-я]))?"
)
_NOT_TIME_AFTER = re.compile(
    r"^(км|человек|чел|мест|лет|год|минут|мин|команд|раз|руб|р\b|₽|%|-|\.\d|й|ой|го)"
)
_EVENING = re.compile(r"вечера|дня")


def _extract_time(raw: str) -> str | None:
    """Время начала: «в 10», «в 18:30», «в семь вечера», «с 9 до 10»."""
    text = _numberize(raw)
    exact = _TIME_EXACT.search(text) or _TIME_DOTTED.search(text)
    if exact:
        return f"{int(exact.group(1)):02d}:{int(exact.group(2)):02d}"
    for m in _TIME_HOUR.finditer(text):
        if not m.group(2) and _NOT_TIME_AFTER.search(text[m.end() :].lstrip()):
            continue
        h = int(m.group(1))
        if _EVENING.search(m.group(2) or "") and h < 12:
            h += 12
        return f"{h:02d}:00"
    return None


# ---------- Районы и места ----------

DISTRICT_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"академгород"), "d-akadem"),
    (re.compile(r"(^| )центр(е|а|у)?( |$)|центральн(ый|ом|ого) район"), "d-center"),
    (re.compile(r"октябрьск"), "d-oct"),
    (re.compile(r"советск"), "d-sov"),
    (re.compile(r"взлетк"), "d-vzlet"),
    (re.compile(r"ветлужанк"), "d-vetluzh"),
    (re.compile(r"(^| )свердловск(ий|ом|ого)( |$)"), "d-sverd"),
    (re.compile(r"(^| )кировск(ий|ом|ого)( |$)"), "d-kirov"),
    (re.compile(r"(^| )ленинск(ий|ом|ого)( |$)"), "d-lenin"),
    (re.compile(r"(^| )железнодорожн(ый|ом|ого)( |$)"), "d-zhd"),
    (re.compile(r"покровк"), "d-pokrovka"),
    (re.compile(r"(^| )солнечн(ый|ом|ого)( |$)"), "d-solnech"),
    (re.compile(r"(^| )северн(ый|ом|ого)( |$)"), "d-north"),
]

# Известное место: {"re", "address", "districtId", "lat", "lng"}.
KNOWN_PLACES: list[Entity] = [
    {
        "re": re.compile(r"татыш"),
        "address": "Остров Татышев, вход с Коммунального моста",
        "districtId": "d-center",
        "lat": 56.0279,
        "lng": 92.9381,
    },
    {
        "re": re.compile(r"центральн\S* парк|(^| )парк\S* горьк"),
        "address": "Центральный парк, главный вход с ул. Карла Маркса",
        "districtId": "d-center",
        "lat": 56.0105,
        "lng": 92.8755,
    },
    {
        "re": re.compile(r"парк\S* гагарин|гагарин\S* парк"),
        "address": "Парк Гагарина, ул. Гагарина",
        "districtId": "d-kirov",
        "lat": 55.9939,
        "lng": 92.9312,
    },
    {
        "re": re.compile(r"театральн\S* площад"),
        "address": "Театральная площадь, у фонтана",
        "districtId": "d-center",
        "lat": 56.0089,
        "lng": 92.8722,
    },
    {
        "re": re.compile(r"набережн"),
        "address": "Набережная Енисея у Коммунального моста",
        "districtId": "d-center",
        "lat": 56.0086,
        "lng": 92.8935,
    },
    {
        "re": re.compile(r"остров\S* отдых"),
        "address": "Остров Отдыха, спортивная площадка",
        "districtId": "d-sverd",
        "lat": 55.9995,
        "lng": 92.8871,
    },
    {
        "re": re.compile(r"(^| )столб"),
        "address": "Нацпарк «Красноярские Столбы», Центральный вход",
        "districtId": "d-kirov",
        "lat": 55.9592,
        "lng": 92.8132,
    },
    {
        "re": re.compile(r"(^| )сфу( |$)|свободн\S* 79"),
        "address": "Спорткомплекс СФУ, пр. Свободный, 79",
        "districtId": "d-akadem",
        "lat": 56.0049,
        "lng": 92.7697,
    },
    {
        "re": re.compile(r"академгород"),
        "address": "Академгородок, сквер у дома 17",
        "districtId": "d-akadem",
        "lat": 56.0046,
        "lng": 92.7712,
    },
    {
        "re": re.compile(r"ветлужанк"),
        "address": "Лыжная база в Ветлужанке",
        "districtId": "d-vetluzh",
        "lat": 56.0312,
        "lng": 92.7268,
    },
    {
        "re": re.compile(r"взлетк"),
        "address": "Взлётка, ул. Весны, 7",
        "districtId": "d-vzlet",
        "lat": 56.0476,
        "lng": 92.9149,
    },
]

POPULAR_PLACES = KNOWN_PLACES[:3]


def locate_place(address: str) -> Entity | None:
    """Координаты для известного места по адресу или ориентиру — чтобы смена адреса не оставляла старую точку."""
    text = normalize(address)
    known = next((p for p in KNOWN_PLACES if p["re"].search(text)), None)
    return {"districtId": known["districtId"], "lat": known["lat"], "lng": known["lng"]} if known else None


# Существительные мест в предложном или родительном падеже → именительный.
PLACE_NOUNS: dict[str, str] = {
    "парке": "парк", "парка": "парк", "сквере": "сквер", "сквера": "сквер", "зале": "зал", "зала": "зал",
    "дворе": "двор", "двора": "двор", "стадионе": "стадион", "стадиона": "стадион", "острове": "остров",
    "набережной": "набережная", "школе": "школа", "школы": "школа", "спорткомплексе": "спорткомплекс",
    "площадке": "площадка", "площадки": "площадка", "корте": "корт", "кортах": "корты", "бассейне": "бассейн",
    "бассейна": "бассейн", "библиотеке": "библиотека", "библиотеки": "библиотека", "клубе": "клуб",
    "клуба": "клуб", "центре": "центр", "центра": "центр", "фоке": "ФОК", "веранде": "веранда",
    "веранды": "веранда", "базе": "база", "базы": "база", "площади": "площадь", "входа": "вход", "входе": "вход",
    "манеже": "манеж", "арене": "арена", "арены": "арена", "студии": "студия", "поле": "поле", "поля": "поле",
    "роще": "роща", "дк": "ДК", "доме": "дом", "подъезда": "подъезд", "остановки": "остановка",
    "остановке": "остановка", "спортзале": "спортзал", "спортзала": "спортзал", "баре": "бар", "кафе": "кафе",
    "дворце": "дворец", "дворца": "дворец", "манежа": "манеж", "лицее": "лицей", "гимназии": "гимназия",
    "университете": "университет", "общежитии": "общежитие",
}  # fmt: skip
BARE_PLACE_NOUNS = [
    "зал",
    "спортзал",
    "парк",
    "стадион",
    "школа",
    "бассейн",
    "клуб",
    "сквер",
    "двор",
    "площадка",
    "корт",
]
GENITIVE_TAIL = ["парка", "школы", "библиотеки", "стадиона", "клуба", "дома", "сквера"]
_FEMININE_END = re.compile(r"[ая]$|ь$")


def _feminine(noun: str) -> bool:
    return bool(_FEMININE_END.search(noun)) and noun != "путь"


_ADJ_OGO = re.compile(r"(ого|его)$")
_ADJ_OM = re.compile(r"(ом|ем|ой|ей)$")
_ADJ_EY = re.compile(r"ей$")
_HARD_STEM = re.compile(r"[кгхжшчщ]$")


def _nominative_adjective(adj: str, noun: str) -> str:
    fem = _feminine(noun)
    lower = adj.lower()
    stem = adj
    if _ADJ_OGO.search(lower):
        stem = adj[:-3]
    elif _ADJ_OM.search(lower):
        stem = adj[:-2]
    else:
        return adj
    if fem:
        return stem + ("яя" if _ADJ_EY.search(lower) else "ая")
    return stem + ("ий" if _HARD_STEM.search(stem.lower()) else "ый")


_TAIL_PATTERNS = [
    re.compile(r'^\s+(«[^»]{1,40}»|"[^"]{1,40}")'),
    re.compile(r"^\s*(№\s?\d+[а-яА-Я]?)"),
    re.compile(r"^\s+(\d{1,4}[а-яА-Я]?)(?![\d:.])(?!\s?(?:км|человек|чел|мест|руб|р\b|₽))"),
    re.compile(r"^\s+((?:на|у|ул\.?)\s+(?=[А-ЯЁ0-9])[^\s,.;!?]+)"),
    re.compile(r"^\s+((?:" + "|".join(GENITIVE_TAIL) + r")\s+(?:№\s?)?[А-ЯЁ0-9][^\s,.;!?]*)"),
    re.compile(r"^\s+([А-ЯЁ][а-яё-]+)"),
]
_CAPITALIZED_WORD = re.compile(r"^[А-ЯЁ][а-яё]+$")
_SPACE_NUMERO = re.compile(r"^\s№")


def _place_tail(rest: str) -> str:
    """Хвост места после существительного: ««Радуга»», «№10», «на Мира 12», «парка Горького»."""
    tail = ""
    s = rest
    while True:
        m = next((found for p in _TAIL_PATTERNS if (found := p.search(s))), None)
        if not m:
            break
        piece = m.group(1)
        if _CAPITALIZED_WORD.search(piece) and WEEKDAY_WORD.search(piece.lower()):
            break
        tail += _SPACE_NUMERO.sub(" №", f" {piece}", count=1)
        s = s[len(m.group(0)) :]
    return _WS_SPLIT.sub(" ", tail)


WEEKDAY_WORD = re.compile(
    r"^(в|во)?(понедельник|вторник|сред|четверг|пятниц|суббот|воскресен|сегодня|завтра)"
)

# Найденное место: {"index", "phrase", "address", "meet"}.
# phrase — как в тексте, с предлогом: «в парке Гагарина» — для названия;
# address — в именительном падеже: «парк Гагарина» — для адреса.


def _head_re(k: str) -> str:
    if k == "фоке":
        return "ФОКе|фоке"
    if k == "дк":
        return "ДК"
    return f"[{k[0].upper()}{k[0]}]{k[1:]}"


HEADS_RE = "|".join(_head_re(k) for k in sorted(PLACE_NOUNS, key=len, reverse=True))
_PLACES_RE = re.compile(
    r"(^|[\s,(])(в|во|на|у|от|возле|около|В|Во|На|У|От)\s+(?:([А-Яа-яЁё-]+(?:ом|ой|ем|ей|ого|его))\s+)?("
    + HEADS_RE
    + r")(?=[\s,.;:!?»)]|$)"
)
# Место без предлога в начале части фразы: «…, зал «Динамо», …»
_BARE_PLACES_RE = re.compile(
    r"(^|[,.;]\s*)(" + "|".join(BARE_PLACE_NOUNS) + r')(?=\s+[«"№0-9А-ЯЁ])', re.IGNORECASE
)
_MEET_BEFORE = re.compile(r"(сбор|встречаемся|встреча|собираемся)\s*$")
_SENTENCE_END = re.compile(r"[.;!?]")


def _find_places(raw: str) -> list[Entity]:
    out: list[Entity] = []
    for m in _PLACES_RE.finditer(raw):
        head = m.group(4)
        noun = PLACE_NOUNS.get(head.lower(), head.lower())
        adj = f"{_nominative_adjective(m.group(3), noun)} " if m.group(3) else ""
        tail = _place_tail(raw[m.end() :])
        before = raw[max(0, m.start() - 14) : m.start() + len(m.group(1))].lower()
        out.append(
            {
                "index": m.start(),
                "phrase": f"{m.group(2).lower()} {f'{m.group(3)} ' if m.group(3) else ''}{head}{tail}",
                "address": capitalize(f"{adj.lower()}{noun}{tail}"),
                "meet": bool(_MEET_BEFORE.search(before.rstrip())),
            }
        )
    for m in _BARE_PLACES_RE.finditer(raw):
        tail = _place_tail(raw[m.end() :])
        if not tail.strip():
            continue
        out.append(
            {
                "index": m.start(),
                "phrase": f"{m.group(2).lower()}{tail}",
                "address": capitalize(f"{m.group(2).lower()}{tail}"),
                "meet": False,
            }
        )
    out.sort(key=lambda p: p["index"])
    # «на школьном стадионе, школа 85» — продолжение того же места
    i = 0
    while i < len(out) - 1:
        a = out[i]
        b = out[i + 1]
        between = raw[a["index"] : b["index"]]
        if (
            not a["meet"]
            and not b["meet"]
            and not _SENTENCE_END.search(between)
            and len(between) < len(a["phrase"]) + 6
        ):
            a["address"] = f"{a['address']}, {b['address'].lower()}"
            del out[i + 1]
        i += 1
    return out


_DIGIT = re.compile(r"[0-9]")


def _stems_of(text: str) -> list[str]:
    return [stem_ru(w) for w in split_words(text) if len(w) >= 3 or _DIGIT.search(w)]


def _contained_in(part: str, whole: str) -> bool:
    target = _stems_of(whole)
    return all(any(t == s or t.startswith(s) or s.startswith(t) for t in target) for s in _stems_of(part))


# ---------- Уровень, цена, люди ----------

NOT_FOR_BEGINNERS = re.compile(r"новичк\S* не (бер|подойд|пуска|прин)|не для новичк|без новичк|только опытн")
BEGINNERS_WELCOME = re.compile(
    r"новичкам (можно|тоже|рады|welcome)|рады новичкам|новички (тоже|приветству|welcome)|новичков (тоже|ждем)|и новичкам|новичкам и"
)
BEGINNER = re.compile(
    r"нович|начинающ|только начина(ю|ем|л)|с нуля|впервые|первый раз|никогда не|только учусь|(^| )учусь|не умею|не умеет|не умеем|научиться|научите|научу|научим|для начинающ"
)
EXPERIENCED = re.compile(r"опытн|профи( |$)|(^| )сильн|продвинут|уже лет|много лет|давно играю|кмс|разрядник")
AMATEUR = re.compile(r"любительск|любител|(^| )средн(ий|е|его|ем|ее)?( |$)|играю нормально")
FREE_RE = re.compile(r"бесплатн|без денег|даром|не платить|без оплаты|за так( |$)")
PEOPLE = r"(?:человек|чел|участник\S*|игрок\S*)"

IGNORED_FOR_SEARCH = re.compile(
    r"^(пенсионер\S*|пожил\S*|возраст\S*|лет|годиков|бабушк\S*|дедушк\S*|выйти|погулять|гулять|прогуляться|скучно|одна|один|одной|одному|хожу|ходим|ходить|покататься|кататься|позаниматься|подвигаться|научиться|не|спеша|пацан\S*|ребенк\S*|сын\S*|доч\S*|внук\S*|в|фильтр\S*|понимаю|ваших|людьми)$"
)

_PRICE_MAX = re.compile(
    r"(?:^| )(?:до|дешевле|не дороже|не больше|не более|максимум|в пределах)\s(\d{2,6})(?!\d)(?!\s?(?:чел|мест|км|лет|год|участ|игрок|минут|мин|час|ч |человек|раз|утра|вечера|дня))"
)


def _price_max_from(text: str) -> int | None:
    m = _PRICE_MAX.search(text)
    if not m:
        return None
    value = int(m.group(1))
    return value if value >= 50 else None


_NEXT_WEEK = re.compile(r"следующ\S* (понедельник|вторник|сред|четверг|пятниц|субб?от|воскресен)")
_RE_AFTER_TOMORROW = re.compile(r"послезавтра")
_RE_TODAY = re.compile(r"(^| )сегодня")
_RE_TOMORROW = re.compile(r"(^| )завтра")
_RE_WEEKEND = re.compile(r"выходн")
_RE_THIS_WEEK = re.compile(r"(на|эт(ой|у)) недел")
_RE_MORNING = re.compile(r"(^| )(утр|утреч)")
_RE_EVENING = re.compile(r"(^| )вечер|после работы")
_RE_DAY = re.compile(r"(^| )дн[её]м( |$)|в обед|после обеда|после школы|(^| )днем( |$)")
_RE_RADIUS = re.compile(r"(\d{1,2})\s?км")
_RE_NEAR = re.compile(r"рядом|недалеко|поблизости|возле дома|около дома|близко|поближе|неподалеку")
_RE_OPEN_JOIN = re.compile(r"без заявк|без записи|без подтвержд|свободн(ая|ой|ую) запис|запись свободн")
_RE_NUMBER = re.compile(r"^\d+$")
_DAY_PART_LABEL = {"morning": "Утром", "day": "Днём", "evening": "Вечером"}

_MARK_AFTER_TOMORROW = re.compile(r"послезавтра")
_MARK_TODAY = re.compile(r"сегодня")
_MARK_TOMORROW = re.compile(r"завтра")
_MARK_NEXT = re.compile(r"следующ|эту|этот")
_MARK_WEEKEND = re.compile(r"выходн")
_MARK_WEEK = re.compile(r"недел|этой")
_MARK_MORNING = re.compile(r"^утр")
_MARK_EVENING = re.compile(r"^вечер|^после$|^работы$")
_MARK_DAY = re.compile(r"^днем$|^обед|^после$|^школы$")
_MARK_BEGINNER = re.compile(r"нович|начина|нуля|впервые|никогда|учусь|умею|умеет|научи")
_MARK_EXPERIENCED = re.compile(r"опытн|профи|сильн|продвинут")
_MARK_AMATEUR = re.compile(r"любител|средн")
_MARK_FREE = re.compile(r"бесплатн|денег|даром|платить|оплаты")
_MARK_PRICE = re.compile(r"^\d+$|дешевле|дороже|дорого|руб|^р$")
_MARK_NEAR = re.compile(r"рядом|недалеко|поблизости|возле|около|дома|домом|близко|поближе|неподалеку|км")
_MARK_DISTRICT = re.compile(r"^район")
_MARK_OPEN_JOIN = re.compile(r"заявк|записи|подтвержд|свободн|запис")


def parse_search(raw: str, ctx: AssistantContext) -> Entity:
    """Разбор фразы поиска: {"filters", "chips", "rest"}."""
    text = normalize(_numberize(raw))
    tokens = [w for w in text.split(" ") if w]
    filters: Entity = {}
    chips: list[Entity] = []
    used: set[str] = set()

    def mark_used(pattern: re.Pattern[str]) -> None:
        for w in tokens:
            if pattern.search(w):
                used.add(w)

    scan = _scan_sports(raw, ctx["sports"])
    sports = scan["sports"]
    if sports:
        filters["sportIds"] = [s["id"] for s in sports]
        chips.extend({"key": "sportIds", "label": s["name"], "value": s["id"]} for s in sports)
        raw_tokens = _tokenize(raw)
        for h in scan["hits"]:
            for t in raw_tokens[h["start"] : h["end"]]:
                used.add(t["w"])

    now = dates.moment(ctx["now"])
    date = _explicit_date(raw.lower(), now)
    next_week = _NEXT_WEEK.search(text)
    weekday = next((w for w in WEEKDAYS if w[0].search(text)), None)
    if _RE_AFTER_TOMORROW.search(text):
        d = dates.start_of_day(now + timedelta(days=2))
        filters.update({"when": "date", "date": clock.iso(d)})
        chips.append({"key": "when", "label": _date_label(d), "value": "date"})
        mark_used(_MARK_AFTER_TOMORROW)
    elif _RE_TODAY.search(text):
        filters["when"] = "today"
        chips.append({"key": "when", "label": "Сегодня", "value": "today"})
        mark_used(_MARK_TODAY)
    elif _RE_TOMORROW.search(text):
        filters["when"] = "tomorrow"
        chips.append({"key": "when", "label": "Завтра", "value": "tomorrow"})
        mark_used(_MARK_TOMORROW)
    elif date:
        filters.update({"when": "date", "date": clock.iso(date)})
        chips.append({"key": "when", "label": _date_label(date), "value": "date"})
    elif weekday:
        d = _weekday_next_week(weekday[1], now) if next_week else _next_weekday(weekday[1], now)
        filters.update({"when": "date", "date": clock.iso(d)})
        chips.append({"key": "when", "label": _date_label(d), "value": "date"})
        mark_used(weekday[0])
        mark_used(_MARK_NEXT)
    elif _RE_WEEKEND.search(text):
        filters["when"] = "weekend"
        chips.append({"key": "when", "label": "На выходных", "value": "weekend"})
        mark_used(_MARK_WEEKEND)
    elif _RE_THIS_WEEK.search(text):
        filters["when"] = "week"
        chips.append({"key": "when", "label": "На этой неделе", "value": "week"})
        mark_used(_MARK_WEEK)

    time = _extract_time(raw)
    if _RE_MORNING.search(text):
        filters["dayPart"] = "morning"
        mark_used(_MARK_MORNING)
    elif _RE_EVENING.search(text):
        filters["dayPart"] = "evening"
        mark_used(_MARK_EVENING)
    elif _RE_DAY.search(text):
        filters["dayPart"] = "day"
        mark_used(_MARK_DAY)
    elif time:
        h = int(time[:2])
        filters["dayPart"] = "morning" if h < 12 else "day" if h < 17 else "evening"
    if filters.get("dayPart"):
        label = _DAY_PART_LABEL[filters["dayPart"]]
        chips.append({"key": "dayPart", "label": label, "value": filters["dayPart"]})

    if not NOT_FOR_BEGINNERS.search(text) and (BEGINNERS_WELCOME.search(text) or BEGINNER.search(text)):
        filters["beginners"] = True
        chips.append({"key": "beginners", "label": "Рады новичкам", "value": True})
        mark_used(_MARK_BEGINNER)
    elif EXPERIENCED.search(text):
        filters["level"] = "experienced"
        chips.append({"key": "level", "label": "Для опытных", "value": "experienced"})
        mark_used(_MARK_EXPERIENCED)
    elif AMATEUR.search(text):
        filters["level"] = "amateur"
        chips.append({"key": "level", "label": "Любительский уровень", "value": "amateur"})
        mark_used(_MARK_AMATEUR)

    price_max = _price_max_from(text)
    if FREE_RE.search(text):
        filters["free"] = True
        chips.append({"key": "free", "label": "Бесплатно", "value": True})
        mark_used(_MARK_FREE)
    elif price_max:
        filters["priceMax"] = price_max
        chips.append({"key": "priceMax", "label": f"До {format_rub(price_max)}", "value": price_max})
        mark_used(_MARK_PRICE)

    radius = _RE_RADIUS.search(text)
    if _RE_NEAR.search(text) or radius:
        filters["near"] = True
        if radius:
            filters["radiusKm"] = int(radius.group(1))
        chips.append(
            {
                "key": "near",
                "label": f"До {radius.group(1)} км от вас" if radius else "Рядом с вами",
                "value": True,
            }
        )
        mark_used(_MARK_NEAR)

    district_hint = next((h for h in DISTRICT_HINTS if h[0].search(text)), None)
    if district_hint:
        d = next((x for x in ctx["districts"] if x["id"] == district_hint[1]), None)
        if d:
            filters["districtId"] = d["id"]
            chips.append({"key": "districtId", "label": d["name"], "value": d["id"]})
            for w in tokens:
                if district_hint[0].search(f" {w} "):
                    used.add(w)
            mark_used(_MARK_DISTRICT)

    if _RE_OPEN_JOIN.search(text):
        filters["joinMode"] = "open"
        chips.append({"key": "joinMode", "label": "Свободная запись", "value": "open"})
        mark_used(_MARK_OPEN_JOIN)

    rest = " ".join(
        w
        for w in tokens
        if w not in used
        and w not in STOP_WORDS
        and not IGNORED_FOR_SEARCH.search(w)
        and not _RE_NUMBER.search(w)
        and len(w) > 2
    )
    if rest and not sports:
        filters["q"] = rest
    return {"filters": filters, "chips": chips, "rest": "" if sports else rest}


# ---------- Черновики карточек ----------


def _extract_date(parsed: Entity, now: datetime) -> datetime | None:
    """День встречи из разобранной фразы — местная полночь."""
    f = parsed["filters"]
    if f.get("when") == "today":
        return dates.start_of_day(now)
    if f.get("when") == "tomorrow":
        return dates.start_of_day(now + timedelta(days=1))
    if f.get("when") == "date" and f.get("date"):
        return dates.moment(f["date"])
    return None


NEW_SPORT_CUE = re.compile(
    r"(?:^| )(?:играть|сыграть|поиграть|играем|сыграем|поиграем|игру|игра|игры|партию|команду|команда|занятие|занятия|тренировку|тренировка|тренировки|турнир|секцию|секция|людей|ребят|компанию|соберу|собираю|собрать|собираем|организую|научу|учимся|занимаемся)\s(в|на|по|для)\s([а-я-]{4,})(?:\s([а-я-]{4,}))?"
)
NOT_A_SPORT = re.compile(
    r"^(субб|суббот|воскрес|понедел|вторник|сред|четверг|пятниц|завтр|сегодн|утр|вечер|выходн|недел|улиц|двор|парк|площад|зал|школ|стадион|бассейн|центр|район|город$|города|городе|природ|свеж|игру|игры|встреч|компани|люд|ребят|мероприят|событ|занят|тренировк|прогулк|час|время|неделю)"
)
_ADJECTIVE_END = re.compile(r"(ое|ая|ый|ий|ой|ые|ие|ую|ую)$")
_UYU = re.compile(r"ую$")
_YUYU = re.compile(r"юю$")
_U_AFTER_CONSONANT = re.compile(r"(?<=[^аеиоуыэюя])у$")
_YU = re.compile(r"ю$")
_CONSONANT_U = re.compile(r"[^аеиоуыэюя]у$")


def _to_nominative(w: str) -> str:
    # «в лапту» → «лапта», «в русскую лапту» → «русская лапта»
    w = _UYU.sub("ая", w, count=1)
    w = _YUYU.sub("яя", w, count=1)
    w = _U_AFTER_CONSONANT.sub("а", w, count=1)
    return _YU.sub("я", w, count=1)


def _guess_new_sport(raw: str, scan: Entity) -> str | None:
    """Новое направление называем только по слову после глагола или составному слову через дефис."""
    if scan["compounds"]:
        return scan["compounds"][0]
    text = _TOKEN_SPLIT.sub(" ", raw.lower().replace("ё", "е")).strip()
    m = NEW_SPORT_CUE.search(text)
    if not m:
        return None
    first = m.group(2)
    if NOT_A_SPORT.search(first) or first in STOP_WORDS:
        return None
    second = (
        m.group(3)
        if m.group(3) and _ADJECTIVE_END.search(first) and not NOT_A_SPORT.search(m.group(3))
        else None
    )
    if m.group(1) in {"в", "на"}:
        if second:
            return f"{_to_nominative(first)} {_to_nominative(second)}"
        first = _to_nominative(first)
    elif m.group(1) == "по" and not second and _CONSONANT_U.search(first) and len(first) > 4:
        # «тренировка по дартсу» → «дартс»
        first = first[:-1]
    return f"{first} {second}" if second else first


ITEM_HINT = re.compile(
    r"форм|сменк|обув|кроссовк|бутс|коврик|полотенц|(^| )вод[аыу]?( |$)|шапочк|очк|тапоч|справк|ракетк|волан|мяч|перчатк|шлем|палк|лыж|роллер|коньк|велосипед|компас|доск|термос|перекус|дождевик|купальник|плавк|бинт|капу|капа|защит|налокотник|наколенник|фонар|рюкзак|майк|футболк|манишк|клюшк|бит[ыу]"
)
OWN_INVENTORY = re.compile(
    r"^(.{0,40}?(?:мяч|мячи|биты|бита|ракетки|ракетка|инвентарь|доски|палки|коврики|лыжи|клюшки|перчатки|часы|форма|манишки|воланы))\s(есть|дам|дадим|выдаем|выдадим|даем|у нас|будут|предоставим|наши)(?=\s|$)"
)
BRING_TRIGGER = re.compile(
    r"(?:^|\s)(взять|возьмите|возьми|берите|бери|захватите|захвати|с собой|при себе|нужн[аоы]?|понадоб\S*|обязател\S*|свой|свои|своя|свое|своим)(?=\s|$)"
)
FILLERS = re.compile(
    r"(^|\s)(если есть|лучше|обязательно|обязателен|обязательна|обязательны|с собой|при себе|свой|свои|своя|свое|нужен|нужна|нужно|нужны|берите|возьмите|захватите|взять|пожалуйста|тоже|еще)(?=\s|$)"
)
ITEM_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^сменк\S*$"), "сменная обувь"),
    (re.compile(r"^форма спортивная$"), "спортивная форма"),
]
_LEADING_CONJUNCTION = re.compile(r"^(и|а|но|ну)\s")
_NOT_AN_ITEM = re.compile(r"\d|руб|человек|мест")
_THREE_LETTERS = re.compile(r"[а-я]{3,}")
_U_AFTER_CONSONANT_OR_SOFT = re.compile(r"(?<=[^аеиоуыэюяь])у$")


def _item_word(w: str) -> str:
    if len(w) <= 3:
        return w
    w = _UYU.sub("ая", w, count=1)
    w = _YUYU.sub("яя", w, count=1)
    return _U_AFTER_CONSONANT_OR_SOFT.sub("а", w, count=1)


def _clean_item(item: str) -> str | None:
    s = _WS_SPLIT.sub(" ", FILLERS.sub(" ", item)).strip()
    s = _LEADING_CONJUNCTION.sub("", s, count=1).strip()
    if not s or _NOT_AN_ITEM.search(s) or len(s.split(" ")) > 4:
        return None
    if not _THREE_LETTERS.search(s):
        return None
    for pattern, fix in ITEM_FIXES:
        if pattern.search(s):
            s = fix
    # «берите шапочку и воду» → «шапочка», «вода»
    return " ".join(_item_word(w) for w in s.split(" "))


# Направления, где «что взять» подразумевается: {"re", "item"}.
IMPLIED_BRING: dict[str, Entity] = {
    "s-cycling": {"re": re.compile(r"велосипед\S* (дадим|дам|есть|напрокат)|прокат"), "item": "велосипед"},
}
_SENTENCE_SPLIT = re.compile(r"[.!?;]+")
_LEADING_AND = re.compile(r"^(?:и|а|ну)\s")
_OWN_PRESENT = re.compile(r"есть|у нас|наши|будут")
_OPTIONAL_ITEM = re.compile(r"по желанию|если хотите|можно без")
_COME_IN = re.compile(r"приходите\s(?:в|во)\s(.+)$")
_IMPERATIVE = re.compile(r"взять|возьм|бер|захват|нужн|понадоб|при себе")
_AND_SPLIT = re.compile(r"\s+и\s+")
_NOT_AN_ITEM_SOURCE = re.compile(r"\d|человек|мест")


def _extract_bring(raw: str, sport_id: str | None) -> Entity:
    """«Что взять»: перечисление после «берите», «нужны», «с собой», «свои». «Мяч есть» — это инвентарь организатора."""
    items: list[str] = []
    notes: list[str] = []
    text = _numberize(raw)
    for sentence in _SENTENCE_SPLIT.split(text):
        segments = [s for s in (x.strip() for x in sentence.split(",")) if s]
        listing = False
        for segment in segments:
            own = OWN_INVENTORY.search(_LEADING_AND.sub("", segment, count=1))
            if own:
                notes.append(
                    capitalize(
                        f"{own.group(1)} есть у организатора"
                        if _OWN_PRESENT.search(own.group(2))
                        else f"{own.group(1)} даст организатор"
                    )
                )
                listing = False
                continue
            if _OPTIONAL_ITEM.search(segment):
                listing = False
                continue
            come_in = _COME_IN.search(segment)
            if come_in and ITEM_HINT.search(come_in.group(1)):
                item = _clean_item(come_in.group(1))
                if item:
                    items.append(item)
                continue
            trigger = BRING_TRIGGER.search(segment)
            after = FILLERS.sub(" ", segment[trigger.end() :]).strip() if trigger else ""
            imperative = bool(trigger and _IMPERATIVE.search(trigger.group(1)))
            before = " ".join(segment[: trigger.start()].split(" ")[-3:]) if trigger else ""
            source = after if imperative and after else before or after
            if trigger and source and not _NOT_AN_ITEM_SOURCE.search(source):
                for part in _AND_SPLIT.split(source):
                    item = _clean_item(part)
                    if item:
                        items.append(item)
                listing = imperative
                continue
            parts = _AND_SPLIT.split(segment)
            if (listing or all(ITEM_HINT.search(p) for p in parts)) and len(segment.split(" ")) <= 6:
                if not all(ITEM_HINT.search(p) for p in parts):
                    listing = False
                    continue
                for part in parts:
                    item = _clean_item(part)
                    if item:
                        items.append(item)
                continue
            listing = False
    implied = IMPLIED_BRING.get(sport_id) if sport_id else None
    if implied and not implied["re"].search(text) and not any(implied["item"] in i for i in items):
        items.insert(0, implied["item"])
    return {"items": list(dict.fromkeys(items)), "note": ". ".join(notes)}


_THRESHOLD_RES = [
    re.compile(
        r"(?:если наберется|состоится если|состоится при|минимум|хотя бы|не меньше)\s(\d{1,3})(?:\s"
        + PEOPLE
        + r")?(?!\s?(?:лет|год|руб|км))"
    ),
    re.compile(
        r"(?:нужно|надо|нужны|нужен|соберем|наберем|собираем)\s(?:еще\s)?(?:минимум\s)?(\d{1,3})\s" + PEOPLE
    ),
    re.compile(PEOPLE + r"\s(\d{1,3})\s(?:надо|нужно|соберем|наберем)"),
]
_TEAMS = re.compile(r"(\d{1,2})\s(?:команд\S*)\sпо\s(\d{1,2})")
# «с 9 до 10» — время, а не лимит мест: просмотр назад отдельно для одной и двух цифр.
_CAPACITY_RES = [
    re.compile(PEOPLE + r"\s(\d{1,3})\s(?:максимум|макс)"),
    re.compile(
        r"(?:^| )(?<!с \d )(?<!с \d\d )(?:до|максимум|не больше|не более|лимит|макс)\s(\d{1,3})(?!\d)(?!\s?(?:руб|р |р$|км|лет|год|минут|час|утра|вечера))"
    ),
    re.compile(r"(?:^| )мест\S*\s(\d{1,3})(?!\d)|(?:^| )(\d{1,3})\sмест"),
]
_PLAIN_PEOPLE = re.compile(r"(?:^| )(\d{1,3})\s" + PEOPLE)


def _first_match(patterns: list[re.Pattern[str]], text: str) -> re.Match[str] | None:
    """Совпадение по первому подошедшему шаблону из списка."""
    return next((m for p in patterns if (m := p.search(text))), None)


def _extract_people(raw: str) -> Entity:
    text = normalize(_numberize(raw))
    why: list[str] = []
    threshold: int | None = None
    capacity: int | None = None
    t = _first_match(_THRESHOLD_RES, text)
    if t:
        threshold = int(t.group(1))
        why.append(f"«{t.group(0)}»: встреча состоится, если наберётся столько людей")
    teams = _TEAMS.search(text)
    c = _first_match(_CAPACITY_RES, text)
    if teams:
        capacity = int(teams.group(1)) * int(teams.group(2))
        why.append(f"«{teams.group(0)}»: всего {capacity} мест")
    elif c:
        capacity = int(next(g for g in c.groups() if g is not None))
        why.append(f"«{c.group(0).strip()}»: столько мест")
    elif not threshold:
        plain = _PLAIN_PEOPLE.search(text)
        if plain:
            capacity = int(plain.group(1))
            why.append(f"«{plain.group(0).strip()}»: столько мест")
    if capacity is not None and (capacity < 2 or capacity > 500):
        capacity = None
    if threshold is not None and (threshold < 2 or (capacity is not None and threshold > capacity)):
        threshold = None
    return {"capacity": capacity, "threshold": threshold, "why": why}


_SPLIT_PRICE = re.compile(r"скидываемся|делим|вскладчину|на всех|поровну")
_SPLIT_TOTAL_RES = [
    re.compile(r"(?:за|аренда\S*|стоит|стоимость|обходится)\s(\d{3,6})(?!\d)"),
    re.compile(r"(\d{3,6})\s?(?:руб\S*|р|₽)?\s(?:на всех|за зал|за корт|за аренду|за лед)"),
]
_FIXED_PRICE_RES = [
    re.compile(r"(?:^| )(\d{2,6})\s?(?:руб\S*|р|₽)(?= |$)"),
    re.compile(r"(?:^| )(\d{2,6})\s(?:с человека|с носа|за вход|за занятие|за игру)"),
    re.compile(r"взнос\s(\d{2,6})"),
]


def _extract_price(raw: str) -> Entity:
    text = normalize(_numberize(raw))
    if FREE_RE.search(text):
        return {"price": {"kind": "free"}, "why": "В тексте «бесплатно»"}
    if _SPLIT_PRICE.search(text):
        total = _first_match(_SPLIT_TOTAL_RES, text)
        if total:
            return {
                "price": {"kind": "split", "total": int(total.group(1)), "note": "на аренду"},
                "why": f"Скидываемся: {format_rub(int(total.group(1)))} делим на всех участников",
            }
    fixed = _first_match(_FIXED_PRICE_RES, text)
    if fixed:
        return {
            "price": {"kind": "fixed", "amount": int(fixed.group(1))},
            "why": f"Цена из текста: {format_rub(int(fixed.group(1)))}",
        }
    return {"price": None, "why": ""}


# Как назвать встречу по направлению: «пробежка», а не «Бег». Женский род — для «Утренняя».
MEETING_NOUN: dict[str, tuple[str, str]] = {
    "s-running": ("пробежка", "f"),
    "s-workout": ("зарядка", "f"),
    "s-cycling": ("велопрогулка", "f"),
    "s-skiing": ("лыжная прогулка", "f"),
    "s-nordic": ("скандинавская ходьба", "f"),
    "s-hiking": ("поход", "m"),
}

_KNOWN_PHRASE_RE = re.compile(r"(^|[\s,])(в|во|на|у|по|от|возле)\s+([А-Яа-яЁё-]+)(\s+[А-ЯЁ][а-яё-]+)?")


def _known_phrase(raw: str, known: Entity) -> str | None:
    """Фраза с предлогом из текста для известного места: «в Академгородке», «на остров Татышев»."""
    for m in _KNOWN_PHRASE_RE.finditer(raw):
        phrase = f"{m.group(3)}{m.group(4) or ''}"
        if known["re"].search(normalize(phrase)):
            return f"{m.group(2).lower()} {phrase}"
    return None


_ACTIVITY_RE = re.compile(
    r"((?:[Оо]ткрыт\S*\s)?(?:[Тт]ренировк\S*|[Бб]лиц|[Тт]урнир|[Мм]астер-класс|[Уу]рок|[Зз]анятие)\s(?:по|в)\s([А-Яа-яЁё-]+))"
)
_OPEN_PREFIX = re.compile(r"^([Оо]ткрыт)\S*")
_TRAINING = re.compile(r"([Тт]ренировк)\S*")


def _activity_title(raw: str, scan: Entity, new_sport: str | None) -> str | None:
    m = _ACTIVITY_RE.search(raw)
    if not m:
        return None
    obj = m.group(2).lower()
    is_sport = any(
        h["term"] and word_matches(obj, normalize(h["term"]).split(" ")[0]) for h in scan["hits"]
    ) or bool(new_sport and normalize(new_sport).startswith(stem_ru(obj)))
    if not is_sport:
        return None
    title = _OPEN_PREFIX.sub(r"\g<1>ая", m.group(1), count=1)
    title = _TRAINING.sub(r"\g<1>а", title, count=1)
    return capitalize(title.lower())


_RE_APPROVAL = re.compile(
    r"по заявк|с подтвержден|по подтвержден|отбор|(^| )заявки|решаю кого|кого брать|сам[аи]? выбираю"
)
_RE_OPEN = re.compile(r"без записи|без заявк|без подтвержд|свободн\S* запис|приходите все")
_TITLE_NAMED = re.compile(
    r'(?:назов[её]м|назовем|называется|название)\s*[:—-]?\s*[«"]([^»"]{3,80})[»"]', re.IGNORECASE
)
_DISTANCE = re.compile(r"(?:^| )(\d{1,3})\s?км")


def draft_event(raw: str, ctx: AssistantContext) -> Entity:
    """Черновик события из фразы: {"kind": "event", "draft", "filled", "missing", "newSport"}."""
    now = dates.moment(ctx["now"])
    text = normalize(raw)
    parsed = parse_search(raw, ctx)
    scan = _scan_sports(raw, ctx["sports"])
    draft: Entity = {"description": capitalize(raw.strip()), "createdWithAssistant": True}
    filled: list[Entity] = []
    missing: list[Entity] = []
    new_sport: Entity | None = None

    sport = scan["sports"][0] if scan["sports"] else None
    if sport:
        draft["sportId"] = sport["id"]
        hit = next((h for h in scan["hits"] if h["sport"] is sport), None)
        filled.append(
            {
                "field": "sportId",
                "why": f"«{hit['term']}» значит «{sport['name']}»"
                if hit and normalize(hit["term"]) != normalize(sport["name"])
                else f"В тексте есть «{sport['name'].lower()}»",
            }
        )
    else:
        guess = _guess_new_sport(raw, scan)
        if guess:
            name = capitalize(guess)
            new_sport = {"name": name, "similar": suggest_sports(guess, ctx["sports"], 3)}
            draft["newSportName"] = name
            filled.append(
                {
                    "field": "newSportName",
                    "why": f"В каталоге нет «{name}». Похожие: {', '.join(s['name'] for s in new_sport['similar'])}. Выберите, если подходит"
                    if new_sport["similar"]
                    else f"В каталоге нет «{name}», будет новое направление",
                }
            )
        else:
            missing.append(
                {
                    "field": "sportId",
                    "question": "Чем будете заниматься?",
                    "options": [
                        {"label": s["name"], "value": s["id"]}
                        for s in [s for s in ctx["sports"] if s.get("popular") and not s.get("mergedInto")][
                            :5
                        ]
                    ],
                    "allowCustom": True,
                }
            )

    date = _extract_date(parsed, now)
    time = _extract_time(raw)
    if date and time:
        h, m = (int(x) for x in time.split(":"))
        draft["startsAt"] = clock.iso(date.replace(hour=h, minute=m, second=0, microsecond=0))
        filled.append({"field": "startsAt", "why": "Дата и время названы в тексте"})
    elif date:
        day_part_ = parsed["filters"].get("dayPart")
        hour = 19 if day_part_ == "evening" else 12 if day_part_ == "day" else 10
        draft["startsAt"] = clock.iso(date.replace(hour=hour, minute=0, second=0, microsecond=0))
        filled.append({"field": "startsAt", "why": "Дата из текста, время уточните"})
    if not date:
        weekend = parsed["filters"].get("when") == "weekend"
        today = dates.start_of_day(now)
        tomorrow = today + timedelta(days=1)
        sat = dates.weekend_bounds(now)[0] if weekend else _next_weekday(6, now)
        sun = sat + timedelta(days=1)
        options = [d for d in (sat, sun) if d >= today] if weekend else [tomorrow, sat, sun]
        h, minute = (int(x) for x in (time or "00:00").split(":"))
        missing.append(
            {
                "field": "date",
                "question": "В какой день выходных?" if weekend else "Когда встречаемся?",
                "options": [
                    {
                        "label": "Завтра" if d.date() == tomorrow.date() else _date_label(d),
                        "value": clock.iso(d.replace(hour=h, minute=minute) if time else d),
                    }
                    for d in options
                ],
                "allowCustom": True,
            }
        )
    if not time:
        part = parsed["filters"].get("dayPart")
        options_t = (
            ["08:00", "09:00", "10:00", "11:00"]
            if part == "morning"
            else ["18:00", "19:00", "19:30", "20:00"]
            if part == "evening"
            else ["10:00", "12:00", "18:00", "19:00"]
        )
        missing.append(
            {
                "field": "time",
                "question": "Во сколько начало?",
                "options": [{"label": t, "value": t} for t in options_t],
                "allowCustom": True,
            }
        )

    if REPEAT_RE.search(text) and draft.get("startsAt"):
        last = dates.moment(draft["startsAt"]) + timedelta(weeks=3)
        draft["repeatWeeklyUntil"] = clock.iso(dates.end_of_day(last))
        filled.append(
            {
                "field": "repeatWeeklyUntil",
                "why": "Встреча каждую неделю: поставили четыре встречи, срок можно продлить",
            }
        )

    places = _find_places(raw)
    primary = next((p for p in places if not p["meet"]), None)
    meet = next((p for p in places if p["meet"]), None)
    known = next((p for p in KNOWN_PLACES if p["re"].search(text)), None)
    address: str | None = None
    if primary and known:
        address = (
            known["address"] if _contained_in(primary["address"], known["address"]) else primary["address"]
        )
    elif primary:
        address = primary["address"]
    elif known:
        address = known["address"]
    if address and meet and not _contained_in(meet["address"], address):
        address = f"{meet['address']}, {address.split(',')[0]}"
    elif not address and meet:
        address = meet["address"]
    if address:
        district_id = known["districtId"] if known else parsed["filters"].get("districtId")
        draft["place"] = {"address": address, "districtId": district_id}
        if known:
            draft["place"].update({"lat": known["lat"], "lng": known["lng"]})
        filled.append(
            {
                "field": "place",
                "why": "Место узнали по названию, координаты взяли из справочника"
                if known
                else "Место взяли из текста, проверьте адрес",
            }
        )
    else:
        missing.append(
            {
                "field": "place",
                "question": "Где встречаемся?",
                "options": [{"label": p["address"], "value": p["address"]} for p in POPULAR_PLACES],
                "allowCustom": True,
            }
        )

    people = _extract_people(raw)
    if people["capacity"] is not None:
        draft["capacity"] = people["capacity"]
        filled.append(
            {
                "field": "capacity",
                "why": next((w for w in people["why"] if "мест" in w), "Лимит мест из текста"),
            }
        )
    if people["threshold"] is not None:
        draft["minParticipants"] = people["threshold"]
        filled.append({"field": "minParticipants", "why": people["why"][0]})

    if _RE_APPROVAL.search(text):
        draft["joinMode"] = "approval"
        filled.append({"field": "joinMode", "why": "В тексте сказано, что вы решаете, кого принять"})
    elif _RE_OPEN.search(text):
        draft["joinMode"] = "open"
        filled.append({"field": "joinMode", "why": "В тексте сказано, что приходить можно без подтверждения"})
    else:
        draft["joinMode"] = "open"
        filled.append(
            {"field": "joinMode", "why": "Условий отбора нет, поэтому свободная запись. Можно поменять"}
        )

    if NOT_FOR_BEGINNERS.search(text):
        draft["beginnersWelcome"] = False
        filled.append({"field": "beginnersWelcome", "why": "В тексте сказано, что новичков не берёте"})
    elif BEGINNERS_WELCOME.search(text):
        draft["beginnersWelcome"] = True
        draft["level"] = "any"
        filled.append({"field": "level", "why": "Новичкам можно: уровень любой, отметили «рады новичкам»"})
    elif BEGINNER.search(text):
        draft["beginnersWelcome"] = True
        draft["level"] = "beginner"
        filled.append({"field": "level", "why": "В тексте сказано про начинающих"})
    if draft.get("level") != "beginner" and EXPERIENCED.search(text):
        draft["level"] = "experienced"
        filled.append({"field": "level", "why": "В тексте сказано про опытных"})
    elif not draft.get("level") and AMATEUR.search(text):
        draft["level"] = "amateur"
        filled.append({"field": "level", "why": "В тексте сказано про любительский уровень"})

    price = _extract_price(raw)
    if price["price"]:
        draft["price"] = price["price"]
        filled.append({"field": "price", "why": price["why"]})

    bring = _extract_bring(raw, draft.get("sportId"))
    if bring["items"] or bring["note"]:
        draft["firstStep"] = {"bring": capitalize(", ".join(bring["items"])), "firstTimeNote": bring["note"]}
        filled.append(
            {
                "field": "firstStep",
                "why": "Что взять, нашли в тексте"
                if bring["items"]
                else "Инвентарь есть у организатора, брать ничего не нужно",
            }
        )

    named = _TITLE_NAMED.search(raw)
    sport_label = sport["name"] if sport else new_sport["name"] if new_sport else "Встреча"
    distance = _DISTANCE.search(text)
    if named:
        draft["title"] = named.group(1).strip()
        filled.append({"field": "title", "why": "Название вы назвали сами"})
    else:
        activity = _activity_title(raw, scan, new_sport["name"] if new_sport else None)
        known_where = _known_phrase(raw, known) if known else None
        where = (
            f" {primary['phrase']}"
            if primary
            else f" {known_where}"
            if known_where
            else f" — {known['address'].split(',')[0]}"
            if known
            else ""
        )
        noun = MEETING_NOUN.get(sport["id"]) if sport else None
        morning = bool(draft.get("startsAt") and time and int(time[:2]) < 12)
        label = (
            capitalize(f"{('утренняя ' if noun[1] == 'f' else 'утренний ') if morning else ''}{noun[0]}")
            if noun
            else sport_label
        )
        draft["title"] = (
            activity
            if activity is not None
            else f"{label}{f' {distance.group(1)} км' if distance else ''}{where}"
        )
        filled.append(
            {"field": "title", "why": "Название собрано из направления и места, его можно поменять"}
        )

    return {"kind": "event", "draft": draft, "filled": filled, "missing": missing[:3], "newSport": new_sport}


_RE_WEEKDAYS_ONLY = re.compile(r"будн|по будням|рабочие дни")
_AFTER_HOUR = re.compile(r"после (\d{1,2})(?::(\d{2}))?(?!\d)")
_RE_ORGANIZE = re.compile(r"соберу|организую|могу собрать|могу показать|научу|приглашаю|собираю")
_COMPANION_DAY_PART = {"morning": "утром", "day": "днём", "evening": "вечером"}


def draft_companion(raw: str, ctx: AssistantContext) -> Entity:
    """Черновик «Ищу компанию»: {"kind": "companion", "draft", "filled", "missing", "newSport"}."""
    text = normalize(raw)
    parsed = parse_search(raw, ctx)
    scan = _scan_sports(raw, ctx["sports"])
    draft: Entity = {"text": capitalize(raw.strip()), "createdWithAssistant": True}
    filled: list[Entity] = []
    missing: list[Entity] = []
    new_sport: Entity | None = None

    sport_id = scan["sports"][0]["id"] if scan["sports"] else None
    if sport_id:
        draft["sportId"] = sport_id
        filled.append({"field": "sportId", "why": "Направление названо в тексте"})
    else:
        guess = _guess_new_sport(raw, scan)
        if guess:
            new_sport = {"name": capitalize(guess), "similar": suggest_sports(guess, ctx["sports"], 3)}
            draft["newSportName"] = new_sport["name"]
            filled.append(
                {
                    "field": "newSportName",
                    "why": f"В каталоге нет «{new_sport['name']}», будет новое направление",
                }
            )
        else:
            missing.append(
                {
                    "field": "sportId",
                    "question": "Каким спортом хотите заниматься?",
                    "options": [
                        {"label": s["name"], "value": s["id"]}
                        for s in [s for s in ctx["sports"] if s.get("popular") and not s.get("mergedInto")][
                            :5
                        ]
                    ],
                    "allowCustom": True,
                }
            )

    when_parts: list[str] = []
    weekday = [label.lower() for pattern, _dow, label in WEEKDAYS if pattern.search(text)]
    if _RE_WEEKDAYS_ONLY.search(text):
        when_parts.append("будни")
    elif weekday:
        when_parts.append(" и ".join(weekday))
    elif parsed["filters"].get("when") == "weekend":
        when_parts.append("выходные")
    if parsed["filters"].get("dayPart"):
        when_parts.append(_COMPANION_DAY_PART[parsed["filters"]["dayPart"]])
    after = _AFTER_HOUR.search(_numberize(raw))
    if after:
        when_parts.append(f"после {after.group(1)}:{after.group(2) if after.group(2) is not None else '00'}")
    if when_parts:
        draft["when"] = capitalize(", ".join(when_parts))
        filled.append({"field": "when", "why": "Удобное время из текста"})
    else:
        missing.append(
            {
                "field": "when",
                "question": "Когда вам удобно?",
                "options": [
                    {"label": v, "value": v} for v in ["Будни вечером", "Выходные утром", "Выходные днём"]
                ],
                "allowCustom": True,
            }
        )

    if parsed["filters"].get("districtId"):
        draft["districtId"] = parsed["filters"]["districtId"]
        filled.append({"field": "districtId", "why": "Район назван в тексте"})
    else:
        missing.append(
            {
                "field": "districtId",
                "question": "В каком районе удобно?",
                "options": [{"label": d["name"], "value": d["id"]} for d in ctx["districts"][:4]],
                "allowCustom": False,
            }
        )

    if parsed["filters"].get("beginners"):
        draft["level"] = "beginner"
        filled.append({"field": "level", "why": "В тексте сказано, что вы начинаете"})
    elif parsed["filters"].get("level") in {"experienced", "amateur"}:
        draft["level"] = parsed["filters"]["level"]
        filled.append(
            {"field": "level", "why": f"Уровень из текста: {SKILL_LEVEL[parsed['filters']['level']].lower()}"}
        )
    draft["readiness"] = "organize" if _RE_ORGANIZE.search(text) else "join"
    filled.append(
        {
            "field": "readiness",
            "why": "Вы готовы собрать встречу сами"
            if draft["readiness"] == "organize"
            else "Вы ищете, к кому присоединиться",
        }
    )

    return {
        "kind": "companion",
        "draft": draft,
        "filled": filled,
        "missing": missing[:3],
        "newSport": new_sport,
    }


# Порядок важен: «школа единоборств … тренер» — это школа, «компания соседей» — инициативная группа.
ORG_TYPES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"федерац"), "federation"),
    (re.compile(r"(^| )школ[аыеу]( |$)|(^| )школа "), "school"),
    (re.compile(r"кружок|кружк|секци"), "circle"),
    (re.compile(r"(^| )клуб"), "club"),
    (re.compile(r"сосед|инициатив|сообществ|(^| )двор|просто компани|компания друзей"), "initiative"),
    (re.compile(r"тренер|авторск|индивидуальн"), "coach"),
    (re.compile(r"компани|(^| )ооо( |$)|(^| )ип( |$)|(^| )центр|студи"), "company"),
    # В4: владелец площадок
    (
        re.compile(
            r"спорткомплекс|стадион|манеж|бассейн|(^| )площадк|сдаём (зал|корт|поле)|сдаем (зал|корт|поле)"
        ),
        "venue",
    ),
]
ORG_TYPE_WORD = re.compile(
    r"(клуб|секция|школа|сообщество|кружок|центр|федерация|студия|команда)", re.IGNORECASE
)
_NOT_DIGIT = re.compile(r"\D")
_LEADING_8 = re.compile(r"^8")


def _normalize_phone(phone: str) -> str:
    digits = _LEADING_8.sub("7", _NOT_DIGIT.sub("", phone), count=1)
    if len(digits) != 11:
        return phone.strip()
    return f"+7 {digits[1:4]} {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"


_ORG_QUOTED = re.compile(r'((?:[А-Яа-яЁё-]+\s+){0,2})[«"]([^»"]{2,60})[»"]')
_ORG_NAMED = re.compile(
    r"(?:[Кк]луб|[Сс]екция|[Шш]кола|[Сс]ообщество|[Кк]ружок|[Цц]ентр)\s+([А-ЯЁ][^,.;!?]{1,40})"
)
_ORG_SELF = re.compile(r"^(мы|это|наш|наша)$", re.IGNORECASE)
_PHONE = re.compile(r"(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}")
_EMAIL = re.compile(r"[\w.-]+@[\w-]+\.[\w.]+")
_SOCIAL_LINK = re.compile(r"(?:vk\.com|t\.me|ok\.ru)\/[\w.-]+")
_SOCIAL_NICK = re.compile(r"(?:^|\s)(@[A-Za-z0-9_]{3,})")


def draft_organization(raw: str, ctx: AssistantContext) -> Entity:
    """Черновик заявки организации: {"kind": "organization", "draft", "filled", "missing", "newSport": None}."""
    text = normalize(raw)
    scan = _scan_sports(raw, ctx["sports"])
    parsed = parse_search(raw, ctx)
    draft: Entity = {
        "description": capitalize(raw.strip()),
        "city": "Красноярск",
        "createdWithAssistant": True,
    }
    filled: list[Entity] = []
    missing: list[Entity] = []

    quoted = _ORG_QUOTED.search(raw)
    named = _ORG_NAMED.search(raw)
    if quoted:
        before = [w for w in _WS_SPLIT.split(quoted.group(1).strip()) if w]
        type_at = next((i for i, w in enumerate(before) if ORG_TYPE_WORD.search(w)), -1)
        prefix = [w for w in before[max(0, type_at - 1) :] if not _ORG_SELF.search(w)] if type_at >= 0 else []
        draft["name"] = capitalize(f"{' '.join(prefix)} «{quoted.group(2).strip()}»".strip())
        filled.append({"field": "name", "why": "Название взяли из текста"})
    elif named:
        draft["name"] = capitalize(named.group(0).strip())
        filled.append({"field": "name", "why": "Название взяли из текста"})
    else:
        missing.append(
            {"field": "name", "question": "Как называется организация?", "options": [], "allowCustom": True}
        )
    type_ = next((t for t in ORG_TYPES if t[0].search(text)), None)
    draft["type"] = type_[1] if type_ else "club"
    filled.append(
        {"field": "type", "why": "Тип по слову в тексте" if type_ else "Тип не назван, поставили «клуб»"}
    )

    if scan["sports"]:
        draft["sportIds"] = [s["id"] for s in scan["sports"]]
        filled.append({"field": "sportIds", "why": "Направления названы в тексте"})
    else:
        missing.append(
            {
                "field": "sportIds",
                "question": "Какими направлениями занимаетесь?",
                "options": [
                    {"label": s["name"], "value": s["id"]}
                    for s in [s for s in ctx["sports"] if s.get("popular") and not s.get("mergedInto")][:6]
                ],
                "allowCustom": True,
            }
        )
    if parsed["filters"].get("districtId"):
        draft["districtId"] = parsed["filters"]["districtId"]
        filled.append({"field": "districtId", "why": "Район назван в тексте"})

    phone = _PHONE.search(raw)
    email = _EMAIL.search(raw)
    link = _SOCIAL_LINK.search(raw)
    nick = _SOCIAL_NICK.search(raw)
    social = link.group(0) if link else nick.group(1) if nick else ""
    draft["contacts"] = {
        "phone": _normalize_phone(phone.group(0)) if phone else "",
        "email": email.group(0) if email else "",
        "social": social,
    }
    if phone or email or social:
        filled.append({"field": "contacts", "why": "Контакты из текста"})
    else:
        missing.append(
            {"field": "contacts", "question": "Как с вами связаться?", "options": [], "allowCustom": True}
        )

    return {
        "kind": "organization",
        "draft": draft,
        "filled": filled,
        "missing": missing[:3],
        "newSport": None,
    }


# ---------- Подбор «почему вам подходит» ----------


def _user_point(user: Entity, districts: list[Entity]) -> Entity | None:
    home = user.get("home")
    if isinstance(home, dict):
        return home
    d = next((x for x in districts if x["id"] == user.get("districtId")), None)
    return {"lat": d["lat"], "lng": d["lng"]} if d else None


def _coordinates(point: Any) -> dict[str, float] | None:
    if not isinstance(point, dict):
        return None
    lat, lng = parse_number(point.get("lat")), parse_number(point.get("lng"))
    return None if lat is None or lng is None else {"lat": lat, "lng": lng}


def km_between(a: Any, b: Any) -> float | None:
    """Расстояние между точками в км; None, если у какой-то из них нет координат.

    Точки приходят и из тела запроса без проверки типа (адрес события, дом в профиле).
    """
    point_a, point_b = _coordinates(a), _coordinates(b)
    if point_a is None or point_b is None:
        return None
    return distance_km(point_a, point_b)


def _radius(user: Entity) -> float:
    """Радиус поиска из профиля; не задан — 0."""
    return parse_number(user.get("radiusKm")) or 0


def _favourite_day_part(parts: list[str]) -> str | None:
    """Привычное время суток: хотя бы два посещения и чаще, чем в любое другое время."""
    ranked = Counter(parts).most_common(2)
    if not ranked or ranked[0][1] < 2 or (len(ranked) > 1 and ranked[1][1] == ranked[0][1]):
        return None
    return ranked[0][0]


def _usual_weekend(weekends: list[bool]) -> bool | None:
    """True — обычно по выходным, False — в будни, None — привычки нет (меньше двух посещений или доля < 2/3)."""
    if len(weekends) < 2:
        return None
    on_weekend = len([w for w in weekends if w])
    if on_weekend * 3 >= len(weekends) * 2:
        return True
    if (len(weekends) - on_weekend) * 3 >= len(weekends) * 2:
        return False
    return None


LEVEL_ORDER = {"beginner": 0, "amateur": 1, "experienced": 2}


def _level_fits(user_level: str | None, event_level: str, beginners_welcome: bool) -> str | None:
    if not user_level:
        return "Рады новичкам" if beginners_welcome else None
    if event_level == "any":
        return f"Подходит вашему уровню «{SKILL_LEVEL[user_level].lower()}»"
    if user_level == "beginner" and (beginners_welcome or event_level == "beginner"):
        return "Рады новичкам, как вы"
    if LEVEL_ORDER.get(user_level) == LEVEL_ORDER.get(event_level):
        return f"Ваш уровень: {SKILL_LEVEL[user_level].lower()}"
    return None


_USUALLY = {
    "morning": "Утром, как вы обычно ходите",
    "day": "Днём, как вы обычно ходите",
    "evening": "Вечером, как вы обычно ходите",
}


SOON = timedelta(days=3)

# Веса взвешенного подбора (docs/features/recommendations.md).
W_INTEREST = 3
W_PAST_SPORT = 1.5
W_NEAR = 2
W_FAR = -1
W_LEVEL = 1
W_DAY_PART = 1
W_WEEK_PART = 0.5
W_ORGANIZER = 1.5
W_FRIENDS = 1.5
W_FAVORITE_SPORT = 0.5
W_SOON = 0.3
W_ALMOST = 0.3
W_FULL = -1.5
W_FREE = 0.3


def _match_now(ctx: MatchContext) -> datetime:
    """Текущий момент подбора."""
    return ctx["now"]


def _organizer_label(name: str) -> str:
    """«Шахматный клуб «Ладья»» → «Ладья» в кавычках; у человека — только имя."""
    quoted = re.search(r"«[^»]+»", name)
    return quoted.group(0) if quoted else name.split(" ", maxsplit=1)[0]


def explain_event(event: Entity, ctx: MatchContext) -> Entity:
    """Почему событие подходит человеку: {"reasons": до трёх самых весомых причин, "score": взвешенный счёт}.

    Причины идут по убыванию веса (при равном весе — в порядке правил); счёт — сумма всех весов, в том числе
    без причины (скоро, далеко, мест нет), округлённая до десятых.
    """
    user = ctx["user"]
    weighted: list[tuple[float, str]] = []
    total = 0.0

    def add(weight: float, reason: str | None = None) -> None:
        nonlocal total
        total += weight
        if reason:
            weighted.append((weight, reason))

    sport_id = event["sportId"]
    favorite_sport = sport_id in ctx["favoriteSportIds"]
    if sport_id in user["interests"]:
        add(W_INTEREST, "Ваше направление")
        if favorite_sport:
            add(W_FAVORITE_SPORT)
    elif sport_id in ctx["pastSportIds"]:
        add(W_PAST_SPORT, "Уже ходили на такие встречи")
        if favorite_sport:
            add(W_FAVORITE_SPORT)
    elif favorite_sport:
        add(W_FAVORITE_SPORT, "Похоже на ваше избранное")

    point = _user_point(user, ctx["districts"])
    radius = _radius(user)
    km = km_between(point, event["place"]) if radius > 0 else None
    if km is not None and km <= radius:
        add(W_NEAR * (1 - km / radius), f"Рядом: {format_distance(km)}")
    elif km is not None and km > 2 * radius:
        add(W_FAR)

    level = _level_fits(user["levels"].get(sport_id), event["level"], event["beginnersWelcome"])
    if level:
        add(W_LEVEL, level)

    fav = _favourite_day_part(ctx["pastDayParts"])
    if fav and day_part(event["startsAt"]) == fav:
        add(W_DAY_PART, _USUALLY[fav])
    usual_weekend = _usual_weekend(ctx["pastWeekends"])
    if usual_weekend is not None and is_weekend(event["startsAt"]) == usual_weekend:
        add(
            W_WEEK_PART,
            "По выходным, как вы обычно ходите" if usual_weekend else "В будни, как вы обычно ходите",
        )

    organizer = event["organizer"]
    known_organizer = ctx["pastOrganizers"].get(f"{organizer['kind']}:{organizer['id']}")
    if known_organizer:
        add(W_ORGANIZER, f"Знакомый организатор: {_organizer_label(known_organizer)}")

    facts = ctx["facts"](event)
    friends = [ctx["companions"][id_] for id_ in facts["going"] if id_ in ctx["companions"]]
    if friends:
        add(W_FRIENDS, f"Идут знакомые: {', '.join(friends[:2])}")

    starts = clock.parse(event["startsAt"])
    if starts is not None and timedelta(0) <= starts - _match_now(ctx) <= SOON:
        add(W_SOON)
    capacity = event.get("capacity")
    spots_left = facts["spotsLeft"]
    if capacity and spots_left == 0:
        add(W_FULL)
    elif (facts["toThreshold"] is not None and facts["toThreshold"] <= 2) or (
        capacity and spots_left is not None and (capacity - spots_left) * 10 >= capacity * 7
    ):
        add(W_ALMOST, "Почти собрались")

    if event["price"]["kind"] == "free":
        add(W_FREE, "Бесплатно")

    ordered = sorted(weighted, key=lambda x: -x[0])
    # «or 0.0»: маленький отрицательный счёт округляется до 0, а не до -0.0
    return {"reasons": [r for _w, r in ordered][:3], "score": round(total, 1) or 0.0}


# «Для вас»: не ниже этого счёта (слабое не показываем), в первых трёх — разные виды спорта,
# если замена уступает лидеру не больше чем на FOR_YOU_GAP.
FOR_YOU_MIN_SCORE = 3
FOR_YOU_DIVERSE_TOP = 3
FOR_YOU_GAP = 2


def _no_seats(v: Entity) -> int:
    return 1 if v.get("capacity") and v["counts"]["spotsLeft"] == 0 else 0


def for_you_order(views: list[Entity]) -> list[Entity]:
    """Подборка «Для вас» из карточек событий: фильтр по счёту, порядок по счёту, разнообразие первых трёх."""
    candidates = [
        v
        for v in views
        if v["matchScore"] is not None and v["matchScore"] >= FOR_YOU_MIN_SCORE and v["my"] is None
    ]
    rest = sorted(candidates, key=lambda v: (_no_seats(v), -v["matchScore"], clock.parse(v["startsAt"])))
    top: list[Entity] = []
    while rest and len(top) < FOR_YOU_DIVERSE_TOP:
        leader = rest[0]
        seen = {v["sportId"] for v in top}
        index = 0
        if leader["sportId"] in seen:
            index = next(
                (
                    i
                    for i, v in enumerate(rest)
                    if v["sportId"] not in seen
                    and _no_seats(v) <= _no_seats(leader)
                    and v["matchScore"] >= leader["matchScore"] - FOR_YOU_GAP
                ),
                0,
            )
        top.append(rest.pop(index))
    return top + rest


def explain_companion(c: Entity, author: Entity, ctx: MatchContext) -> Entity:
    """Почему объявление «Ищу компанию» подходит человеку: {"reasons", "score"}."""
    user = ctx["user"]
    reasons: list[str] = []
    score = 0
    if c["sportId"] in user["interests"]:
        score += 3
        reasons.append("Ваше направление")
    km = km_between(_user_point(user, ctx["districts"]), c.get("point"))
    if km is not None and km <= max(_radius(user), 3):
        score += 2
        reasons.append(
            "Тот же район"
            if c.get("districtId") and c["districtId"] == user.get("districtId")
            else f"Рядом: {format_distance(km)}"
        )
    my_level = user["levels"].get(c["sportId"])
    if my_level and my_level == c.get("level"):
        score += 1
        reasons.append(f"Тот же уровень: {SKILL_LEVEL[my_level].lower()}")
    if user.get("readiness") and user["readiness"] != c.get("readiness"):
        score += 1
        reasons.append(
            f"{author['name'].split(' ')[0]} готов собрать встречу"
            if c.get("readiness") == "organize"
            else "Человек ищет, к кому присоединиться"
        )
    return {"reasons": reasons[:3], "score": score}


def event_level_label(level: str) -> str:
    return EVENT_LEVEL[level]


# ---------- Предмодерация ----------

# Корни мата и оскорблений, сравниваются с началом слова (с частыми приставками).
OBSCENE: list[re.Pattern[str]] = [
    re.compile(r"^(?:за|на|вы|по|от|у|раз|до|при|пере|съ|подъ|въ|об)?[её]б(?!ук)"),
    re.compile(r"^(?:на|по|от|за|ни)?ху[йяеию](?!т)"),
    re.compile(r"^(?:рас|за|от|с|по|на|пере)?пизд"),
    re.compile(r"^бля(дь?|ть|ди|дский|дина)?$"),
    re.compile(r"^бляд"),
    re.compile(r"^сук(а|и|ой|ам|ами)$"),
    re.compile(r"^муд(ак|ил|оз)"),
    re.compile(r"^г[ао]ндон"),
    re.compile(r"^пид[оа]?р"),
    re.compile(r"^залуп"),
    re.compile(r"^шлюх"),
]
INSULTS: list[re.Pattern[str]] = [
    re.compile(r"^дур(а|ак|аки|ачье|ы|ой|ни|еха)$"),
    re.compile(r"^идиот"),
    re.compile(r"^дебил"),
    re.compile(r"^лузер"),
    re.compile(r"^урод"),
    re.compile(r"^коз[её]?л(ы|ов|ина)?$"),
    re.compile(r"^мраз"),
    re.compile(r"^сдохн"),
    re.compile(r"^заткн"),
    re.compile(r"^бездар"),
    re.compile(r"^позорищ"),
    re.compile(r"^безрук"),
    re.compile(r"^туп(ой|ая|ые|ого|ым|ица|ицы|орыл)$"),
    re.compile(r"^лох(и|а|ов|у)?$"),
    re.compile(r"^лошар"),
    re.compile(r"^чмо$"),
    re.compile(r"^неудачник"),
]
# Коммерческие слова — целиком, а не подстрокой: «реакцию», «выставка» и «купить воду» не реклама.
SALES: list[re.Pattern[str]] = [
    re.compile(r"^скидк"),
    re.compile(r"^прода(м|ю|ть|ется|ется|жа|жу|ем)$"),
    re.compile(r"^купи(те)?$"),
    re.compile(r"^абонемент"),
    re.compile(r"^подпиш(ись|итесь)$"),
    re.compile(r"^реклам"),
    re.compile(r"^акци[яиюй]$"),
    re.compile(r"^заработ"),
    re.compile(r"^казино$"),
    re.compile(r"^ставк[иау]?$|^ставок$"),
    re.compile(r"^промокод"),
    re.compile(r"^распродаж"),
    re.compile(r"^вложени"),
]
# Ссылки на карты — место встречи, а не реклама.
MAP_LINK = re.compile(
    r"(yandex\.\w+/maps|maps\.google|google\.\w+/maps|2gis\.|goo\.gl/maps|openstreetmap\.org)", re.IGNORECASE
)
LINK_RE = re.compile(
    r"(?:https?://|www\.)\S+|\bt\.me/\S+|\bvk\.com/\S+|\b[\w-]+\.(?:ru|com|example|net|org|рф)(?:/\S*)?",
    re.IGNORECASE,
)
URGENCY = re.compile(r"только сегодня|места заканчиваются|успей|спешите|осталось \d+ мест")
PRIVATE_CHAT = re.compile(r"пиши(те)? в личк|в личку|в лс( |$)|в директ|пишите в (телеграм|ватсап|whatsapp)")
_NOT_LETTER = re.compile(r"[^A-Za-zА-Яа-яЁё]")
_NOT_CAPITAL = re.compile(r"[^A-ZА-ЯЁ]")
_EXCLAIM = re.compile(r"!!!")
_EARNING = re.compile(r"^заработ|^вложени|^казино|^ставк")


def premoderate(raw: str) -> Entity:
    """Предмодерация текста: {"flag": "none" | "toxic" | "spam", "reason"}."""
    text = raw.strip()
    lower = normalize(text)
    words = [w for w in lower.split(" ") if w]

    obscene = [w for w in words if any(p.search(w) for p in OBSCENE)]
    if obscene:
        return {"flag": "toxic", "reason": "Похоже на грубость: нецензурные слова"}
    rude = [w for w in words if any(p.search(w) for p in INSULTS)]
    if rude:
        return {"flag": "toxic", "reason": f"Похоже на грубость: {', '.join(f'«{w}»' for w in rude[:2])}"}

    links = [m.group(0) for m in LINK_RE.finditer(text) if not MAP_LINK.search(m.group(0))]
    sales = [w for w in words if any(p.search(w) for p in SALES)]
    letters = _NOT_LETTER.sub("", text)
    caps = len(_NOT_CAPITAL.sub("", letters))
    shouting = len(letters) >= 12 and caps / len(letters) > 0.6
    exclaim = bool(_EXCLAIM.search(text))

    significant = [w for w in words if len(w) > 3 and w not in STOP_WORDS]
    top_word, top_count = (Counter(significant).most_common(1) or [("", 0)])[0]
    in_a_row = any(
        len(w) > 3 and i + 2 < len(words) and w == words[i + 1] and w == words[i + 2]
        for i, w in enumerate(words)
    )
    repeated = in_a_row or (top_count >= 3 and len(significant) >= 6 and top_count / len(significant) >= 0.3)
    same_links = len(links) >= 2 and len({link.lower() for link in links}) < len(links)
    private_chat = bool(PRIVATE_CHAT.search(lower))
    urgency = bool(URGENCY.search(lower))

    signals: list[str] = []
    if len(links) >= 2:
        signals.append(f"{len(links)} внешние ссылки")
    elif len(links) == 1 and (sales or private_chat or urgency):
        signals.append("внешняя ссылка")
    if sales and (links or exclaim or shouting or private_chat):
        signals.append(
            "обещание заработка" if any(_EARNING.search(w) for w in sales) else "реклама или продажа"
        )
    if private_chat and (links or sales):
        signals.append("призыв писать в личку")
    if urgency and (links or sales):
        signals.append("давление срочностью")
    if repeated:
        signals.append(
            "одинаковые ссылки"
            if same_links
            else "повторы подряд"
            if in_a_row
            else f"повторы слова «{top_word}»"
        )
    if shouting and (links or sales):
        signals.append("текст капсом")
    if signals:
        return {"flag": "spam", "reason": f"Похоже на спам: {', '.join(dict.fromkeys(signals))}"}
    return {"flag": "none", "reason": ""}


FRAUD: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"предоплат|оплата вперед|оплату вперед|оплатить заранее"), "просят предоплату"),
    (re.compile(r"перевод\S* на карту|на карту переводом|скиньте на карту"), "оплата переводом на карту"),
    (re.compile(r"после оплаты"), "документы или адрес только после оплаты"),
    (re.compile(r"адрес\S* (пока )?нет|без адреса"), "нет адреса"),
    (re.compile(r"скидк\S* (\d{2})|(\d{2}) ?%"), "нереально большая скидка"),
]
_LIKELY = re.compile(r"^Похоже на ")


def premoderate_organization(input_: Entity) -> Entity:
    """Предмодерация заявки организации: {"flag": "none" | "suspicious", "reason"}.

    Заявка может быть черновиком без проверки полей: чего нет или что не текст — считается пустым.
    """
    name = input_.get("name") if isinstance(input_.get("name"), str) else ""
    description = input_.get("description") if isinstance(input_.get("description"), str) else ""
    whole = f"{name} {description}"
    base = premoderate(whole)
    text = normalize(whole)
    raw = whole.lower().replace("ё", "е")
    reasons: list[str] = []
    if base["flag"] != "none":
        reasons.append(_LIKELY.sub("", base["reason"], count=1))
    for pattern, why in FRAUD:
        m = pattern.search(raw) or pattern.search(text)
        if not m:
            continue
        if why == "нереально большая скидка" and int(m.group(1) or m.group(2)) < 50:
            continue
        reasons.append(why)
    if len(description.strip()) < 40:
        reasons.append("в описании меньше 40 символов, непонятно, чем занимается организация")
    contacts = input_.get("contacts") if isinstance(input_.get("contacts"), dict) else {}
    if not contacts.get("phone") and not contacts.get("email"):
        reasons.append("нет телефона и почты")
    sales = any(any(p.search(w) for p in SALES) for w in normalize(description).split(" "))
    if sales:
        reasons.append("похоже на продажу, а не на совместные занятия")
    if not reasons:
        return {"flag": "none", "reason": ""}
    return {
        "flag": "suspicious",
        "reason": f"Стоит проверить внимательнее: {'; '.join(dict.fromkeys(reasons))}",
    }
