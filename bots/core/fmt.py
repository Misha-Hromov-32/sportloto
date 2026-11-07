"""Подписи для чата: города, даты по поясу города, цена, места, карточка встречи."""

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from bots.core import texts

CITIES: dict[str, dict[str, Any]] = {
    "krasnoyarsk": {"name": "Красноярск", "tz": "Asia/Krasnoyarsk", "lat": 56.0106, "lng": 92.8526},
    "moscow": {"name": "Москва", "tz": "Europe/Moscow", "lat": 55.7558, "lng": 37.6173},
    "bryansk": {"name": "Брянск", "tz": "Europe/Moscow", "lat": 53.2436, "lng": 34.3634},
}
DEFAULT_CITY = "krasnoyarsk"

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MONTHS = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
]
LEVELS = {
    "any": "любой уровень",
    "beginner": "для новичков",
    "amateur": "для любителей",
    "experienced": "для опытных",
}
SKILL = {"beginner": "новичок", "amateur": "любитель", "experienced": "опытный"}

SPORT_ICONS = [
    ("настольн", "🏓"),
    ("волейбол", "🏐"),
    ("футбол", "⚽"),
    ("баскетбол", "🏀"),
    ("стритбол", "🏀"),
    ("теннис", "🎾"),
    ("бадминтон", "🏸"),
    ("бег", "🏃"),
    ("пробеж", "🏃"),
    ("йог", "🧘"),
    ("плаван", "🏊"),
    ("вело", "🚴"),
    ("лыж", "⛷"),
    ("хоккей", "🏒"),
    ("шахмат", "♟"),
    ("ходьб", "🚶"),
    ("прогул", "🚶"),
    ("поход", "🥾"),
    ("скандинав", "🚶"),
]


def city(city_id: str | None) -> dict[str, Any]:
    return CITIES.get(city_id or "", CITIES[DEFAULT_CITY])


def zone(city_id: str | None) -> ZoneInfo:
    return ZoneInfo(city(city_id)["tz"])


def city_filters(city_id: str | None) -> list[dict[str, Any]]:
    """Встречи города — по координатам, как на сайте (`cityLocationFilters`)."""
    c = city(city_id)
    return [
        {"field": "place.lat", "operator": "gte", "value": c["lat"] - 0.65},
        {"field": "place.lat", "operator": "lte", "value": c["lat"] + 0.65},
        {"field": "place.lng", "operator": "gte", "value": c["lng"] - 0.85},
        {"field": "place.lng", "operator": "lte", "value": c["lng"] + 0.85},
    ]


def city_of_point(lat: float, lng: float) -> str | None:
    for cid, c in CITIES.items():
        if abs(lat - c["lat"]) <= 0.65 and abs(lng - c["lng"]) <= 0.85:
            return cid
    return None


def city_by_name(name: str | None) -> str | None:
    for cid, c in CITIES.items():
        if name and c["name"].lower() == name.strip().lower():
            return cid
    return None


def plural(n: int, forms: tuple[str, str, str]) -> str:
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def local(value: str, city_id: str | None) -> datetime:
    return parse_iso(value).astimezone(zone(city_id))


def day_label(d: datetime) -> str:
    return f"{WEEKDAYS[d.weekday()]}, {d.day} {MONTHS[d.month - 1]}"


def when(value: str, city_id: str | None, now: datetime | None = None) -> str:
    """«Чт, 22 октября · 19:30 · через 2 дня»."""
    d = local(value, city_id)
    now = (now or datetime.now(UTC)).astimezone(d.tzinfo)
    days = (d.date() - now.date()).days
    if d < now:
        rel = ""
    elif days == 0:
        rel = "сегодня"
    elif days == 1:
        rel = "завтра"
    elif days == 2:
        rel = "послезавтра"
    else:
        rel = f"через {days} {plural(days, ('день', 'дня', 'дней'))}"
    parts = [day_label(d), d.strftime("%H:%M")]
    if rel:
        parts.append(rel)
    return " · ".join(parts)


def short_when(value: str, city_id: str | None) -> str:
    d = local(value, city_id)
    return f"{WEEKDAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}, {d.strftime('%H:%M')}"


def duration(minutes: int) -> str:
    hours, rest = divmod(int(minutes), 60)
    if not hours:
        return f"{rest} мин"
    return f"{hours} ч {rest} мин" if rest else f"{hours} ч"


def ago(value: str, now: datetime | None = None) -> str:
    delta = (now or datetime.now(UTC)) - parse_iso(value)
    minutes = int(delta.total_seconds() // 60)
    if minutes < 1:
        return "только что"
    if minutes < 60:
        return f"{minutes} {plural(minutes, ('минуту', 'минуты', 'минут'))} назад"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} {plural(hours, ('час', 'часа', 'часов'))} назад"
    days = hours // 24
    return f"{days} {plural(days, ('день', 'дня', 'дней'))} назад"


def price(event: dict[str, Any]) -> str:
    p = event.get("price") or {}
    kind = p.get("kind")
    if kind == "free":
        return "бесплатно"
    if kind == "fixed":
        return f"{p.get('amount', 0)} ₽"
    if kind == "split":
        counts = event.get("counts") or {}
        people = max(counts.get("confirmed") or 0, event.get("minParticipants") or 0, 1)
        return f"≈{round((p.get('total') or 0) / people)} ₽, делим {p.get('total', 0)} ₽ на всех"
    return "цену уточните у организатора"


def seats(event: dict[str, Any]) -> str:
    counts = event.get("counts") or {}
    confirmed = counts.get("confirmed") or 0
    cap = event.get("capacity")
    mode = "по заявке" if event.get("joinMode") == "approval" else "свободная запись"
    if cap:
        left = counts.get("spotsLeft")
        free = "мест нет" if left == 0 else f"свободно {left if left is not None else cap - confirmed}"
        return f"{confirmed} из {cap} · {free} · {mode}"
    return f"{confirmed} {plural(confirmed, ('участник', 'участника', 'участников'))} · без лимита · {mode}"


def icon(event: dict[str, Any]) -> str:
    name = ((event.get("sport") or {}).get("name") or "").lower()
    for key, emoji in SPORT_ICONS:
        if key in name:
            return emoji
    return "🏅"


def my_status(event: dict[str, Any]) -> str:
    my = event.get("my") or {}
    status = my.get("status")
    if not status:
        return ""
    line = texts.STATUS.get(status, "")
    if status == "waitlist" and my.get("waitlistPosition"):
        line += f", место в очереди: {my['waitlistPosition']}"
    if my.get("offerUntil"):
        line = "Освободилось место — подтвердите его"
    return line


def card_text(event: dict[str, Any], city_id: str | None, why: list[str] | None = None) -> str:
    lines = [f"{icon(event)} {event.get('title', '')}"]
    if event.get("startsAt"):
        lines.append(when(event["startsAt"], city_id))
    place = event.get("place") or {}
    if place.get("address"):
        lines.append(f"📍 {place['address']}")
    lines.append(f"👥 {seats(event)}")
    level = LEVELS.get(event.get("level") or "any", "")
    lines.append(f"💳 {price(event)} · {level}")
    organizer = (event.get("organizerView") or {}).get("name")
    if organizer:
        lines.append(f"Организатор: {organizer}")
    reasons = why or event.get("matchReasons") or []
    if reasons:
        lines.append("Почему вам подходит: " + ", ".join(r[:1].lower() + r[1:] for r in reasons[:3]))
    state = event.get("state")
    if state == "cancelled":
        lines.append("Встреча отменена")
    elif state == "live":
        lines.append("Идёт сейчас")
    status = my_status(event)
    if status:
        lines.append(f"✅ {status}")
    return "\n".join(lines)


def event_id_from_link(link: str | None) -> str | None:
    found = re.match(r"^/events/([^/?#]+)", link or "")
    return found.group(1) if found else None


def normalize(text: str) -> str:
    t = text.lower().replace("ё", "е")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def next_weekday(now: datetime, weekday: int) -> datetime:
    days = (weekday - now.weekday()) % 7
    return now + timedelta(days=days)
