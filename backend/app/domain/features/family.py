"""Н6. Семейный формат, облегчённо.

У события отметка «Можно с детьми» или «Для детей N–M лет». Взрослый записывает ребёнка (имя и возраст)
и отвечает за него; каждый ребёнок занимает место. На семейную встречу взрослый идёт сам и может взять
детей одной записью, на детское занятие место занимает только ребёнок, взрослый его сопровождает.
Возраст проверяется по событию.
"""

import copy
import re
from collections.abc import Callable
from typing import Any

from app.domain.errors import fail
from app.domain.features.participation_host import (
    ParticipationHost,
    input_text,
    my_participation,
)
from app.domain.lib.numbers import parse_number
from app.domain.lib.plural import count
from app.domain.routing import Route, route
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

YEARS = ("год", "года", "лет")
MAX_CHILDREN = 4
MAX_AGE = 17

_SPACES = re.compile(r"\s+")

# Отметка события: {"kind": "family" | "kids", "minAge", "maxAge"}.
# План записи с детьми: {"children": [{"name", "age"}], "adultSeat": bool, "seats": int}.


def _child_age(value: Any) -> int | None:
    """Возраст ребёнка: целое от 0 до MAX_AGE; иначе None."""
    n = parse_number(value)
    return n if isinstance(n, int) and 0 <= n <= MAX_AGE else None


def age_of(value: Any) -> int | None:
    """Граница возраста из формы события: None — не указана; неверная — ошибка по полю `family`."""
    if value is None or value == "":
        return None
    age = _child_age(value)
    if age is None:
        fail("validation", "Проверьте возраст детей", {"family": f"Возраст детей от 0 до {MAX_AGE} лет"})
    return age


def clean_family(value: Any) -> Entity | None:
    """Отметка события из формы; ошибки — по полю `family`."""
    if not isinstance(value, dict):
        return None
    raw = value
    if raw.get("kind") != "family" and raw.get("kind") != "kids":
        return None
    min_age = age_of(raw.get("minAge"))
    max_age = age_of(raw.get("maxAge"))
    if raw["kind"] == "kids" and (min_age is None or max_age is None):
        fail(
            "validation", "Укажите возраст детей", {"family": "Для детского занятия укажите возраст: от и до"}
        )
    if min_age is not None and max_age is not None and min_age > max_age:
        fail("validation", "Проверьте возраст детей", {"family": "«От» не может быть больше «до»"})
    return {"kind": raw["kind"], "minAge": min_age, "maxAge": max_age}


def family_patch(patch: dict[str, Any]) -> Entity:
    return {} if "family" not in patch else {"family": clean_family(patch["family"])}


def family_matches(e: Entity, filter_: str | None = None) -> bool:
    return not filter_ or (e.get("family") or {}).get("kind") == filter_


def ages_text(f: Entity) -> str:
    """«6–10 лет», «от 5 лет», «до 12 лет», пусто — без ограничения."""
    min_, max_ = f["minAge"], f["maxAge"]
    if min_ is not None and max_ is not None:
        return count(min_, YEARS) if min_ == max_ else f"{min_}–{max_} {YEARS[2]}"
    if min_ is not None:
        return f"от {count(min_, YEARS)}"
    if max_ is not None:
        return f"до {count(max_, YEARS)}"
    return ""


def seats_of(p: Entity) -> int:
    """Сколько мест занимает запись: взрослый (если идёт сам) и каждый ребёнок."""
    return (0 if p.get("adultSeat") is False else 1) + len(p.get("children") or [])


def seat_count(ps: list[Entity]) -> int:
    return sum(seats_of(p) if p["status"] == "confirmed" else 0 for p in ps)


def children_text(children: list[Entity]) -> str:
    return "; ".join(f"{c['name']}, {count(c['age'], YEARS)}" for c in children)


def clean_children(e: Entity, raw: Any) -> list[Entity]:
    """Список детей из запроса: имя и возраст, возраст подходит событию."""
    list_ = raw if isinstance(raw, list) else []
    if len(list_) > MAX_CHILDREN:
        fail(
            "validation",
            f"За одну запись можно не больше {MAX_CHILDREN} детей",
            {"children": "Слишком много детей"},
        )
    f = e.get("family")

    def clean(item: Any, i: int) -> Entity:
        fields = item if isinstance(item, dict) else {}
        name = _SPACES.sub(" ", input_text(fields.get("name"))).strip()[:40]
        age = _child_age(fields.get("age"))
        if len(name) < 2:
            fail(
                "validation", "Напишите имя ребёнка", {f"children.{i}.name": "Напишите имя, хотя бы 2 буквы"}
            )
        if age is None:
            fail(
                "validation",
                "Укажите возраст ребёнка",
                {f"children.{i}.age": f"Возраст от 0 до {MAX_AGE} лет"},
            )
        if f is not None and (
            (f.get("minAge") is not None and age < f["minAge"])
            or (f.get("maxAge") is not None and age > f["maxAge"])
        ):
            who = "Занятие для детей" if f["kind"] == "kids" else "Детей ждут"
            reason = f"{who} {ages_text(f)}, а {name} — {count(age, YEARS)}"
            fail("validation", reason, {f"children.{i}.age": reason})
        return {"name": name, "age": age}

    return [clean(item, i) for i, item in enumerate(list_)]


def plan_family(e: Entity, raw: Any, free: int | None) -> Entity | None:
    """Запись с детьми. None — обычная запись взрослого. На детское занятие без ребёнка не записывают.

    В лист ожидания семьи не ставим: места нужны сразу на всех.
    """
    has_children = isinstance(raw, list) and len(raw) > 0
    if not has_children:
        if (e.get("family") or {}).get("kind") == "kids":
            fail(
                "validation",
                "Это занятие для детей. Укажите имя и возраст ребёнка",
                {"children": "Добавьте ребёнка"},
            )
        return None
    if e.get("family") is None:
        fail("bad_state", "На эту встречу детей не записывают")
    children = clean_children(e, raw)
    adult_seat = e["family"]["kind"] != "kids"
    seats = (1 if adult_seat else 0) + len(children)
    if free is not None and free < seats:
        fail(
            "full",
            "Мест не осталось. Семьи в лист ожидания не записываем, посмотрите другие встречи"
            if free <= 0
            else f"Свободно {count(free, ('место', 'места', 'мест'))}, а нужно {seats}. Запишите меньше детей или выберите другую встречу",
        )
    return {"children": children, "adultSeat": adult_seat, "seats": seats}


def apply_family(p: Entity, plan: Entity | None) -> None:
    """Записать или убрать детей у записи; обычная запись остаётся без лишних полей."""
    if plan is not None:
        p["children"] = plan["children"]
        p["adultSeat"] = plan["adultSeat"]
    else:
        p.pop("children", None)
        p.pop("adultSeat", None)


def family_note(plan: Entity | None) -> str:
    """Подпись для уведомления организатору: « (с детьми: Миша, 8 лет)»."""
    if plan is None:
        return ""
    if plan["adultSeat"]:
        return f" (с детьми: {children_text(plan['children'])})"
    return f" (ребёнок: {children_text(plan['children'])})"


def set_children(host: ParticipationHost, actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    """Изменить список детей у действующей записи: добавить ещё одного или убрать."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы записать ребёнка")
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    if e.get("family") is None:
        fail("bad_state", "На эту встречу детей не записывают")
    if host.event_state(e) != "upcoming":
        fail("event_inactive", "Событие больше не принимает записи")
    mine = my_participation(host.db, user["id"], e["id"])
    if mine is None or mine["status"] not in ACTIVE_PARTICIPATION or mine["status"] == "waitlist":
        fail("no_participation", "Сначала запишитесь на встречу")
    children = clean_children(e, input_.get("children"))
    if e["family"]["kind"] == "kids" and not children:
        fail(
            "validation",
            "На детском занятии должен остаться хотя бы один ребёнок. Чтобы не идти, отмените запись",
            {"children": "Нужен хотя бы один ребёнок"},
        )
    before = host.confirmed_count(e)
    delta = len(children) - len(mine.get("children") or [])
    if mine["status"] == "confirmed" and delta > 0 and e["capacity"] is not None:
        free = host.event_view(None, e)["counts"]["spotsLeft"] or 0
        if free < delta:
            fail(
                "full",
                f"Свободно {count(free, ('место', 'места', 'мест'))}, а нужно {delta}"
                if free
                else "Свободных мест не осталось",
            )
    apply_family(
        mine,
        {"children": children, "adultSeat": e["family"]["kind"] != "kids", "seats": 0} if children else None,
    )
    host.notify(
        host.organizer_user_ids(e),
        "joined" if delta >= 0 else "left",
        "Записали ребёнка" if delta >= 0 else "Ребёнок не придёт",
        f"{user['name']} обновил запись на «{e['title']}»: {children_text(children)}."
        if children
        else f"{user['name']} придёт на «{e['title']}» без детей.",
        f"/events/{e['id']}/manage?tab=participants",
    )
    if mine["status"] == "confirmed":
        if delta < 0:
            host.promote_waitlist(e)
        host.after_count_change(e, before)
    host.commit(["events", "participations", "notifications", "messages"], [e["id"]])
    return host.event_details(user, e["id"])


def seed_family(
    data: dict[str, list[Entity]],
    at: Callable[[int, str], str],
    ago: Callable[[int], str],
) -> None:
    """Демо: две семейные встречи и детские шахматы; на шахматах уже двое детей со взрослыми."""

    def by_id(id_: str) -> Entity | None:
        return next((e for e in data["events"] if e["id"] == id_), None)

    def copy_(id_: str, base: Entity, patch: Entity) -> None:
        data["events"].append(
            {
                **copy.deepcopy(base),
                "id": id_,
                "changes": [],
                "series": None,
                "status": "published",
                "moderation": None,
                "cancelReason": "",
                "venueId": None,
                "createdAt": ago(5 * 24 * 60),
                "updatedAt": ago(5 * 24 * 60),
                **patch,
            }
        )

    def seat(event_id: str, user_id: str, extra: Entity, n: int) -> None:
        data["participations"].append(
            {
                "id": f"p-fam-{n}",
                "eventId": event_id,
                "userId": user_id,
                "status": "confirmed",
                "prevStatus": None,
                "note": "",
                "rejectReason": "",
                "source": "self",
                "createdAt": ago((30 - n) * 60),
                "decidedAt": ago((30 - n) * 60),
                **extra,
            }
        )

    chess = by_id("e-past-chess")
    if chess is not None:
        copy_(
            "e-kids-chess",
            chess,
            {
                "title": "Шахматы для детей 7–10 лет",
                "description": "Занятие для начинающих шахматистов: разбираем ходы фигур, решаем простые задачи и играем партии друг с другом. Родители ждут в холле клуба или занимаются рядом.",
                "startsAt": at(4, "11:00"),
                "durationMin": 90,
                "capacity": 10,
                "level": "beginner",
                "beginnersWelcome": True,
                "joinMode": "open",
                "price": {"kind": "free"},
                "firstStep": {
                    **chess["firstStep"],
                    "intensity": "low",
                    "bring": "Сменную обувь и тетрадь в клетку",
                    "age": "Дети 7–10 лет, взрослый сопровождает",
                    "firstTimeNote": "Если ребёнок ни разу не играл, это не страшно: начинаем с того, как ходят фигуры.",
                },
                "privateInfo": "Вход со двора, второй этаж. Телефон Ольги: +7 391 205-40-40.",
                "family": {"kind": "kids", "minAge": 7, "maxAge": 10},
            },
        )
        seat("e-kids-chess", "u-elena", {"adultSeat": False, "children": [{"name": "Маша", "age": 8}]}, 1)
        seat("e-kids-chess", "u-roman", {"adultSeat": False, "children": [{"name": "Тимофей", "age": 9}]}, 2)

    football = by_id("e-football-77")
    if football is not None:
        copy_(
            "e-family-football",
            football,
            {
                "title": "Семейный футбол: родители и дети",
                "description": "Играем смешанными командами: в каждой взрослые и дети. Мяч лёгкий, правила упрощённые, счёт не главное. Подходит тем, кто давно не играл.",
                "organizer": {"kind": "org", "id": "o-legends"},
                "createdBy": "u-roman",
                "startsAt": at(5, "11:00"),
                "durationMin": 90,
                "capacity": 24,
                "minParticipants": None,
                "level": "any",
                "beginnersWelcome": True,
                "joinMode": "open",
                "price": {"kind": "free"},
                "cancelPolicy": {"kind": "anytime"},
                "composition": "mixed",
                "firstStep": {
                    **football["firstStep"],
                    "intensity": "low",
                    "age": "Взрослые с детьми 6–14 лет",
                    "firstTimeNote": "Играем без жёстких подкатов. Дети младше шести могут болеть с трибуны.",
                },
                "privateInfo": "Встречаемся у южных ворот стадиона. Телефон Романа: +7 913 040-00-01.",
                "family": {"kind": "family", "minAge": 6, "maxAge": 14},
            },
        )
        seat("e-family-football", "u-oleg", {"children": [{"name": "Ваня", "age": 10}]}, 3)
        seat("e-family-football", "u-timur", {}, 4)

    walk = by_id("e-past-workout")
    if walk is not None:
        copy_(
            "e-family-walk",
            walk,
            {
                "title": "Семейная прогулка с палками по Академгородку",
                "description": "Спокойная прогулка на 4 км по лесной тропе с остановками. Покажем, как держать палки, лишние пары дадим. Можно с детьми и с колясками на широких участках.",
                "startsAt": at(3, "10:30"),
                "durationMin": 90,
                "capacity": 20,
                "sportId": "s-nordic",
                "level": "any",
                "beginnersWelcome": True,
                "price": {"kind": "free"},
                "firstStep": {
                    **walk["firstStep"],
                    "intensity": "low",
                    "bring": "Удобную обувь, воду",
                    "age": "Любой возраст, дети со взрослыми",
                    "firstTimeNote": "Идём в темпе самого медленного. На середине пути привал.",
                },
                "family": {"kind": "family", "minAge": None, "maxAge": None},
            },
        )
        seat("e-family-walk", "u-galina", {}, 5)
        seat("e-family-walk", "u-lyudmila", {"children": [{"name": "Соня", "age": 6}]}, 6)


def family_routes(host: Callable[[], ParticipationHost], actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("put", r"^/events/([^/]+)/children$", lambda p, b, _q: set_children(host(), actor(), p[0], b)),
    ]
