"""Демо-данные: здесь — инварианты для базы."""

import re

from app.domain import clock, seed
from app.domain.schema import COLLECTIONS
from app.domain.store import base36

NOW = clock.parse("2026-10-19T03:00:00.000Z")


def rows(data: dict, path: str) -> list:
    value = data
    for part in path.split("."):
        value = (value or {}).get(part)
    return value or []


def test_record_ids_are_unique() -> None:
    data = seed.build_seed(NOW)

    for c in COLLECTIONS.values():
        if c.key is None:
            continue
        ids = [r[c.key] for r in rows(data, c.path)]
        assert len(ids) == len(set(ids)), c.path


def test_new_ids_never_repeat_decimal_ids_of_demo_data() -> None:
    data = seed.build_seed(NOW)
    decimal = [
        int(m.group(1))
        for c in COLLECTIONS.values()
        for r in rows(data, c.path)
        if isinstance(r, dict) and (m := re.fullmatch(r"[a-z]+-(\d+)", str(r.get("id"))))
    ]

    # Новый номер — base36 от счётчика: «p-100» получился бы при счётчике 1296 и совпал бы с демо-записью.
    assert data["seq"] > int(str(max(decimal)), 36)
    assert base36(data["seq"] + 1) == "7pt"


def test_seed_is_deterministic_and_not_shared() -> None:
    first = seed.build_seed(NOW)
    first["users"][0]["name"] = "Испорчено"

    assert seed.build_seed(NOW) != first
    assert seed.build_seed(NOW) == seed.build_seed(NOW)
