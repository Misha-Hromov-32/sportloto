"""В7. Фильтр состава.

Организатор собирает встречу только для женщин, только для мужчин или для всех. Пол человек
указывает в профиле добровольно; без него на встречу с ограничением записаться нельзя,
но и угадывать пол платформа не пытается.
"""

from typing import Any

from app.domain.lib.labels import COMPOSITION
from app.domain.types import Entity

COMPOSITIONS = ["mixed", "women", "men"]

REQUIRED = {"women": "female", "men": "male"}

FOR_WHOM = {
    "women": "только для женщин",
    "men": "только для мужчин",
}


def composition_of(e: Entity) -> str:
    composition = e.get("composition")
    return composition if composition is not None else "mixed"


def clean_composition(value: Any) -> str:
    return value if isinstance(value, str) and value in COMPOSITIONS else "mixed"


def clean_gender(value: Any) -> str | None:
    return value if value in ("female", "male") else None


def composition_block(user: Entity, e: Entity) -> dict[str, str] | None:
    """Почему человеку нельзя на эту встречу по составу; None — можно."""
    c = composition_of(e)
    if c == "mixed":
        return None
    gender = user.get("gender")
    if not gender:
        return {
            "code": "gender_required",
            "reason": f"Встреча {FOR_WHOM[c]}. Чтобы записаться, укажите пол в профиле",
        }
    if gender != REQUIRED[c]:
        return {"code": "composition_mismatch", "reason": f"Организатор собирает эту встречу {FOR_WHOM[c]}"}
    return None


def composition_label(c: str) -> str:
    return COMPOSITION[c]["label"].lower()


def seed_composition(users: list[Entity], events: list[Entity]) -> None:
    """Демо: женские и мужская встречи, пол у тех, кто на них ходит. У Петра Ивановича пол не указан."""
    female = ["u-anna", "u-olga", "u-elena", "u-irina", "u-alina", "u-ksenia", "u-sofia", "u-galina"]
    male = ["u-dmitry", "u-oleg", "u-roman", "u-timur", "u-maxim", "u-konstantin", "u-igor"]
    for u in users:
        if u["id"] in female:
            u["gender"] = "female"
        elif u["id"] in male:
            u["gender"] = "male"
        elif u.get("gender") is None:
            u["gender"] = None

    def set_(id_: str, c: str) -> None:
        e = next((x for x in events if x["id"] == id_), None)
        if e is not None:
            e["composition"] = c

    set_("e-yoga-embankment", "women")
    set_("e-run-girls", "women")
    set_("e-hockey", "men")
