"""Справочники в админке: города, районы, каталог направлений и разделы, правила площадки.

Всё меняет только администратор, каждое действие — в журнале. Удалить можно только то, на что
ничего не ссылается: город без встреч и районов, район без встреч, площадок, людей и объявлений,
правило, по которому никого не снимали. Остальное скрывается: в выборе не видно, старые записи
показываются как раньше.

Новая версия демо-данных эти записи не перезаписывает (provider.REFERENCE_COLLECTIONS).
"""

import re
from collections import Counter
from collections.abc import Iterator
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.domain import bus, clock, store
from app.domain.errors import fail
from app.domain.lib import cities as city_lib
from app.domain.lib.geo import distance_km
from app.domain.lib.numbers import parse_number
from app.domain.lib.plural import count
from app.domain.lib.text import normalize
from app.domain.routing import Route, route
from app.domain.schema import COLLECTIONS
from app.domain.types import Entity

# ruff: noqa: SLF001  доменные помощники Domain: проверка прав, журнал, живые обновления

Actor = Entity | None

_SPACES = re.compile(r"\s+")
_CITY_ID = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
_ICON = re.compile(r"^[A-Za-z][A-Za-z0-9]{1,39}$")
_FIELD_KEY = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{0,31}$")
_MIN_RADIUS_KM, _MAX_RADIUS_KM = 3, 150

_TRANSLIT = dict(
    zip(
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
        [
            "a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p",
            "r", "s", "t", "u", "f", "h", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya",
        ],
        strict=True,
    )
)  # fmt: skip

# Где район может быть указан: из-за этих записей район нельзя удалить. В остальных коллекциях
# (журнал спроса, черновики импорта) ссылка при удалении просто обнуляется.
_DISTRICT_BLOCKERS = {
    "events": ("встреча", "встречи", "встреч"),
    "venues": ("площадка", "площадки", "площадок"),
    "users": ("человек", "человека", "человек"),
    "companions": ("объявление", "объявления", "объявлений"),
    "organizations": ("клуб", "клуба", "клубов"),
    "inventory.shelf": ("вещь на полке", "вещи на полке", "вещей на полке"),
}
_CITY_PARTS = {
    "events": ("встреча", "встречи", "встреч"),
    "districts": ("район", "района", "районов"),
    "venues": ("площадка", "площадки", "площадок"),
    "users": ("человек", "человека", "человек"),
    "organizations": ("клуб", "клуба", "клубов"),
}
_RULE_PARTS = {
    "events": ("встреча", "встречи", "встреч"),
    "messages": ("сообщение", "сообщения", "сообщений"),
    "audit": ("запись журнала", "записи журнала", "записей журнала"),
    "reports": ("жалоба", "жалобы", "жалоб"),
}


def _d() -> Any:
    from app.domain import core  # noqa: PLC0415  core подключает модули функций при загрузке

    return core.domain


def _db() -> store.Database:
    return store.data()


def _admin(actor: Actor) -> Entity:
    return _d()._require_admin(actor)


def _audit(admin: Entity, action: str, kind: str, id_: str, title: str, reason: str = "") -> None:
    _d()._audit(admin, action, kind, id_, title, reason)


def _changed(resources: list[str], ids: list[str], type_: str = "updated") -> None:
    bus.publish([*resources, "audit", "admin"], ids, type_)


# ---------- Проверка полей ----------


def _line(value: Any, max_: int) -> str:
    return _SPACES.sub(" ", value).strip()[:max_] if isinstance(value, str) else ""


def _text_block(value: Any, max_: int) -> str:
    return value.strip()[:max_] if isinstance(value, str) else ""


def _required(value: Any, field: str, label: str, min_: int = 2, max_: int = 60) -> str:
    text = _line(value, max_ + 1)
    if len(text) < min_:
        fail("validation", f"Укажите {label}", {field: f"Укажите {label}"})
    if len(text) > max_:
        fail(
            "validation", f"Слишком длинно: не больше {max_} символов", {field: f"Не больше {max_} символов"}
        )
    return text


def _flag(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        fail("validation", "Ожидается «да» или «нет»", {field: "Ожидается да или нет"})
    return value


def _number(value: Any, field: str, message: str) -> float:
    number = parse_number(value)
    if number is None:
        fail("validation", message, {field: message})
    return float(number)


def _point(value: Any, field: str = "center") -> dict[str, float]:
    message = "Отметьте точку на карте"
    if not isinstance(value, dict):
        fail("validation", message, {field: message})
    lat = _number(value.get("lat"), field, message)
    lng = _number(value.get("lng"), field, message)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        fail("validation", "Такой точки на карте нет", {field: "Такой точки на карте нет"})
    return {"lat": round(lat, 6), "lng": round(lng, 6)}


def _words(value: Any, field: str, max_items: int = 30) -> list[str]:
    """Синонимы для поиска: строки по одной, без повторов и пустых, в нижнем регистре."""
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        fail("validation", "Перечислите слова списком", {field: "Ожидается список слов"})
    out = list(dict.fromkeys(w for w in (_line(x, 40).lower() for x in value) if w))
    if len(out) > max_items:
        fail("validation", f"Не больше {max_items} слов", {field: f"Не больше {max_items} слов"})
    return out


def _fields(value: Any) -> list[Entity]:
    """Поля карточки встречи: `{ key, label, type: select|text, options?, placeholder? }`."""
    if value is None:
        return []
    message = "Поля карточки заданы неверно"
    if not isinstance(value, list) or len(value) > 5:
        fail("validation", message, {"fields": "Не больше пяти полей"})
    out: list[Entity] = []
    keys: set[str] = set()
    for raw in value:
        if not isinstance(raw, dict):
            fail("validation", message, {"fields": message})
        label = _required(raw.get("label"), "fields", "название поля", 2, 40)
        key = raw.get("key") if isinstance(raw.get("key"), str) else ""
        if not _FIELD_KEY.match(key):
            key = f"f{len(out) + 1}"
        if key in keys:
            fail("validation", "Два поля с одинаковым ключом", {"fields": "Повторяется ключ поля"})
        keys.add(key)
        kind = raw.get("type")
        if kind not in {"select", "text"}:
            fail("validation", message, {"fields": "Тип поля: выбор из списка или текст"})
        field: Entity = {"key": key, "label": label, "type": kind}
        if kind == "select":
            raw_options = raw.get("options") if isinstance(raw.get("options"), list) else []
            options = list(dict.fromkeys(_line(x, 40) for x in raw_options if _line(x, 40)))
            if not options:
                fail("validation", f"У поля «{label}» нет вариантов", {"fields": "Добавьте варианты"})
            field["options"] = options[:12]
        elif _line(raw.get("placeholder"), 60):
            field["placeholder"] = _line(raw.get("placeholder"), 60)
        out.append(field)
    return out


def _usage_text(counts: dict[str, int], parts: dict[str, tuple[str, str, str]]) -> str:
    return ", ".join(count(n, parts[path]) for path, n in counts.items() if n and path in parts)


def _views(counts: dict[str, int], parts: dict[str, tuple[str, str, str]]) -> list[Entity]:
    return [
        {"kind": path, "count": n, "label": count(n, parts[path])}
        for path, n in counts.items()
        if n and path in parts
    ]


def _walk(value: Any, key: str) -> Iterator[tuple[dict[str, Any], str]]:
    """Все места внутри записи, где лежит поле `key`: (словарь, имя поля)."""
    if isinstance(value, dict):
        for k, v in value.items():
            if k == key:
                yield value, k
            elif isinstance(v, dict | list):
                yield from _walk(v, key)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item, key)


def _scan(
    key: str, id_: str, skip: frozenset[str] = frozenset()
) -> dict[str, list[tuple[dict[str, Any], str]]]:
    """Ссылки на запись `id_` в поле `key` во всех коллекциях, кроме `skip`."""
    found: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for c in COLLECTIONS.values():
        if c.write_only or c.scalar or c.path in skip:
            continue
        if c.path == "events" and key in {"districtId", "ruleId"}:
            from app.domain.event_reads import reference_condition
            rows = _db().records("events", reference_condition(key, id_),
                                 predicate=lambda e: any(obj.get(k) == id_ for obj, k in _walk(e, key)))
        else:
            rows = _db().collection(c)
        hits = [(obj, k) for row in rows for obj, k in _walk(row, key) if obj.get(k) == id_]
        if hits:
            found[c.path] = hits
    return found


# ---------- Города ----------


def _city_view(c: Entity) -> Entity:
    return {
        "id": c["id"],
        "name": c["name"],
        "nameIn": c.get("nameIn") or c["name"],
        "region": c.get("region") or "",
        "timeZone": c["timeZone"],
        "center": c["center"],
        "radiusKm": city_lib.radius_km(c),
        "isDefault": bool(c.get("isDefault")),
        "hidden": bool(c.get("hidden")),
        "order": c.get("order") or 0,
    }


def list_cities(actor: Actor, p: dict[str, Any]) -> list[Entity]:
    """Публичный список — без скрытых; администратору с `includeHidden` — все."""
    show_hidden = bool(p.get("includeHidden")) and actor is not None and actor.get("role") == "admin"
    rows = city_lib.all_cities() if show_hidden else city_lib.visible_cities()
    return [_city_view(c) for c in rows]


def city_details(id_: str) -> Entity:
    c = city_lib.city_by_id(id_)
    return _city_view(c) if c is not None else fail("not_found", "Город не найден")


def _cities_rows() -> list[Entity]:
    """Города в базе. Пустая коллекция (база до заполнения) получает встроенный список."""
    rows = _db().cities
    if not rows:
        rows.extend(city_lib.builtin_cities())
    return rows


def _event_locations(database):
    from app.domain.event_reads import project
    return project(database, {"id", "place"})


def _located(cities: list[Entity]) -> dict[str, dict[str, str | None]]:
    """Город каждой точки, по которой записи относятся к городу: встречи, районы, площадки."""

    def city_id(point: Any) -> str | None:
        inside = [
            (distance_km(point, c["center"]) or 0.0, c["id"])
            for c in cities
            if city_lib.point_in_city(point, c)
        ]
        return min(inside)[1] if inside else None

    db = _db()
    return {
        "events": {e["id"]: city_id(e.get("place")) for e in _event_locations(db) if isinstance(e.get("place"), dict)},
        "districts": {d["id"]: city_id(d) for d in db.districts},
        "venues": {v["id"]: city_id(v) for v in db.venues},
    }


def _city_counts(city: Entity) -> dict[str, int]:
    located = _located(_cities_rows())
    counts = {path: sum(1 for x in ids.values() if x == city["id"]) for path, ids in located.items()}
    counts["users"] = sum(1 for u in _db().users if u.get("city") == city["name"])
    counts["organizations"] = sum(1 for o in _db().organizations if o.get("city") == city["name"])
    return counts


def admin_cities(actor: Actor) -> list[Entity]:
    _admin(actor)
    located = _located(_cities_rows())
    people = Counter(u.get("city") for u in _db().users)
    orgs = Counter(o.get("city") for o in _db().organizations)
    out = []
    for c in sorted(_cities_rows(), key=lambda x: (x.get("order") or 0, x["name"])):
        counts = {path: sum(1 for x in ids.values() if x == c["id"]) for path, ids in located.items()}
        counts["users"] = people.get(c["name"], 0)
        counts["organizations"] = orgs.get(c["name"], 0)
        out.append({**_city_view(c), "usage": _views(counts, _CITY_PARTS)})
    return out


def _known_zone(zone: str) -> bool:
    """Пояс IANA вида «Europe/Moscow»."""
    if "/" not in zone:
        return False
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _city_id_from(name: str) -> str:
    base = "".join(_TRANSLIT.get(ch, ch) for ch in name.lower())
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:28] or "city"
    if not base[0].isalpha():
        base = f"c-{base}"
    taken = {c["id"] for c in _cities_rows()}
    candidate, n = base, 1
    while candidate in taken or len(candidate) < 2:
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def _clean_city(input_: dict[str, Any], base: Entity | None) -> Entity:
    out: Entity = {}

    def given(key: str) -> bool:
        return base is None or key in input_

    if given("name"):
        out["name"] = _required(input_.get("name"), "name", "название города")
    if given("nameIn"):
        raw = _line(input_.get("nameIn"), 61)
        raw = re.sub(r"^(во|в)\s+", "", raw, flags=re.IGNORECASE)
        out["nameIn"] = _required(raw, "nameIn", "как сказать «в городе», например «в Туле»")
    if given("region"):
        out["region"] = _line(input_.get("region"), 100)
    if given("timeZone"):
        zone = input_.get("timeZone")
        if not isinstance(zone, str) or not _known_zone(zone):
            fail("validation", "Выберите часовой пояс из списка", {"timeZone": "Выберите пояс из списка"})
        out["timeZone"] = zone
    if given("center"):
        out["center"] = _point(input_.get("center"))
    if given("radiusKm"):
        radius = _number(
            input_.get("radiusKm", city_lib.DEFAULT_RADIUS_KM), "radiusKm", "Укажите радиус в км"
        )
        if not _MIN_RADIUS_KM <= radius <= _MAX_RADIUS_KM:
            message = f"Радиус от {_MIN_RADIUS_KM} до {_MAX_RADIUS_KM} км"
            fail("validation", message, {"radiusKm": message})
        out["radiusKm"] = int(radius) if radius.is_integer() else round(radius, 1)
    for key in ("isDefault", "hidden"):
        if key in input_:
            out[key] = _flag(input_[key], key)
    if "order" in input_:
        out["order"] = int(_number(input_["order"], "order", "Порядок — число"))
    name = out.get("name")
    if name is not None:
        same = next(
            (
                c
                for c in _cities_rows()
                if normalize(c["name"]) == normalize(name) and (base is None or c["id"] != base["id"])
            ),
            None,
        )
        if same is not None:
            fail("duplicate", f"Город «{same['name']}» уже есть", {"name": "Такой город уже есть"})
    return out


def _check_borders(before: list[Entity], after: list[Entity], confirm: bool) -> None:
    """Правка границы не должна молча переносить встречи и районы в другой город или за его пределы."""
    if confirm:
        return
    old, new = _located(before), _located(after)
    moved = {
        path: sum(1 for id_, city in ids.items() if city is not None and new[path].get(id_) != city)
        for path, ids in old.items()
    }
    if any(moved.values()):
        text = _usage_text(moved, _CITY_PARTS)
        fail(
            "outside_city",
            f"После этой правки {text} окажутся за границей своего города. "
            "Увеличьте радиус или сдвиньте центр. Если так и задумано, сохраните ещё раз с подтверждением",
            {"radiusKm": "Часть записей выйдет за границу"},
            {"moved": _views(moved, _CITY_PARTS)},
        )


def _single_default(rows: list[Entity], default_id: str) -> None:
    for c in rows:
        c["isDefault"] = c["id"] == default_id


def create_city(actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    rows = _cities_rows()
    clean = _clean_city(input_, None)
    raw_id = input_.get("id")
    if raw_id not in (None, ""):
        if not isinstance(raw_id, str) or not _CITY_ID.match(raw_id):
            message = "Адрес города — латиницей, например tula"
            fail("validation", message, {"id": message})
        if any(c["id"] == raw_id for c in rows):
            fail("duplicate", "Город с таким адресом уже есть", {"id": "Такой адрес уже занят"})
        id_ = raw_id
    else:
        id_ = _city_id_from(clean["name"])
    city: Entity = {
        "id": id_,
        "name": clean["name"],
        "nameIn": clean["nameIn"],
        "region": clean.get("region") or "",
        "timeZone": clean["timeZone"],
        "center": clean["center"],
        "radiusKm": clean.get("radiusKm", city_lib.DEFAULT_RADIUS_KM),
        "isDefault": False,
        "hidden": bool(clean.get("hidden")),
        "order": clean.get("order", max((c.get("order") or 0 for c in rows), default=0) + 1),
    }
    _check_borders(list(rows), [*rows, city], bool(input_.get("confirm")))
    rows.append(city)
    if clean.get("isDefault"):
        if city["hidden"]:
            fail(
                "validation", "Город по умолчанию нельзя скрыть", {"hidden": "Сначала выберите другой город"}
            )
        _single_default(rows, city["id"])
    _audit(admin, "city.create", "city", city["id"], city["name"], "Новый город")
    _changed(["cities"], [city["id"]], "created")
    return _city_view(city)


def update_city(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    rows = _cities_rows()
    city = next((c for c in rows if c["id"] == id_), None)
    if city is None:
        fail("not_found", "Город не найден")
    clean = _clean_city(input_, city)
    nxt = {**city, **clean}
    if nxt.get("hidden") and (clean.get("isDefault") or (city.get("isDefault") and "isDefault" not in clean)):
        fail(
            "validation",
            "Город по умолчанию нельзя скрыть. Сначала сделайте основным другой город",
            {"hidden": "Сначала выберите другой город по умолчанию"},
        )
    if clean.get("isDefault") is False and city.get("isDefault"):
        fail(
            "validation",
            "Выберите другой город по умолчанию: тогда этот перестанет быть основным",
            {"isDefault": "Нужен один город по умолчанию"},
        )
    if nxt.get("hidden") and not any(not c.get("hidden") for c in rows if c["id"] != id_):
        fail(
            "validation", "Нельзя скрыть последний город", {"hidden": "Хотя бы один город должен быть виден"}
        )
    if "center" in clean or "radiusKm" in clean:
        _check_borders(list(rows), [nxt if c["id"] == id_ else c for c in rows], bool(input_.get("confirm")))

    old_name = city["name"]
    notes: list[str] = []
    if clean.get("name") and clean["name"] != old_name:
        # Люди и клубы хранят город названием: переименование переносится на них.
        for row in [*_db().users, *_db().organizations]:
            if row.get("city") == old_name:
                row["city"] = clean["name"]
        notes.append(f"Было «{old_name}»")
    if clean.get("hidden") is not None and bool(clean["hidden"]) != bool(city.get("hidden")):
        notes.append("Скрыт из выбора" if clean["hidden"] else "Снова в выборе")
    city.update(clean)
    if clean.get("isDefault"):
        _single_default(rows, city["id"])
        notes.append("Город по умолчанию")
    action = "city.update"
    if clean.get("hidden") is True and not notes[:-1]:
        action = "city.hide"
    _audit(admin, action, "city", city["id"], city["name"], ". ".join(notes))
    _changed(["cities", "users", "organizations"], [city["id"]])
    return _city_view(city)


def delete_city(actor: Actor, id_: str) -> Entity:
    admin = _admin(actor)
    rows = _cities_rows()
    city = next((c for c in rows if c["id"] == id_), None)
    if city is None:
        fail("not_found", "Город не найден")
    counts = _city_counts(city)
    if any(counts.values()):
        fail(
            "in_use",
            f"В городе «{city['name']}» есть {_usage_text(counts, _CITY_PARTS)}. Удалить его нельзя, "
            "можно скрыть из выбора",
            None,
            {"usage": _views(counts, _CITY_PARTS)},
        )
    if city.get("isDefault"):
        fail("validation", "Сначала сделайте основным другой город")
    rows[:] = [c for c in rows if c["id"] != id_]
    _audit(admin, "city.delete", "city", id_, city["name"], "Город удалён")
    _changed(["cities"], [id_], "deleted")
    return {"ok": True}


# ---------- Районы ----------


def district_view(d: Entity) -> Entity:
    city = city_lib.city_of_point(d)
    return {**d, "cityId": city["id"] if city else None}


def list_districts() -> list[Entity]:
    return [district_view(d) for d in _db().districts]


def _district_counts(id_: str) -> tuple[dict[str, int], dict[str, list[tuple[dict[str, Any], str]]]]:
    refs = _scan("districtId", id_, frozenset({"districts"}))
    counts = {path: len(refs.get(path, [])) for path in _DISTRICT_BLOCKERS}
    return counts, refs


def admin_districts(actor: Actor, q: dict[str, Any]) -> list[Entity]:
    _admin(actor)
    totals: dict[str, Counter[str]] = {path: Counter() for path in _DISTRICT_BLOCKERS}
    for path in _DISTRICT_BLOCKERS:
        if path == "events":
            from app.domain.event_reads import reference_counts
            totals[path] = reference_counts(_db(), "districtId", _walk)
            continue
        for row in _db().collection(COLLECTIONS[path]):
            for obj, k in _walk(row, "districtId"):
                if isinstance(obj.get(k), str):
                    totals[path][obj[k]] += 1
    city_id = q.get("cityId") if isinstance(q.get("cityId"), str) else None
    out = []
    for d in _db().districts:
        view = district_view(d)
        if city_id and view["cityId"] != city_id:
            continue
        counts = {path: totals[path][d["id"]] for path in _DISTRICT_BLOCKERS}
        out.append({**view, "usage": _views(counts, _DISTRICT_BLOCKERS)})
    return sorted(out, key=lambda x: normalize(x["name"]))


def _clean_district(input_: dict[str, Any], base: Entity | None) -> Entity:
    out: Entity = {}
    if base is None or "name" in input_:
        out["name"] = _required(input_.get("name"), "name", "название района")
    if base is None or "lat" in input_ or "lng" in input_ or "point" in input_:
        raw = input_.get("point") if isinstance(input_.get("point"), dict) else input_
        point = _point({"lat": raw.get("lat"), "lng": raw.get("lng")}, "point")
        out.update(point)
    point = {"lat": out.get("lat", (base or {}).get("lat")), "lng": out.get("lng", (base or {}).get("lng"))}
    wanted = input_.get("cityId") if isinstance(input_.get("cityId"), str) else None
    city = city_lib.city_by_id(wanted) if wanted else city_lib.city_of_point(point)
    if wanted and city is None:
        fail("validation", "Выберите город из списка", {"cityId": "Такого города нет"})
    if city is None or not city_lib.point_in_city(point, city):
        where = f"города «{city['name']}»" if city else "городов платформы"
        fail("validation", f"Точка района за границей {where}", {"point": "Отметьте точку внутри города"})
    name = out.get("name") or (base or {}).get("name")
    same = next(
        (
            x
            for x in _db().districts
            if normalize(x["name"]) == normalize(name or "")
            and (base is None or x["id"] != base["id"])
            and (city_lib.city_of_point(x) or {}).get("id") == city["id"]
        ),
        None,
    )
    if same is not None:
        fail("duplicate", f"Район «{same['name']}» в этом городе уже есть", {"name": "Такой район уже есть"})
    return out


def create_district(actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    clean = _clean_district(input_, None)
    d = {"id": store.next_id("d"), "name": clean["name"], "lat": clean["lat"], "lng": clean["lng"]}
    _db().districts.append(d)
    city = city_lib.city_of_point(d)
    _audit(admin, "district.create", "district", d["id"], d["name"], f"Город: {city['name']}" if city else "")
    _changed(["districts"], [d["id"]], "created")
    return district_view(d)


def _district(id_: str) -> Entity:
    d = next((x for x in _db().districts if x["id"] == id_), None)
    return d if d is not None else fail("not_found", "Район не найден")


def update_district(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    d = _district(id_)
    clean = _clean_district(input_, d)
    old = d["name"]
    d.update(clean)
    note = f"Было «{old}»" if d["name"] != old else "Точка на карте"
    _audit(admin, "district.update", "district", d["id"], d["name"], note)
    _changed(["districts", "events", "venues"], [d["id"]])
    return district_view(d)


def delete_district(actor: Actor, id_: str) -> Entity:
    admin = _admin(actor)
    d = _district(id_)
    counts, refs = _district_counts(id_)
    if any(counts.values()):
        fail(
            "in_use",
            f"Район «{d['name']}» указан: {_usage_text(counts, _DISTRICT_BLOCKERS)}. "
            "Переименуйте его или объедините с другим районом",
            None,
            {"usage": _views(counts, _DISTRICT_BLOCKERS)},
        )
    for hits in refs.values():
        for obj, k in hits:
            obj[k] = None
    _db().districts[:] = [x for x in _db().districts if x["id"] != id_]
    _audit(admin, "district.delete", "district", id_, d["name"], "Район удалён")
    _changed(["districts"], [id_], "deleted")
    return {"ok": True}


def merge_district(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    """Все ссылки на район переходят к другому району того же города, сам район удаляется."""
    admin = _admin(actor)
    d = _district(id_)
    into_id = input_.get("into")
    target = next((x for x in _db().districts if x["id"] == into_id), None)
    if target is None:
        fail("validation", "Выберите, с каким районом объединить", {"into": "Выберите район"})
    if target["id"] == d["id"]:
        fail("validation", "Нельзя объединить район сам с собой", {"into": "Выберите другой район"})
    if (city_lib.city_of_point(d) or {}).get("id") != (city_lib.city_of_point(target) or {}).get("id"):
        fail("validation", "Объединять можно только районы одного города", {"into": "Район другого города"})
    _counts, refs = _district_counts(id_)
    moved = 0
    for hits in refs.values():
        for obj, k in hits:
            obj[k] = target["id"]
            moved += 1
    _db().districts[:] = [x for x in _db().districts if x["id"] != id_]
    _audit(
        admin,
        "district.merge",
        "district",
        id_,
        d["name"],
        f"Объединён с «{target['name']}», перенесено ссылок: {moved}",
    )
    _changed(
        ["districts", "events", "venues", "users", "companions", "organizations", "inventory"],
        [id_, target["id"]],
    )
    return district_view(target)


# ---------- Каталог направлений ----------


def _sport(id_: str) -> Entity:
    s = next((x for x in _db().sports if x["id"] == id_), None)
    return s if s is not None else fail("not_found", "Направление не найдено")


def _category_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        fail("validation", "Выберите разделы из списка", {"categoryIds": "Выберите разделы из списка"})
    known = {c["id"] for c in _db().categories}
    unknown = [x for x in value if x not in known]
    if unknown:
        fail("validation", "Такого раздела нет", {"categoryIds": "Выберите разделы из списка"})
    return list(dict.fromkeys(value))


def _icon(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not _ICON.match(value):
        fail("validation", "Выберите иконку из списка", {"icon": "Выберите иконку из списка"})
    return value


def _clean_sport(input_: dict[str, Any], base: Entity | None) -> Entity:
    out: Entity = {}

    def given(key: str) -> bool:
        return base is None or key in input_

    if given("name"):
        name = _required(input_.get("name"), "name", "название", 2, 40)
        out["name"] = name[:1].upper() + name[1:]
        taken = next(
            (
                s
                for s in _db().sports
                if not s.get("mergedInto")
                and (base is None or s["id"] != base["id"])
                and normalize(name)
                in {normalize(s["name"]), *(normalize(w) for w in s.get("synonyms") or [])}
            ),
            None,
        )
        if taken is not None:
            fail(
                "duplicate",
                f"Такое название уже есть у направления «{taken['name']}»",
                {"name": "Такое направление уже есть"},
            )
    if given("synonyms"):
        out["synonyms"] = _words(input_.get("synonyms"), "synonyms")
    if given("icon"):
        out["icon"] = _icon(input_.get("icon"))
    if given("categoryIds"):
        out["categoryIds"] = _category_ids(input_.get("categoryIds"))
    if given("popular"):
        out["popular"] = _flag(input_.get("popular", False), "popular")
    if given("fields"):
        out["fields"] = _fields(input_.get("fields"))
    if "hidden" in input_:
        out["hidden"] = _flag(input_["hidden"], "hidden")
    return out


def create_sport(actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    clean = _clean_sport(input_, None)
    if not clean["categoryIds"]:
        fail("validation", "Выберите хотя бы один раздел", {"categoryIds": "Выберите раздел"})
    s: Entity = {
        "id": store.next_id("s"),
        "name": clean["name"],
        "synonyms": clean["synonyms"],
        "categoryIds": clean["categoryIds"],
        "icon": clean["icon"],
        "kind": "catalog",
        "popular": clean["popular"],
        "fields": clean["fields"],
        "mergedInto": None,
        "createdBy": admin["id"],
        "createdAt": clock.iso(clock.now()),
        "hidden": bool(clean.get("hidden")),
    }
    _db().sports.append(s)
    _audit(admin, "sport.add", "sport", s["id"], s["name"], "Добавлено в каталог")
    _changed(["sports"], [s["id"]], "created")
    return _d().sport_view(s["id"])


def update_sport(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    s = _sport(id_)
    if s.get("mergedInto"):
        fail("bad_state", "Направление объединено с другим, правьте основное")
    clean = _clean_sport(input_, s)
    notes: list[str] = []
    if clean.get("name") and clean["name"] != s["name"]:
        # Старое название остаётся словом для поиска: по нему найдут переименованное направление.
        old = s["name"].lower()
        words = clean.get("synonyms", s.get("synonyms") or [])
        clean["synonyms"] = list(dict.fromkeys([*words, old]))
        notes.append(f"Было «{s['name']}»")
    action = "sport.update"
    if "hidden" in clean and bool(clean["hidden"]) != bool(s.get("hidden")):
        notes.append("Скрыто из выбора" if clean["hidden"] else "Снова в выборе")
        if len(clean) == 1:
            action = "sport.hide" if clean["hidden"] else "sport.show"
    s.update(clean)
    _audit(admin, action, "sport", s["id"], s["name"], ". ".join(notes))
    _changed(["sports", "events"], [s["id"]])
    return {**_d().sport_view(s["id"]), "hidden": bool(s.get("hidden"))}


def _category(id_: str) -> Entity:
    c = next((x for x in _db().categories if x["id"] == id_), None)
    return c if c is not None else fail("not_found", "Раздел не найден")


def _clean_category(input_: dict[str, Any], base: Entity | None) -> Entity:
    out: Entity = {}
    if base is None or "name" in input_:
        out["name"] = _required(input_.get("name"), "name", "название раздела", 2, 40)
        same = next(
            (
                c
                for c in _db().categories
                if normalize(c["name"]) == normalize(out["name"]) and (base is None or c["id"] != base["id"])
            ),
            None,
        )
        if same is not None:
            fail("duplicate", f"Раздел «{same['name']}» уже есть", {"name": "Такой раздел уже есть"})
    if base is None or "icon" in input_:
        out["icon"] = _icon(input_.get("icon"))
    if base is None or "parentId" in input_:
        parent_id = input_.get("parentId") or None
        if parent_id is not None:
            parent = next((c for c in _db().categories if c["id"] == parent_id), None)
            if parent is None or parent.get("parentId"):
                fail("validation", "Выберите основной раздел", {"parentId": "Только раздел верхнего уровня"})
            if base is not None and (
                parent_id == base["id"] or any(c.get("parentId") == base["id"] for c in _db().categories)
            ):
                fail("validation", "У раздела есть подразделы: он остаётся основным", {"parentId": "Нельзя"})
        out["parentId"] = parent_id
    if base is None or "fields" in input_:
        out["fields"] = _fields(input_.get("fields"))
    if "order" in input_:
        out["order"] = int(_number(input_["order"], "order", "Порядок — число"))
    if "hidden" in input_:
        out["hidden"] = _flag(input_["hidden"], "hidden")
    return out


def create_category(actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    clean = _clean_category(input_, None)
    siblings = [c for c in _db().categories if c.get("parentId") == clean["parentId"]]
    c: Entity = {
        "id": store.next_id("c"),
        "name": clean["name"],
        "icon": clean["icon"],
        "order": clean.get("order", max((x.get("order") or 0 for x in siblings), default=0) + 1),
        "parentId": clean["parentId"],
        "fields": clean["fields"],
        "hidden": bool(clean.get("hidden")),
    }
    _db().categories.append(c)
    _audit(admin, "category.create", "category", c["id"], c["name"], "Новый раздел каталога")
    _changed(["sports", "categories"], [c["id"]], "created")
    return c


def update_category(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    c = _category(id_)
    clean = _clean_category(input_, c)
    note = f"Было «{c['name']}»" if clean.get("name") and clean["name"] != c["name"] else ""
    if "hidden" in clean and bool(clean["hidden"]) != bool(c.get("hidden")):
        note = ". ".join(x for x in [note, "Скрыт" if clean["hidden"] else "Снова виден"] if x)
    c.update(clean)
    _audit(admin, "category.update", "category", c["id"], c["name"], note)
    _changed(["sports", "categories"], [c["id"]])
    return c


def delete_category(actor: Actor, id_: str) -> Entity:
    admin = _admin(actor)
    c = _category(id_)
    sports = [s for s in _db().sports if id_ in (s.get("categoryIds") or []) and not s.get("mergedInto")]
    children = [x for x in _db().categories if x.get("parentId") == id_]
    if sports or children:
        parts = [
            count(len(sports), ("направление", "направления", "направлений")) if sports else "",
            count(len(children), ("подраздел", "подраздела", "подразделов")) if children else "",
        ]
        fail(
            "in_use",
            f"В разделе «{c['name']}» есть {', '.join(p for p in parts if p)}. "
            "Перенесите их в другой раздел или скройте этот",
            None,
            {"usage": [{"kind": "sports", "count": len(sports), "label": parts[0]}] if sports else []},
        )
    _db().categories[:] = [x for x in _db().categories if x["id"] != id_]
    _audit(admin, "category.delete", "category", id_, c["name"], "Раздел удалён")
    _changed(["sports", "categories"], [id_], "deleted")
    return {"ok": True}


# ---------- Правила площадки ----------


def _rules_sorted() -> list[Entity]:
    return sorted(_db().rules, key=lambda r: (r.get("number") or 0, r["id"]))


def list_rules(actor: Actor, p: dict[str, Any]) -> list[Entity]:
    show_hidden = bool(p.get("includeHidden")) and actor is not None and actor.get("role") == "admin"
    return [r for r in _rules_sorted() if show_hidden or not r.get("hidden")]


def _rule(id_: str) -> Entity:
    r = next((x for x in _db().rules if x["id"] == id_), None)
    return r if r is not None else fail("not_found", "Пункт правил не найден")


def _rule_counts(id_: str) -> dict[str, int]:
    refs = _scan("ruleId", id_, frozenset({"rules"}))
    return {path: len(hits) for path, hits in refs.items()}


def admin_rules(actor: Actor) -> list[Entity]:
    _admin(actor)
    totals: dict[str, Counter[str]] = {}
    for c in COLLECTIONS.values():
        if c.write_only or c.scalar or c.path == "rules":
            continue
        if c.path == "events":
            from app.domain.event_reads import reference_counts
            totals[c.path] = reference_counts(_db(), "ruleId", _walk)
            continue
        for row in _db().collection(c):
            for obj, k in _walk(row, "ruleId"):
                if isinstance(obj.get(k), str):
                    totals.setdefault(c.path, Counter())[obj[k]] += 1
    out = []
    for r in _rules_sorted():
        counts = {path: n[r["id"]] for path, n in totals.items() if n[r["id"]]}
        out.append({**r, "hidden": bool(r.get("hidden")), "usage": _views(counts, _RULE_PARTS)})
    return out


def _clean_rule(input_: dict[str, Any], base: Entity | None) -> Entity:
    out: Entity = {}
    if base is None or "title" in input_:
        out["title"] = _required(input_.get("title"), "title", "название правила", 3, 120)
    if base is None or "text" in input_:
        text = _text_block(input_.get("text"), 1001)
        if len(text) < 10:
            fail("validation", "Объясните правило хотя бы одной фразой", {"text": "Напишите текст правила"})
        if len(text) > 1000:
            fail("validation", "Не больше 1000 символов", {"text": "Не больше 1000 символов"})
        out["text"] = text
    if base is None or "example" in input_:
        example = _text_block(input_.get("example"), 501)
        if len(example) > 500:
            fail("validation", "Пример — не больше 500 символов", {"example": "Не больше 500 символов"})
        out["example"] = example or None
    if "hidden" in input_:
        out["hidden"] = _flag(input_["hidden"], "hidden")
    return out


def _renumber() -> None:
    for i, r in enumerate(_rules_sorted(), start=1):
        r["number"] = i


def create_rule(actor: Actor, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    clean = _clean_rule(input_, None)
    r: Entity = {
        "id": store.next_id("rule"),
        "number": max((x.get("number") or 0 for x in _db().rules), default=0) + 1,
        "title": clean["title"],
        "text": clean["text"],
        "example": clean["example"],
        "hidden": bool(clean.get("hidden")),
    }
    _db().rules.append(r)
    _audit(admin, "rule.create", "rule", r["id"], r["title"], f"Пункт {r['number']}")
    _changed(["rules"], [r["id"]], "created")
    return r


def update_rule(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    r = _rule(id_)
    clean = _clean_rule(input_, r)
    action = "rule.update"
    note = f"Было «{r['title']}»" if clean.get("title") and clean["title"] != r["title"] else ""
    if "hidden" in clean and bool(clean["hidden"]) != bool(r.get("hidden")):
        if len(clean) == 1:
            action = "rule.hide" if clean["hidden"] else "rule.show"
        note = ". ".join(x for x in [note, "Скрыто из списка" if clean["hidden"] else "Снова в списке"] if x)
    r.update(clean)
    _audit(admin, action, "rule", r["id"], r["title"], note)
    _changed(["rules"], [r["id"]])
    return r


def move_rule(actor: Actor, id_: str, input_: dict[str, Any]) -> Entity:
    admin = _admin(actor)
    r = _rule(id_)
    direction = input_.get("direction")
    if direction not in {"up", "down"}:
        fail("validation", "Укажите, куда переместить: выше или ниже", {"direction": "up или down"})
    rows = _rules_sorted()
    i = rows.index(r)
    j = i - 1 if direction == "up" else i + 1
    if 0 <= j < len(rows):
        rows[i], rows[j] = rows[j], rows[i]
        for n, x in enumerate(rows, start=1):
            x["number"] = n
        _audit(admin, "rule.move", "rule", r["id"], r["title"], f"Теперь пункт {r['number']}")
        _changed(["rules"], [r["id"]])
    return r


def delete_rule(actor: Actor, id_: str) -> Entity:
    admin = _admin(actor)
    r = _rule(id_)
    counts = _rule_counts(id_)
    if any(counts.values()):
        fail(
            "in_use",
            f"На правило «{r['title']}» уже ссылались при модерации: {_usage_text(counts, _RULE_PARTS)}. "
            "Удалить его нельзя, можно скрыть",
            None,
            {"usage": _views(counts, _RULE_PARTS)},
        )
    _db().rules[:] = [x for x in _db().rules if x["id"] != id_]
    _renumber()
    _audit(admin, "rule.delete", "rule", id_, r["title"], "Пункт удалён")
    _changed(["rules"], [id_], "deleted")
    return {"ok": True}


# ---------- Маршруты ----------


def references_routes(actor: Any) -> list[Route]:
    a = actor
    return [
        route("get", r"^/admin/cities$", lambda _g, _p, _q: admin_cities(a())),
        route("post", r"^/admin/cities$", lambda _g, p, _q: create_city(a(), p)),
        route("put", r"^/admin/cities/([^/]+)$", lambda g, p, _q: update_city(a(), g[0], p)),
        route("delete", r"^/admin/cities/([^/]+)$", lambda g, _p, _q: delete_city(a(), g[0])),
        route("get", r"^/admin/districts$", lambda _g, _p, q: admin_districts(a(), q)),
        route("post", r"^/admin/districts$", lambda _g, p, _q: create_district(a(), p)),
        route("put", r"^/admin/districts/([^/]+)$", lambda g, p, _q: update_district(a(), g[0], p)),
        route("delete", r"^/admin/districts/([^/]+)$", lambda g, _p, _q: delete_district(a(), g[0])),
        route("post", r"^/admin/districts/([^/]+)/merge$", lambda g, p, _q: merge_district(a(), g[0], p)),
        route("post", r"^/admin/sports$", lambda _g, p, _q: create_sport(a(), p)),
        route("put", r"^/admin/sports/([^/]+)$", lambda g, p, _q: update_sport(a(), g[0], p)),
        route("post", r"^/admin/categories$", lambda _g, p, _q: create_category(a(), p)),
        route("put", r"^/admin/categories/([^/]+)$", lambda g, p, _q: update_category(a(), g[0], p)),
        route("delete", r"^/admin/categories/([^/]+)$", lambda g, _p, _q: delete_category(a(), g[0])),
        route("get", r"^/admin/rules$", lambda _g, _p, _q: admin_rules(a())),
        route("post", r"^/admin/rules$", lambda _g, p, _q: create_rule(a(), p)),
        route("put", r"^/admin/rules/([^/]+)$", lambda g, p, _q: update_rule(a(), g[0], p)),
        route("delete", r"^/admin/rules/([^/]+)$", lambda g, _p, _q: delete_rule(a(), g[0])),
        route("post", r"^/admin/rules/([^/]+)/move$", lambda g, p, _q: move_rule(a(), g[0], p)),
    ]
