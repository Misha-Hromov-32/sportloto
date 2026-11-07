"""Даты по-русски и границы дней. Время показывается по поясу города, выбранного в шапке (`clock.local`)."""

from datetime import datetime, time, timedelta
from typing import Any

from app.domain import clock
from app.domain.lib.plural import WORDS, count

NB = " "

MONTHS = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
]
MONTHS_GENITIVE = [
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
# По номеру дня недели ISO: 1 — понедельник … 7 — воскресенье (индекс 0 не используется).
WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
WEEKDAYS_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def moment(value: str | datetime | None = None) -> datetime:
    """Момент в поясе отображения из строки ISO, `datetime` или текущий (None)."""
    if value is None:
        return clock.local(clock.now())
    parsed = clock.parse(value)
    if parsed is None:
        msg = f"Не дата: {value!r}"
        raise ValueError(msg)
    return clock.local(parsed)


def start_of_day(value: Any = None) -> datetime:
    """Местная полночь дня, в который попадает момент (в поясе отображения)."""
    local = moment(value)
    return datetime.combine(local.date(), time(), tzinfo=local.tzinfo)


def end_of_day(value: Any = None) -> datetime:
    """Последняя миллисекунда местного дня."""
    return start_of_day(value) + timedelta(days=1, milliseconds=-1)


def same_day(a: Any, b: Any) -> bool:
    return moment(a).date() == moment(b).date()


def day_month(value: Any) -> str:
    """«25 октября»."""
    local = moment(value)
    return f"{local.day} {MONTHS_GENITIVE[local.month - 1]}"


def weekday_name(value: Any) -> str:
    """«суббота»."""
    return WEEKDAYS[moment(value).isoweekday()]


def day_label(value: Any, now: Any = None) -> str:
    """«Сегодня», «Завтра», «Вчера» или день недели с заглавной буквы."""
    day = moment(value).date()
    today = moment(now).date()
    if day == today:
        return "Сегодня"
    if day == today + timedelta(days=1):
        return "Завтра"
    if day == today - timedelta(days=1):
        return "Вчера"
    return weekday_name(value).capitalize()


def _day_month_year(value: Any, now: Any) -> str:
    local = moment(value)
    same_year = local.year == moment(now).year
    return day_month(local) if same_year else f"{day_month(local)} {local.year}"


def format_event_date(value: Any, now: Any = None) -> str:
    """«Суббота, 25 октября, 10:00»; для ближайших дней — «Завтра, 25 октября, 10:00»."""
    return f"{day_label(value, now)}, {_day_month_year(value, now)}, {format_time(value)}"


def format_short_date(value: Any) -> str:
    """Для карточек: «Сб, 25 октября»."""
    return f"{WEEKDAYS_SHORT[moment(value).isoweekday()].capitalize()}, {day_month(value)}"


def format_time(value: Any) -> str:
    return f"{moment(value):%H:%M}"


def format_time_range(value: Any, duration_min: float) -> str:
    start = moment(value)
    return f"{start:%H:%M}–{start + timedelta(minutes=duration_min):%H:%M}"


def format_duration(minutes: int) -> str:
    if minutes < 60:
        return count(minutes, WORDS["minute"])
    h, m = divmod(minutes, 60)
    return f"{count(h, WORDS['hour'])} {count(m, WORDS['minute'])}" if m else count(h, WORDS["hour"])


def format_ago(value: Any, now: Any = None) -> str:
    """«5 минут назад», «вчера в 21:10», «12 октября в 09:00»."""
    then, current = moment(value), moment(now)
    minutes = int((current - then).total_seconds() // 60)
    if minutes < 1:
        return "только что"
    if minutes < 60:
        return f"{count(minutes, WORDS['minute'])} назад"
    if then.date() == current.date():
        return f"сегодня в{NB}{then:%H:%M}"
    if then.date() == current.date() - timedelta(days=1):
        return f"вчера в{NB}{then:%H:%M}"
    return f"{_day_month_year(then, current)} в{NB}{then:%H:%M}"


def format_day_month(value: Any) -> str:
    return day_month(value)


def is_weekend(value: Any) -> bool:
    return moment(value).isoweekday() in {6, 7}


def day_part(value: Any) -> str:
    """'morning' до 12, 'day' до 17, иначе 'evening' — по поясу отображения."""
    hour = moment(value).hour
    if hour < 12:
        return "morning"
    if hour < 17:
        return "day"
    return "evening"


def weekend_bounds(now: Any = None) -> tuple[datetime, datetime]:
    """Начало и конец ближайших выходных; в воскресенье — только сегодняшний день."""
    current = moment(now)
    dow = current.isoweekday()
    if dow == 7:
        return start_of_day(current), end_of_day(current)
    saturday = start_of_day(current + timedelta(days=6 - dow))
    return saturday, end_of_day(saturday + timedelta(days=1))
