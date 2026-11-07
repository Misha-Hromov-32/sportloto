"""Расстояния. Точки — словари с ключами lat и lng."""

import math
from typing import Any

from app.domain.lib.numbers import NBSP, format_number, parse_number

EARTH_KM = 6371
KRASNOYARSK_CENTER = {"lat": 56.0106, "lng": 92.8526}
RADIUS_OPTIONS = (1, 3, 5, 10)


def _coord(point: Any, key: str) -> float | None:
    """Координата точки; строка с числом тоже подходит. None — координаты нет или это не число."""
    return parse_number(point.get(key)) if isinstance(point, dict) else None


def distance_km(a: dict[str, Any], b: dict[str, Any]) -> float | None:
    """Расстояние по большому кругу в километрах.

    Точки приходят и из тела запроса (адрес события, точка объявления, дом в профиле) без проверки типа.
    Если у точки нет числовых координат, расстояние неизвестно — None.
    """
    a_lat, a_lng, b_lat, b_lng = _coord(a, "lat"), _coord(a, "lng"), _coord(b, "lat"), _coord(b, "lng")
    if a_lat is None or a_lng is None or b_lat is None or b_lng is None:
        return None
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    # Погрешность округления может чуть вывести h за единицу у диаметрально противоположных точек.
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def format_distance(km: float | None) -> str:
    """«800 м», «2,4 км»."""
    if km is None:
        return "расстояние неизвестно"
    if km < 1:
        return f"{max(100, round(km * 10) * 100)}{NBSP}м"
    return f"{format_number(km, 1)}{NBSP}км"
