"""Фильтры и сортировка списков Refine, перевод местного времени, расстояния и цены — без базы."""

import pytest

from app.core.errors import AppError
from app.domain import clock, provider
from app.domain.lib import geo, money, timezone
from app.domain.lib.numbers import NBSP

ROWS = [
    {
        "id": "far",
        "n": 10,
        "name": "Ёлка",
        "place": {"lat": 56.0, "lng": 100.1},
        "at": "2026-10-19T03:00:00.000Z",
    },
    {
        "id": "evening",
        "n": 9,
        "name": "ель",
        "place": {"lat": 55.9, "lng": 92.9},
        "at": "2026-10-18T20:00:00.000Z",
    },
    {"id": "nowhere", "n": None, "name": "Арбуз", "place": None, "at": "2026-10-20T03:00:00.000Z"},
    {"id": "text", "n": 9, "name": "банан", "place": {"lat": "56.1", "lng": 92.5}, "at": None},
]


def ids(rows: list[dict]) -> list[str]:
    return [r["id"] for r in rows]


def test_range_filters_compare_numbers_as_numbers() -> None:
    # Как строки «100.1» меньше «93.7»: точка за пределами города попала бы в выдачу.
    city = [
        {"field": "place.lng", "operator": "gte", "value": 92.0026},
        {"field": "place.lng", "operator": "lte", "value": 93.7026},
    ]

    assert ids(provider.apply_rest(ROWS, city, [])) == ["evening", "text"]
    assert ids(provider.apply_rest(ROWS, [{"field": "n", "operator": "gt", "value": "9.5"}], [])) == ["far"]


def test_range_filters_compare_dates_as_moments_in_display_zone() -> None:
    since = [{"field": "at", "operator": "gte", "value": "2026-10-19"}]

    with clock.zone("Asia/Krasnoyarsk"):
        # Полночь 19 октября по Красноярску — 17:00 UTC 18 октября.
        assert ids(provider.apply_rest(ROWS, since, [])) == ["far", "evening", "nowhere"]


def test_sort_by_several_fields_keeps_rows_without_value_last() -> None:
    by_n_then_name = [{"field": "n", "order": "desc"}, {"field": "name", "order": "asc"}]

    assert ids(provider.sort_rows(ROWS, by_n_then_name)) == ["far", "text", "evening", "nowhere"]
    assert ids(provider.sort_rows(ROWS, [{"field": "name", "order": "asc"}])) == [
        "nowhere",
        "text",
        "far",
        "evening",
    ]
    assert ids(provider.sort_rows(ROWS, [{"field": "at", "order": "asc"}])) == [
        "evening",
        "far",
        "nowhere",
        "text",
    ]


def test_filters_must_be_a_list_of_conditions() -> None:
    with pytest.raises(AppError) as error:
        provider.get_list("events", {"field": "sportId"})  # type: ignore[arg-type]

    assert error.value.status == 422


def test_local_time_to_iso_rejects_impossible_dates() -> None:
    assert timezone.zoned_to_iso("2026-10-22", "19:00", "Asia/Krasnoyarsk") == "2026-10-22T12:00:00.000Z"
    assert timezone.zoned_to_iso("2026-10-32", "19:00", "Asia/Krasnoyarsk") is None
    assert timezone.zoned_to_iso("2026-10-22", "19", "Asia/Krasnoyarsk") is None
    assert timezone.zoned_parts("2026-10-19T03:00:00.000Z", "Europe/Moscow") == {
        "date": "2026-10-19",
        "time": "06:00",
        "weekday": 1,
    }


def test_distance_without_coordinates_is_unknown() -> None:
    assert geo.distance_km({"lat": 56.0, "lng": 92.8}, {"lat": "56.01", "lng": 92.85}) == pytest.approx(
        3.3, abs=0.05
    )
    assert geo.distance_km({"lat": 56.0, "lng": 92.8}, {"lat": None, "lng": 92.85}) is None
    assert [geo.format_distance(km) for km in (0.04, 0.83, 2.44, None)] == [
        f"100{NBSP}м",
        f"800{NBSP}м",
        f"2,4{NBSP}км",
        "расстояние неизвестно",
    ]


def test_price_without_amount_is_unknown_not_nan() -> None:
    assert money.price_summary({"kind": "fixed", "amount": "1500"}, 3, None)["main"] == f"1{NBSP}500{NBSP}₽"
    assert money.price_summary({"kind": "fixed"}, 3, None) == {
        "main": "Цена не указана",
        "details": [],
        "free": False,
        "perPerson": None,
    }
