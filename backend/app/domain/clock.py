"""Время доменных правил и пояс, в котором подписываются даты.

Пояс задаётся на время запроса: клиент присылает выбранный в шапке город в заголовке `X-City`.
Тесты и сценарии замораживают часы.

Даты в записях хранятся строками ISO в UTC («2026-10-19T03:00:00.000Z»); правила работают с `datetime`:
`parse` превращает строку в момент, `iso` — обратно, `local` переводит момент в пояс отображения.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import cache
from zoneinfo import ZoneInfo

DEFAULT_ZONE = "Asia/Krasnoyarsk"

_zone: ContextVar[str] = ContextVar("domain_display_zone", default=DEFAULT_ZONE)
# Заморозка для всего процесса: переменная контекста не была бы видна задачам, созданным до её установки.
_frozen: datetime | None = None


def now() -> datetime:
    """Текущий момент (UTC) с учётом заморозки часов."""
    return _frozen if _frozen is not None else datetime.now(UTC)


def set_frozen(moment: datetime | None) -> None:
    """Заморозить часы для всего процесса (тесты и сценарии); None — снова настоящее время."""
    global _frozen  # noqa: PLW0603
    _frozen = None if moment is None else moment.astimezone(UTC)


def display_zone() -> str:
    return _zone.get()


@contextmanager
def zone(name: str) -> Iterator[None]:
    token = _zone.set(name)
    try:
        yield
    finally:
        _zone.reset(token)


@cache
def zone_info(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def parse(value: object) -> datetime | None:
    """Строка ISO или `datetime` → момент в UTC; None, если это не дата.

    Строка без пояса — местное время пояса отображения; дата без времени — местная полночь.
    """
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value.strip():
        try:
            moment = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    else:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=zone_info(display_zone()))
    return moment.astimezone(UTC)


def iso(moment: datetime) -> str:
    """Момент → строка ISO в UTC с миллисекундами: «2026-10-19T03:00:00.000Z»."""
    moment = moment.astimezone(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def local(moment: datetime, zone_name: str | None = None) -> datetime:
    """Момент в поясе отображения (или в указанном поясе): для подписей, границ дня, дня недели."""
    return moment.astimezone(zone_info(zone_name or display_zone()))
