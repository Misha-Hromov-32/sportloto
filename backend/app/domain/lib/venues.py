"""Площадки: подписи и расчёт окон расписания.

Окна считаются по местному времени площадки (`timeZone`), а хранятся моментами ISO в UTC.
"""

from datetime import date, datetime, time, timedelta
from typing import Any

from app.domain import clock
from app.domain.lib.dates import MONTHS_GENITIVE, WEEKDAYS_SHORT
from app.domain.lib.numbers import NBSP, format_number

VENUE_KIND = {
    "hall": "Спортзал",
    "field": "Поле",
    "court": "Корт",
    "pool": "Бассейн",
    "ice": "Каток",
    "studio": "Студия",
    "yard": "Дворовая площадка",
    "park": "Парк",
}

VENUE_FEATURE = {
    "ramp": {"label": "Пандус", "short": "Пандус", "access": True},
    "elevator": {"label": "Лифт", "short": "Лифт", "access": True},
    "accessibleToilet": {"label": "Туалет для маломобильных", "short": "Доступный туалет", "access": True},
    "accessibleParking": {
        "label": "Парковка для маломобильных",
        "short": "Доступная парковка",
        "access": True,
    },
    "lockerRoom": {"label": "Раздевалка", "short": "Раздевалка", "access": False},
    "shower": {"label": "Душ", "short": "Душ", "access": False},
    "lighting": {"label": "Освещение вечером", "short": "Освещение", "access": False},
}

VENUE_FEATURES = list(VENUE_FEATURE)
ACCESS_FEATURES = [f for f in VENUE_FEATURES if VENUE_FEATURE[f]["access"]]

ACCESS_EXTRA = {
    "escort": {"label": "Есть сопровождающий", "hint": "Встретит у входа и поможет на месте"},
    "adaptiveGear": {"label": "Адаптивный инвентарь", "hint": "Есть снаряжение для людей с инвалидностью"},
}

ACCESS_NEED = {
    "ramp": "Пандус",
    "elevator": "Лифт",
    "accessibleToilet": "Доступный туалет",
    "escort": "Сопровождение",
}

ACCESS_NEEDS = list(ACCESS_NEED)

# Окна расписания — по 2 часа от открытия до закрытия.
SLOT_MIN = 120
SLOT = timedelta(minutes=SLOT_MIN)
# Расписание показывается и ведётся на две недели вперёд.
SCHEDULE_DAYS = 14
# С этого часа действует вечерняя цена.
PEAK_FROM = 18

_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def _to_minutes(hhmm: str) -> int:
    hours, _, minutes = hhmm.partition(":")
    return int(hours) * 60 + int(minutes or 0)


def _to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def venue_moment(iso: str, time_zone: str) -> datetime:
    """Момент ISO → местное время площадки."""
    moment = clock.parse(iso)
    if moment is None:
        msg = f"Не дата: {iso!r}"
        raise ValueError(msg)
    return clock.local(moment, time_zone)


def _local_iso(day: str, hhmm: str, time_zone: str) -> str:
    """Местные дата («2026-10-22») и время («19:00») площадки → момент ISO."""
    local = datetime.combine(date.fromisoformat(day), time.fromisoformat(hhmm), clock.zone_info(time_zone))
    return clock.iso(local)


def slot_times(hours: dict[str, str]) -> list[str]:
    """Начала окон дня по местному времени площадки: «08:00», «10:00»…"""
    open_, close = _to_minutes(hours["open"]), _to_minutes(hours["close"])
    return [_to_hhmm(t) for t in range(open_, close - SLOT_MIN + 1, SLOT_MIN)]


def local_date(now: datetime, time_zone: str, offset: int = 0) -> str:
    """Местная дата площадки через `offset` дней от момента `now`."""
    return (clock.local(now, time_zone).date() + timedelta(days=offset)).isoformat()


def slot_starts(venue: dict[str, Any], day: str) -> list[str]:
    """Начала окон местного дня площадки моментами ISO."""
    return [_local_iso(day, t, venue["timeZone"]) for t in slot_times(venue["hours"])]


def is_slot_start(venue: dict[str, Any], iso: str) -> bool:
    """Окно действительно есть в расписании площадки: начинается на границе и в часы работы."""
    moment = clock.parse(iso)
    if moment is None:
        return False
    local = clock.local(moment, venue["timeZone"])
    return local.second == local.microsecond == 0 and f"{local:%H:%M}" in slot_times(venue["hours"])


def base_price(venue: dict[str, Any], iso: str) -> float:
    if venue.get("peakPricePerHour") is None:
        return venue["pricePerHour"]
    local = venue_moment(iso, venue["timeZone"])
    peak = local.isoweekday() >= 6 or local.hour >= PEAK_FROM
    return venue["peakPricePerHour"] if peak else venue["pricePerHour"]


def slot_override(venue: dict[str, Any], iso: str) -> dict[str, Any] | None:
    return next((s for s in venue["slots"] if s["startsAt"] == iso), None)


def venue_day_label(iso: str, time_zone: str) -> str:
    """«сб, 25 октября» по местному времени площадки."""
    local = venue_moment(iso, time_zone)
    return f"{WEEKDAYS_SHORT[local.isoweekday()]}, {local.day} {MONTHS_GENITIVE[local.month - 1]}"


def _time_range(w: dict[str, str], time_zone: str) -> str:
    return f"{venue_time(w['startsAt'], time_zone)}–{venue_time(w['endsAt'], time_zone)}"


def window_label(w: dict[str, str], time_zone: str) -> str:
    """«сб, 25 октября, 10:00–12:00»."""
    return f"{venue_day_label(w['startsAt'], time_zone)}, {_time_range(w, time_zone)}"


def hour_price(price: float) -> str:
    """Цена за час словами: «Бесплатно», «1 500 ₽ в час»."""
    if price <= 0:
        return "Бесплатно"
    return f"{format_number(price)}{NBSP}₽ в час"


def updated_label(days: int) -> str:
    """Обновлено владельцем: «сегодня», «вчера», «5 дней назад»."""
    if days <= 0:
        return "Обновлено владельцем сегодня"
    if days == 1:
        return "Обновлено владельцем вчера"
    mod10, mod100 = days % 10, days % 100
    if mod10 == 1 and mod100 != 11:
        word = "день"
    elif 2 <= mod10 <= 4 and (mod100 < 12 or mod100 > 14):
        word = "дня"
    else:
        word = "дней"
    return f"Обновлено владельцем {days} {word} назад"


def window_short(w: dict[str, str], time_zone: str, now: datetime | None = None) -> str:
    """«сегодня, 18:00–22:00», «завтра, 10:00–12:00», «сб, 25 октября, 10:00–12:00»."""
    now = clock.now() if now is None else now
    day = venue_moment(w["startsAt"], time_zone).date().isoformat()
    if day == local_date(now, time_zone):
        return f"сегодня, {_time_range(w, time_zone)}"
    if day == local_date(now, time_zone, 1):
        return f"завтра, {_time_range(w, time_zone)}"
    return window_label(w, time_zone)


def venue_time(iso: str, time_zone: str) -> str:
    """Местное время площадки: «18:00»."""
    return f"{venue_moment(iso, time_zone):%H:%M}"


def schedule_day_name(day: str, time_zone: str, now: datetime | None = None) -> str:
    """Подпись дня в расписании: «Сегодня», «Завтра», «Сб»."""
    now = clock.now() if now is None else now
    if day == local_date(now, time_zone):
        return "Сегодня"
    if day == local_date(now, time_zone, 1):
        return "Завтра"
    return WEEKDAYS_SHORT[date.fromisoformat(day).isoweekday()].capitalize()


def schedule_day_date(day: str) -> str:
    """Номер дня и месяц: «25 окт»."""
    parsed = date.fromisoformat(day)
    return f"{parsed.day} {_MONTHS_SHORT[parsed.month - 1]}"


def venue_price_line(v: dict[str, Any]) -> str:
    """«1 500 ₽ в час, вечером и в выходные 2 000 ₽»."""
    peak = v.get("peakPricePerHour")
    if v["pricePerHour"] <= 0 and not peak:
        return "Бесплатно"
    base = hour_price(v["pricePerHour"])
    if peak is None or peak == v["pricePerHour"]:
        return base
    return f"{base}, вечером и в выходные {format_number(peak)}{NBSP}₽"
