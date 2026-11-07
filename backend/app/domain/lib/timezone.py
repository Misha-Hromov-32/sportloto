"""Перевод между местным временем пояса и ISO.

Время встречи живёт в поясе места проведения: «пробежка в 07:30» — это 07:30 по Красноярску,
с какого бы устройства на неё ни смотрели.
"""

from datetime import UTC, datetime
from typing import TypedDict

from app.domain import clock
from app.domain.clock import zone_info

__all__ = ["ZonedParts", "zone_info", "zoned_parts", "zoned_to_iso"]

_EPOCH = datetime.fromtimestamp(0, UTC)


def zoned_to_iso(date: str, time: str, time_zone: str) -> str | None:
    """Местные дата («2026-10-22») и время («19:00») в поясе → момент в ISO; None, если дата или время неверные."""
    try:
        year, month, day = (int(part) for part in date.split("-"))
        hour, minute = (int(part) for part in time.split(":")[:2])
        local = datetime(year, month, day, hour, minute, tzinfo=zone_info(time_zone))
    except (AttributeError, TypeError, ValueError):
        return None
    return clock.iso(local)


class ZonedParts(TypedDict):
    date: str
    time: str
    weekday: int


def zoned_parts(iso: str | datetime, time_zone: str) -> ZonedParts:
    """Момент → местные дата, время и день недели (1 — пн … 7 — вс) в поясе.

    Неверная дата даёт начало эпохи: такой момент не совпадёт ни с одним днём и окном расписания.
    """
    local = clock.local(clock.parse(iso) or _EPOCH, time_zone)
    return {"date": f"{local:%Y-%m-%d}", "time": f"{local:%H:%M}", "weekday": local.isoweekday()}
