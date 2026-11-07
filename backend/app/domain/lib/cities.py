"""Города платформы и город точки на карте. Выбранный в шапке город приходит в заголовке `X-City`.

Список городов — коллекция `cities`, её правит администратор (раздел «Справочники»). Внутри транзакции
правила читают её из базы, вне транзакции (подписи дат по заголовку, поиск адресов) — копию после
последней транзакции, которая её читала. Пока базы нет или коллекция пуста — встроенный список.
"""

import copy
from typing import Any

from app.domain import store
from app.domain.lib.geo import distance_km

DEFAULT_RADIUS_KM = 35

# Начальный список: сид и запасной вариант. Радиус охватывает все районы, площадки и встречи демо-данных.
BUILTIN_CITIES: list[dict[str, Any]] = [
    {
        "id": "bryansk",
        "name": "Брянск",
        "nameIn": "Брянске",
        "region": "Брянская область",
        "timeZone": "Europe/Moscow",
        "center": {"lat": 53.2436, "lng": 34.3634},
        "radiusKm": 35,
        "isDefault": False,
        "hidden": False,
        "order": 1,
    },
    {
        "id": "krasnoyarsk",
        "name": "Красноярск",
        "nameIn": "Красноярске",
        "region": "Красноярский край",
        "timeZone": "Asia/Krasnoyarsk",
        "center": {"lat": 56.0106, "lng": 92.8526},
        "radiusKm": 35,
        "isDefault": True,
        "hidden": False,
        "order": 2,
    },
    {
        "id": "moscow",
        "name": "Москва",
        "nameIn": "Москве",
        "region": "Город федерального значения",
        "timeZone": "Europe/Moscow",
        "center": {"lat": 55.7558, "lng": 37.6173},
        "radiusKm": 45,
        "isDefault": False,
        "hidden": False,
        "order": 3,
    },
]

_saved: list[dict[str, Any]] | None = None


def _remember(rows: list[Any]) -> None:
    global _saved  # noqa: PLW0603
    _saved = copy.deepcopy(rows) if rows else None


store.watch("cities", _remember)


def builtin_cities() -> list[dict[str, Any]]:
    return copy.deepcopy(BUILTIN_CITIES)


def all_cities() -> list[dict[str, Any]]:
    """Все города, включая скрытые, по порядку показа."""
    db = store.current()
    rows: list[dict[str, Any]] | None = (db.cities or None) if db is not None else _saved
    return sorted(rows or BUILTIN_CITIES, key=lambda c: (c.get("order") or 0, c["name"]))


def visible_cities() -> list[dict[str, Any]]:
    """Города для выбора в шапке и в формах: без скрытых."""
    return [c for c in all_cities() if not c.get("hidden")]


def default_city() -> dict[str, Any]:
    cities = all_cities()
    return (
        next((c for c in cities if c.get("isDefault") and not c.get("hidden")), None)
        or next((c for c in cities if not c.get("hidden")), None)
        or BUILTIN_CITIES[1]
    )


def city_by_id(city_id: str | None) -> dict[str, Any] | None:
    return next((c for c in all_cities() if c["id"] == city_id), None) if city_id else None


def city_by_name(name: str | None) -> dict[str, Any] | None:
    return next((c for c in all_cities() if c["name"] == name), None) if name else None


def radius_km(city: dict[str, Any]) -> float:
    value = city.get("radiusKm")
    return float(value) if isinstance(value, int | float) and value > 0 else DEFAULT_RADIUS_KM


def point_in_city(point: dict[str, Any] | None, city: dict[str, Any]) -> bool:
    """Точка в границе города: круг радиуса `radiusKm` вокруг центра."""
    distance = distance_km(point, city["center"]) if isinstance(point, dict) else None
    return distance is not None and distance <= radius_km(city)


def city_of_point(point: dict[str, Any] | None) -> dict[str, Any] | None:
    """Город, в котором находится точка (ближайший центр, если круги пересекаются); None — вне городов."""
    if not isinstance(point, dict) or not all(
        isinstance(point.get(key), int | float) and not isinstance(point.get(key), bool)
        for key in ("lat", "lng")
    ):
        return None
    inside = [(distance_km(point, c["center"]) or 0.0, c) for c in all_cities() if point_in_city(point, c)]
    return min(inside, key=lambda pair: pair[0])[1] if inside else None


def city_of_place(place: dict[str, Any] | None) -> dict[str, Any]:
    """Город события: по точке на карте; без точки — город по умолчанию."""
    return city_of_point(place) or default_city()
