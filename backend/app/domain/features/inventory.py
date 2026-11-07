"""В3 + С7. Инвентарь для игры, общая полка и помощь от партнёров.

У события есть список того, что нужно для игры: участники отмечают, что возьмут с собой, а недостающее
просят с общей полки — у людей и организаций. Клубы просят партнёров о помощи и выбирают отклик.
Права и переходы состояний проверяются здесь, а не в интерфейсе.
"""

import re
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa

from app.domain import bus, clock, core, store
from app.domain.errors import fail
from app.domain.features import payments  # оплата на сайте: «Продаю» на полке
from app.domain.features.kit import organizer_ids
from app.domain.lib.cities import city_of_point
from app.domain.lib.dates import moment
from app.domain.lib.numbers import parse_number
from app.domain.lib.plural import count
from app.domain.lib.text import normalize, short_name
from app.domain.routing import Listed, Resources, Route, route
from app.domain.schema import COLLECTIONS
from app.domain.text import text_matches
from app.domain.types import ID, Actor, Entity

GEAR_KINDS: list[str] = [
    "ball",
    "racket",
    "shuttle",
    "bibs",
    "mat",
    "poles",
    "net",
    "cones",
    "board",
    "clock",
    "skis",
    "protection",
    "other",
]
CONDITIONS: list[str] = ["new", "good", "used"]
TERMS: list[str] = ["return_after", "no_deposit", "pickup", "bring_to_place", "kids_only"]
MAX_LINES = 12
MAX_QTY = 99
PIECES = ("штука", "штуки", "штук")
# Учитываются в наличии на полке и в закрытии строки события.
GIVEN: list[str] = ["accepted", "returned"]

# Порядок важен: «шахматные часы» — часы, а не доска; «ракетка» раньше «мяча».
KIND_WORDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"час(ы|ов)", re.IGNORECASE), "clock"),
    (re.compile(r"ракетк", re.IGNORECASE), "racket"),
    (re.compile(r"волан|мячик.*(настол|пинг)", re.IGNORECASE), "shuttle"),
    (re.compile(r"мяч", re.IGNORECASE), "ball"),
    (re.compile(r"манишк|форм[аы]|майк|футболк", re.IGNORECASE), "bibs"),
    # «Мат» и «маты» — отдельным словом: «шахматы» сюда не попадают.
    (re.compile(r"коврик|\bматы?\b", re.IGNORECASE), "mat"),
    (re.compile(r"палк", re.IGNORECASE), "poles"),
    (re.compile(r"сетк", re.IGNORECASE), "net"),
    (re.compile(r"фишк|конус", re.IGNORECASE), "cones"),
    (re.compile(r"шахмат|доск|фигур|шашк", re.IGNORECASE), "board"),
    (re.compile(r"лыж|коньк|конёк", re.IGNORECASE), "skis"),
    (re.compile(r"шлем|защит|перчатк|налокотн|наколенн|капа", re.IGNORECASE), "protection"),
]


def guess_kind(name: str) -> str:
    return next((kind for pattern, kind in KIND_WORDS if pattern.search(name)), "other")


def _trim(value: Any, max_len: int) -> str:
    """Текст из формы: пробелы схлопнуты, длина ограничена. Не строка — пустой текст."""
    text = value if isinstance(value, str) else ""
    return " ".join(text.split())[:max_len].rstrip()


def _given(value: Any) -> bool:
    """Поле формы заполнено: не null и не пустая строка."""
    return value is not None and value != ""


def _stamp() -> str:
    return clock.iso(clock.now())


def _newest_first(iso: str) -> float:
    """Ключ сортировки «сначала новые» по дате записи."""
    return -moment(iso).timestamp()


def _pieces(n: float) -> str:
    return count(n, PIECES)


def _q(name: str) -> str:
    """«Спортмастерская», но ФК «Дворовые легенды» — без двойных кавычек."""
    return name if "«" in name else f"«{name}»"


def _state() -> Any:
    return store.data().inventory


def _commit(ids: list[ID], extra: list[str] | None = None) -> None:
    bus.publish(["inventory", "notifications", *(extra or [])], ids)


def _notify(user_ids: list[ID], type_: str, title: str, text: str, link: str) -> None:
    at = _stamp()
    for user_id in dict.fromkeys(u for u in user_ids if u):
        store.data().notifications.insert(
            0,
            {
                "id": store.next_id("n"),
                "userId": user_id,
                "type": type_,
                "title": title,
                "text": text,
                "link": link,
                "read": False,
                "createdAt": at,
            },
        )


# ---------- Общие проверки ----------


def _require_user(actor: Actor) -> Entity:
    return actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")


def _require_person(actor: Actor) -> Entity:
    user = _require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "Администратор не участвует в обмене инвентарём")
    return user


def _org(id_: ID) -> Entity | None:
    return next((o for o in store.data().organizations if o["id"] == id_), None)


def _get_event(id_: ID) -> Entity:
    e = store.data().record("events", id_)
    if e is None:
        fail("not_found", "Событие не найдено")
    if e["status"] == "deleted":
        fail("event_deleted", f"Событие «{e['title']}» удалено")
    return e


def _require_upcoming(e: Entity) -> None:
    s = core.domain.event_state(e)
    if s == "upcoming":
        return
    why: dict[str, str] = {
        "live": "Событие уже идёт, список инвентаря закрыт",
        "past": "Событие уже прошло",
        "cancelled": "Событие отменено организатором",
        "removed": "Событие снято с публикации",
    }
    fail("event_inactive", why.get(s, "Событие недоступно"))


def _is_confirmed(user_id: ID, event_id: ID) -> bool:
    return any(
        p["eventId"] == event_id and p["userId"] == user_id and p["status"] == "confirmed"
        for p in store.data().participations
    )


def _is_player(user: Entity | None, e: Entity) -> bool:
    """Возьмёт с собой или попросит вещь: участник с подтверждённой записью или организатор."""
    if user is None:
        return False
    return core.domain.is_organizer(user, e) or _is_confirmed(user["id"], e["id"])


def _owner_ids(ref: Entity) -> list[ID]:
    if ref["kind"] == "user":
        return [ref["id"]]
    o = _org(ref["id"])
    return [o["ownerId"]] if o is not None else []


def _owns(user: Entity | None, ref: Entity) -> bool:
    if user is None:
        return False
    if ref["kind"] == "user":
        return ref["id"] == user["id"]
    o = _org(ref["id"])
    return o is not None and o["ownerId"] == user["id"]


def _owner_view(ref: Entity) -> Entity:
    if ref["kind"] == "org":
        o = _org(ref["id"])
        return {
            "kind": "org",
            "id": ref["id"],
            "name": o["name"] if o is not None else "Организация",
            "avatarUrl": o.get("logoUrl") if o is not None else None,
            "link": f"/orgs/{ref['id']}",
            "orgType": o.get("type") if o is not None else None,
        }
    u = core.domain.user(ref["id"])
    return {
        "kind": "user",
        "id": ref["id"],
        "name": short_name(u["name"]) if u is not None else "Пользователь",
        "avatarUrl": u.get("avatarUrl") if u is not None else None,
        "link": f"/profile/{ref['id']}",
        "orgType": None,
    }


def _owner_contact(ref: Entity) -> str | None:
    if ref["kind"] == "org":
        o = _org(ref["id"])
        if o is None:
            return None
        return o["contacts"].get("phone") or o["contacts"].get("email") or None
    u = core.domain.user(ref["id"])
    return (u.get("phone") or None) if u is not None else None


def _person(id_: ID) -> Entity:
    return core.domain.person(core.domain.user(id_), True)


def _approved_orgs_of(user_id: ID) -> list[Entity]:
    return [o for o in store.data().organizations if o["ownerId"] == user_id and o["status"] == "approved"]


def _to_org(o: Entity) -> Entity:
    return {"id": o["id"], "name": o["name"], "type": o["type"], "status": o["status"]}


# ---------- Что нужно для игры ----------


def clean_gear_lines(raw: Any) -> list[Entity] | None:
    """Проверка списка из формы события. Ничего не меняет: вызывается до создания и правки."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        fail("validation", "Проверьте список инвентаря", {"gear": "Список не распознан"})
    lines: list[Entity] = []
    for fields in raw:
        if not isinstance(fields, dict):
            fail("validation", "Проверьте список инвентаря", {"gear": "Строка списка не распознана"})
        name = _trim(fields.get("name"), 60)
        if not name:
            continue
        line: Entity = {"id": fields["id"]} if isinstance(fields.get("id"), str) else {}
        kind = fields.get("kind")
        line["name"] = name
        line["kind"] = kind if kind in GEAR_KINDS else guess_kind(name)
        line["quantity"] = parse_number(fields.get("quantity"))
        lines.append(line)
    if len(lines) > MAX_LINES:
        fail("validation", "Проверьте список инвентаря", {"gear": f"Не больше {MAX_LINES} строк"})
    for line in lines:
        if len(line["name"]) < 2:
            fail(
                "validation",
                "Проверьте список инвентаря",
                {"gear": "Напишите, что нужно, хотя бы двумя буквами"},
            )
        quantity = line["quantity"]
        if not isinstance(quantity, int) or not 1 <= quantity <= MAX_QTY:
            fail(
                "validation",
                "Проверьте список инвентаря",
                {"gear": f"Укажите количество от 1 до {MAX_QTY}: «{line['name']}»"},
            )
    seen: set[str] = set()
    for line in lines:
        key = normalize(line["name"])
        if key in seen:
            fail("validation", "Проверьте список инвентаря", {"gear": f"«{line['name']}» уже есть в списке"})
        seen.add(key)
    return lines


def _new_line(event_id: ID, line: Entity, at: str) -> Entity:
    return {
        "id": store.next_id("gl"),
        "eventId": event_id,
        "name": line["name"],
        "kind": line.get("kind") or guess_kind(line["name"]),
        "quantity": line["quantity"],
        "createdAt": at,
    }


def apply_gear_lines(event_ids: list[ID], lines: list[Entity] | None) -> None:
    """Новое событие (или серия): у каждой встречи свой список, отметки «возьму» у каждой свои."""
    if not lines:
        return
    inv = _state()
    at = _stamp()
    for event_id in event_ids:
        inv.lines.extend(_new_line(event_id, line, at) for line in lines)


def replace_gear_lines(event_id: ID, lines: list[Entity] | None) -> bool:
    """Правка списка организатором. Строки сопоставляются по id или по названию, поэтому отметки
    участников и выданные вещи не теряются. У удалённой строки отметки «возьму» снимаются,
    а договорённости о вещах остаются за событием без строки.
    """
    # None — список в правке не передавали.
    if lines is None:
        return False
    inv = _state()
    current = [x for x in inv.lines if x["eventId"] == event_id]
    kept: list[Entity] = []
    kept_ids: set[ID] = set()
    at = _stamp()
    for line in lines:
        match = next((c for c in current if c["id"] == line.get("id")), None)
        if match is None:
            match = next((c for c in current if normalize(c["name"]) == normalize(line["name"])), None)
        if match is not None and match["id"] not in kept_ids:
            match["name"] = line["name"]
            match["kind"] = line.get("kind") or match["kind"]
            match["quantity"] = line["quantity"]
        else:
            match = _new_line(event_id, line, at)
        kept.append(match)
        kept_ids.add(match["id"])
    removed = {c["id"] for c in current if c["id"] not in kept_ids}
    inv.lines = [*(x for x in inv.lines if x["eventId"] != event_id), *kept]
    inv.pledges = [p for p in inv.pledges if p["lineId"] not in removed]
    for loan in inv.loans:
        if loan["lineId"] in removed:
            loan["lineId"] = None
    return True


def gear_lines_of(event_id: ID) -> list[Entity]:
    return [x for x in _state().lines if x["eventId"] == event_id]


def _line_view(actor: Actor, e: Entity, line: Entity, can_see_pending: bool) -> Entity:
    inv = _state()
    me = actor["id"] if actor is not None else None
    pledges = [p for p in inv.pledges if p["lineId"] == line["id"] and p["quantity"] > 0]
    pledges = [p for p in pledges if _is_player(core.domain.user(p["userId"]), e)]
    loans = [
        x
        for x in inv.loans
        if x["eventId"] == e["id"]
        and x["lineId"] == line["id"]
        and (
            x["status"] in GIVEN or (x["status"] == "pending" and (can_see_pending or x["requesterId"] == me))
        )
    ]
    covered = sum(p["quantity"] for p in pledges) + sum(x["quantity"] for x in loans if x["status"] in GIVEN)

    def loan_row(loan: Entity) -> Entity:
        item = next((i for i in inv.shelf if i["id"] == loan["itemId"]), None)
        return {
            "id": loan["id"],
            "from": _owner_view(item["owner"])
            if item is not None
            else {
                "kind": "user",
                "id": "",
                "name": "Владелец",
                "avatarUrl": None,
                "link": "/inventory",
                "orgType": None,
            },
            "quantity": loan["quantity"],
            "status": loan["status"],
            "mine": loan["requesterId"] == me,
        }

    mine = next((p for p in pledges if p["userId"] == me), None)
    return {
        **line,
        "covered": covered,
        "missing": max(0, line["quantity"] - covered),
        "pledges": [
            {"person": _person(p["userId"]), "quantity": p["quantity"], "mine": p["userId"] == me}
            for p in pledges
        ],
        "loans": [loan_row(x) for x in loans],
        "myPledge": mine["quantity"] if mine is not None else 0,
    }


def event_gear(actor: Actor, event_id: ID) -> Entity:
    e = _get_event(event_id)
    s = core.domain.event_state(e)
    organizer = core.domain.is_organizer(actor, e)
    can_see_pending = organizer or (actor is not None and actor["role"] == "admin")
    lines = [
        _line_view(actor, e, line, can_see_pending) for line in _state().lines if line["eventId"] == e["id"]
    ]
    upcoming = s == "upcoming"
    player = _is_player(actor, e)
    o = _org(e["organizer"]["id"]) if e["organizer"]["kind"] == "org" else None
    not_admin = actor is None or actor["role"] != "admin"
    if not upcoming:
        pledge_hint = ""
    elif actor is None:
        pledge_hint = "Войдите и запишитесь, чтобы отметить, что возьмёте с собой"
    elif actor["role"] == "admin" or player:
        pledge_hint = ""
    else:
        pledge_hint = "Отметить «Возьму с собой» могут участники события"
    return {
        "eventId": e["id"],
        "eventTitle": e["title"],
        "state": s,
        "lines": lines,
        "totals": {
            "needed": sum(x["quantity"] for x in lines),
            "covered": sum(min(x["covered"], x["quantity"]) for x in lines),
            "missing": sum(x["missing"] for x in lines),
        },
        "can": {
            "pledge": upcoming and player and not_admin,
            "request": upcoming and player and not_admin,
            "edit": upcoming and organizer,
            "askSponsors": upcoming
            and organizer
            and o is not None
            and o["status"] == "approved"
            and o["type"] != "sponsor",
        },
        "pledgeHint": pledge_hint,
        "support": [
            _support_view(actor, n)
            for n in _state().support
            if n["eventId"] == e["id"] and n["status"] != "cancelled"
        ],
    }


def set_pledge(actor: Actor, event_id: ID, line_id: ID, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    e = _get_event(event_id)
    _require_upcoming(e)
    inv = _state()
    line = next((x for x in inv.lines if x["id"] == line_id and x["eventId"] == e["id"]), None)
    if line is None:
        fail("not_found", "Такой строки в списке нет. Обновите страницу")
    if not _is_player(user, e):
        fail("forbidden", "Отметить «Возьму с собой» могут участники события и организатор")
    quantity = parse_number(input_.get("quantity"))
    if not isinstance(quantity, int) or not 0 <= quantity <= line["quantity"]:
        fail(
            "validation",
            f"Укажите количество от 0 до {line['quantity']}",
            {"quantity": f"От 0 до {line['quantity']}"},
        )
    view = _line_view(user, e, line, False)
    others = view["covered"] - view["myPledge"]
    max_ = max(view["myPledge"], line["quantity"] - others)
    if quantity > max_:
        fail(
            "validation",
            f"«{line['name']}» уже собрали полностью" if max_ == 0 else f"Осталось собрать {_pieces(max_)}",
            {"quantity": f"Не больше {max_}"},
        )
    existing = next((p for p in inv.pledges if p["lineId"] == line["id"] and p["userId"] == user["id"]), None)
    if quantity == 0:
        inv.pledges = [p for p in inv.pledges if p is not existing]
    elif existing is not None:
        existing["quantity"] = quantity
        existing["at"] = _stamp()
    else:
        inv.pledges.append(
            {
                "id": store.next_id("gp"),
                "eventId": e["id"],
                "lineId": line["id"],
                "userId": user["id"],
                "quantity": quantity,
                "at": _stamp(),
            }
        )
    _commit([e["id"]])
    return event_gear(user, e["id"])


# ---------- Полка ----------


def _in_use(item_id: ID) -> int:
    return sum(x["quantity"] for x in _state().loans if x["itemId"] == item_id and x["status"] == "accepted")


def _shelf_view(actor: Actor, i: Entity) -> Entity:
    used = _in_use(i["id"])
    mine = _owns(actor, i["owner"])
    district = next((d for d in store.data().districts if d["id"] == i["districtId"]), None)
    sport = next((s for s in store.data().sports if s["id"] == i["sportId"]), None) if i["sportId"] else None
    return {
        **i,
        "ownerView": _owner_view(i["owner"]),
        "available": max(0, i["quantity"] - used),
        "inUse": used,
        "districtName": district["name"] if district is not None else None,
        "sportName": sport["name"] if sport is not None else None,
        "isMine": mine,
        "pendingRequests": sum(
            1 for x in _state().loans if x["itemId"] == i["id"] and x["status"] == "pending"
        )
        if mine
        else 0,
    }


def _shelf_city(i: Entity) -> str | None:
    """Город вещи: по району, где её забирать; без района — город владельца."""
    district = next((d for d in store.data().districts if d["id"] == i["districtId"]), None)
    found = city_of_point(district)
    if found is not None:
        return found["name"]
    ref = i["owner"]
    owner = (
        next((u for u in store.data().users if u["id"] == ref["id"]), None)
        if ref["kind"] == "user"
        else _org(ref["id"])
    )
    return (owner or {}).get("city")


def list_shelf(actor: Actor, p: dict[str, Any]) -> list[Entity]:
    items = _state().shelf
    if p.get("mine"):
        user = _require_user(actor)
        items = [i for i in items if _owns(user, i["owner"])]
    if p.get("ownerOrgId"):
        items = [i for i in items if i["owner"]["kind"] == "org" and i["owner"]["id"] == p["ownerOrgId"]]
    if p.get("kind"):
        items = [i for i in items if i["kind"] == p["kind"]]
    if p.get("sportId"):
        items = [i for i in items if not i["sportId"] or i["sportId"] == p["sportId"]]
    if p.get("districtId"):
        items = [i for i in items if i["districtId"] == p["districtId"]]
    if p.get("city"):
        items = [i for i in items if _shelf_city(i) == p["city"]]
    if p.get("q"):
        q = str(p["q"])
        items = [
            i for i in items if text_matches(q, f"{i['name']} {i['note']} {_owner_view(i['owner'])['name']}")
        ]
    event = store.data().record("events", p["eventId"]) if p.get("eventId") else None
    views = [_shelf_view(actor, i) for i in items]

    def score(v: Entity) -> int:
        """Сначала то, что свободно, затем подходящее событию по спорту и району."""
        points = 4 if v["available"] > 0 else 0
        if event is not None:
            if v["sportId"] is not None and v["sportId"] == event.get("sportId"):
                points += 2
            if v["districtId"] is not None and v["districtId"] == event["place"].get("districtId"):
                points += 1
        return points

    views.sort(key=lambda v: (-score(v), _newest_first(v["createdAt"])))
    return views


def shelf_item(actor: Actor, id_: ID) -> Entity:
    i = next((x for x in _state().shelf if x["id"] == id_), None)
    if i is None:
        fail("not_found", "Этой вещи уже нет на полке")
    return _shelf_view(actor, i)


def _validate_shelf(input_: dict[str, Any], partial: bool) -> dict[str, str]:
    errors: dict[str, str] = {}
    if (not partial or "name" in input_) and len(_trim(input_.get("name"), 60)) < 2:
        errors["name"] = "Напишите, что даёте: например, «Волейбольный мяч»"
    if not partial or "quantity" in input_:
        q = parse_number(input_.get("quantity"))
        if not isinstance(q, int) or not 1 <= q <= MAX_QTY:
            errors["quantity"] = f"Укажите количество от 1 до {MAX_QTY}"
    if "kind" in input_ and input_["kind"] not in GEAR_KINDS:
        errors["kind"] = "Выберите тип вещи"
    if "condition" in input_ and input_["condition"] not in CONDITIONS:
        errors["condition"] = "Выберите состояние"
    if "terms" in input_ and (
        not isinstance(input_["terms"], list) or any(t not in TERMS for t in input_["terms"])
    ):
        errors["terms"] = "Выберите условия из списка"
    if _given(input_.get("districtId")) and not any(
        d["id"] == input_["districtId"] for d in store.data().districts
    ):
        errors["districtId"] = "Выберите район из списка"
    if _given(input_.get("sportId")) and not any(s["id"] == input_["sportId"] for s in store.data().sports):
        errors["sportId"] = "Выберите направление из списка"
    errors.update(payments.sale_errors(input_))  # оплата на сайте
    return errors


def create_shelf_item(actor: Actor, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    owner: Entity = {"kind": "user", "id": user["id"]}
    if input_.get("orgId"):
        o = _org(input_["orgId"])
        if o is None:
            fail("not_found", "Организация не найдена")
        if o["ownerId"] != user["id"]:
            fail("forbidden", "Делиться от имени организации может только её представитель")
        if o["status"] != "approved":
            fail(
                "org_not_approved", "Организация ещё не допущена. Пока можно поделиться вещью от своего имени"
            )
        owner = {"kind": "org", "id": o["id"]}
    errors = _validate_shelf(input_, False)
    if errors:
        fail("validation", "Проверьте поля формы", errors)
    at = _stamp()
    name = _trim(input_.get("name"), 60)
    item: Entity = {
        "id": store.next_id("sh"),
        "owner": owner,
        "createdBy": user["id"],
        "name": name,
        "kind": input_.get("kind") or guess_kind(name),
        "sportId": input_.get("sportId") or None,
        "quantity": parse_number(input_.get("quantity")),
        "condition": input_.get("condition") or "good",
        # Без района — район того, кто делится.
        "districtId": input_.get("districtId") or user.get("districtId"),
        "terms": list(dict.fromkeys(input_.get("terms") or [])),
        "note": _trim(input_.get("note"), 300),
        "createdAt": at,
        "updatedAt": at,
        "sale": payments.clean_sale(input_.get("sale")),  # оплата на сайте
        "photoUrl": None,
    }
    _state().shelf.insert(0, item)
    _commit([item["id"]])
    return _shelf_view(user, item)


def update_shelf_item(actor: Actor, id_: ID, patch: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    item = next((x for x in _state().shelf if x["id"] == id_), None)
    if item is None:
        fail("not_found", "Этой вещи уже нет на полке")
    if not _owns(user, item["owner"]):
        fail("forbidden", "Изменить вещь может только её владелец")
    errors = _validate_shelf(patch, True)
    used = _in_use(item["id"])
    quantity = parse_number(patch.get("quantity"))
    if "quantity" in patch and quantity is not None and quantity < used:
        errors["quantity"] = f"Сейчас на руках {_pieces(used)}, меньше указать нельзя"
    if errors:
        fail("validation", "Проверьте поля формы", errors)
    if "name" in patch:
        item["name"] = _trim(patch["name"], 60)
    if "kind" in patch:
        item["kind"] = patch["kind"]
    if "sportId" in patch:
        item["sportId"] = patch["sportId"] or None
    if "quantity" in patch:
        item["quantity"] = quantity
    if "condition" in patch:
        item["condition"] = patch["condition"]
    if "districtId" in patch:
        item["districtId"] = patch["districtId"] or None
    if "terms" in patch:
        item["terms"] = list(dict.fromkeys(patch["terms"]))
    if "note" in patch:
        item["note"] = _trim(patch["note"], 300)
    if "sale" in patch:
        item["sale"] = payments.clean_sale(patch["sale"])  # оплата на сайте
    item["updatedAt"] = _stamp()
    _commit([item["id"]])
    return _shelf_view(user, item)


def delete_shelf_item(actor: Actor, id_: ID) -> Entity:
    """Убрать с полки можно, когда всё вернули. Ждущие просьбы закрываются с понятной причиной."""
    user = _require_person(actor)
    inv = _state()
    item = next((x for x in inv.shelf if x["id"] == id_), None)
    if item is None:
        return {"id": id_}
    if not _owns(user, item["owner"]):
        fail("forbidden", "Убрать вещь может только её владелец")
    used = _in_use(item["id"])
    if used > 0:
        fail("bad_state", f"Сейчас на руках {_pieces(used)}. Отметьте, что их вернули, и уберите вещь")
    payments.assert_no_open_orders(item)  # оплата на сайте
    for loan in [x for x in inv.loans if x["itemId"] == item["id"] and x["status"] == "pending"]:
        loan["status"] = "rejected"
        loan["reason"] = "Владелец убрал вещь с полки"
        loan["decidedAt"] = _stamp()
        _notify(
            [loan["requesterId"]],
            "gear_rejected",
            "Инвентарь не дадут",
            f"«{item['name']}» убрали с полки. Поищите у других.",
            f"/events/{loan['eventId']}#inventory",
        )
    inv.shelf = [x for x in inv.shelf if x is not item]
    _commit([item["id"]])
    return {"id": id_}


# ---------- Просьбы дать вещь на событие ----------


def _loan_view(actor: Actor, loan: Entity) -> Entity:
    inv = _state()
    item = next((i for i in inv.shelf if i["id"] == loan["itemId"]), None)
    e = store.data().record("events", loan["eventId"])
    is_requester = actor is not None and actor["id"] == loan["requesterId"]
    ref: Entity = item["owner"] if item is not None else {"kind": "user", "id": ""}
    line = next((x for x in inv.lines if x["id"] == loan["lineId"]), None)
    return {
        **loan,
        "item": {
            "id": loan["itemId"],
            "name": item["name"] if item is not None else "Вещь убрали с полки",
            "kind": item["kind"] if item is not None else "other",
        },
        "ownerView": _owner_view(ref),
        "requester": _person(loan["requesterId"]),
        "event": {
            "id": e["id"],
            "title": e["title"],
            "startsAt": e["startsAt"],
            "state": core.domain.event_state(e),
        }
        if e is not None
        else {
            "id": loan["eventId"],
            "title": "Событие удалено",
            "startsAt": loan["createdAt"],
            "state": "deleted",
        },
        "lineName": line["name"] if line is not None else None,
        "isOwner": _owns(actor, ref),
        "isRequester": is_requester,
        "contact": _owner_contact(ref) if is_requester and loan["status"] == "accepted" else None,
    }


LOAN_RANK: dict[str, int] = {"pending": 0, "accepted": 1, "returned": 2, "rejected": 3, "cancelled": 4}


def list_loans(actor: Actor, p: dict[str, Any]) -> list[Entity]:
    user = _require_user(actor)
    inv = _state()
    loans = inv.loans
    if p.get("role") == "incoming":
        mine = {i["id"] for i in inv.shelf if _owns(user, i["owner"])}
        loans = [x for x in loans if x["itemId"] in mine]
    else:
        loans = [x for x in loans if x["requesterId"] == user["id"]]
    if p.get("eventId"):
        loans = [x for x in loans if x["eventId"] == p["eventId"]]
    views = [_loan_view(user, x) for x in loans]
    views.sort(key=lambda v: (LOAN_RANK[v["status"]], _newest_first(v["createdAt"])))
    return views


def request_loan(actor: Actor, item_id: ID, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    inv = _state()
    item = next((i for i in inv.shelf if i["id"] == item_id), None)
    if item is None:
        fail("not_found", "Этой вещи уже нет на полке")
    if _owns(user, item["owner"]):
        fail("bad_request", "Это ваша вещь. Отметьте в событии, что возьмёте её с собой")
    if not input_.get("eventId"):
        fail("validation", "Выберите событие", {"eventId": "Выберите, на какое событие нужна вещь"})
    e = _get_event(input_["eventId"])
    _require_upcoming(e)
    if not _is_player(user, e):
        fail("forbidden", "Попросить вещь на событие могут его участники и организатор")
    quantity = parse_number(input_.get("quantity"))
    available = max(0, item["quantity"] - _in_use(item["id"]))
    if not isinstance(quantity, int) or quantity < 1:
        fail("validation", "Укажите, сколько нужно", {"quantity": "Хотя бы одна штука"})
    if quantity > available:
        fail(
            "full",
            f"Сейчас свободно только {_pieces(available)}" if available else "Сейчас все вещи на руках",
            {"quantity": f"Не больше {available}"},
        )
    twin = next(
        (
            x
            for x in inv.loans
            if x["itemId"] == item["id"]
            and x["eventId"] == e["id"]
            and x["requesterId"] == user["id"]
            and x["status"] in ["pending", "accepted"]
        ),
        None,
    )
    if twin is not None:
        fail(
            "duplicate",
            "Вы уже попросили эту вещь, ждём ответа владельца"
            if twin["status"] == "pending"
            else "Эту вещь вам уже дают на это событие",
        )
    lines = [x for x in inv.lines if x["eventId"] == e["id"]]
    if input_.get("lineId"):
        found = next((x for x in lines if x["id"] == input_["lineId"]), None)
        if found is None:
            fail("not_found", "Такой строки в списке нет. Обновите страницу")
    else:
        # Строка не указана — вещь закрывает первую строку того же типа.
        found = next((x for x in lines if x["kind"] == item["kind"]), None)
    loan: Entity = {
        "id": store.next_id("gn"),
        "itemId": item["id"],
        "eventId": e["id"],
        "lineId": found["id"] if found is not None else None,
        "requesterId": user["id"],
        "quantity": quantity,
        "comment": _trim(input_.get("comment"), 300),
        "status": "pending",
        "reason": "",
        "createdAt": _stamp(),
        "decidedAt": None,
        "returnedAt": None,
    }
    inv.loans.insert(0, loan)
    _notify(
        _owner_ids(item["owner"]),
        "gear_request",
        "Просят инвентарь",
        f"{user['name']} просит «{item['name']}», {_pieces(quantity)}, на «{e['title']}» ({{{{date:{e['startsAt']}}}}}).",
        "/inventory?tab=mine",
    )
    _commit([loan["id"], e["id"]])
    return _loan_view(user, loan)


def _own_loan(actor: Actor, id_: ID) -> tuple[Entity, Entity, Entity | None]:
    user = _require_person(actor)
    inv = _state()
    loan = next((x for x in inv.loans if x["id"] == id_), None)
    if loan is None:
        fail("not_found", "Просьба не найдена")
    return user, loan, next((i for i in inv.shelf if i["id"] == loan["itemId"]), None)


def decide_loan(actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    user, loan, item = _own_loan(actor, id_)
    if item is None or not _owns(user, item["owner"]):
        fail("forbidden", "Решение принимает владелец вещи")
    choice = input_.get("decision")
    decision = "accepted" if choice == "accept" else "rejected" if choice == "reject" else None
    if decision is None:
        fail("bad_request", "Неизвестное решение")
    if loan["status"] == decision:
        return _loan_view(user, loan)
    if loan["status"] != "pending":
        fail(
            "already_decided",
            "Просьбу уже отменили" if loan["status"] == "cancelled" else "По этой просьбе уже есть решение",
        )
    e = store.data().record("events", loan["eventId"])
    if decision == "accepted":
        if e is not None:
            _require_upcoming(e)
        available = item["quantity"] - _in_use(item["id"])
        if available < loan["quantity"]:
            fail(
                "full",
                f"Свободно только {_pieces(available)}" if available > 0 else "Все вещи сейчас на руках",
            )
    loan["status"] = decision
    loan["reason"] = _trim(input_.get("reason"), 300) if decision == "rejected" else ""
    loan["decidedAt"] = _stamp()
    from_ = _owner_view(item["owner"])["name"]
    title = e["title"] if e is not None else "событие"
    if decision == "accepted":
        _notify(
            [loan["requesterId"]],
            "gear_accepted",
            "Вам дадут инвентарь",
            f"{_q(from_)} даст «{item['name']}», {_pieces(loan['quantity'])}, на «{title}». "
            "Договоритесь о передаче по телефону в карточке просьбы.",
            f"/events/{loan['eventId']}#inventory",
        )
        if e is not None:
            others = [x for x in organizer_ids(e) if x != loan["requesterId"]]
            _notify(
                others,
                "gear_accepted",
                "Инвентарь для вашего события",
                f"{_q(from_)} даст «{item['name']}», {_pieces(loan['quantity'])}, на «{title}».",
                f"/events/{loan['eventId']}#inventory",
            )
    else:
        reason = f" Причина: {loan['reason']}" if loan["reason"] else ""
        _notify(
            [loan["requesterId"]],
            "gear_rejected",
            "Инвентарь не дадут",
            f"{_q(from_)} не сможет дать «{item['name']}» на «{title}».{reason} Поищите у других на полке.",
            f"/events/{loan['eventId']}#inventory",
        )
    _commit([loan["id"], loan["eventId"]])
    return _loan_view(user, loan)


def cancel_loan(actor: Actor, id_: ID) -> Entity:
    user, loan, item = _own_loan(actor, id_)
    if loan["requesterId"] != user["id"]:
        fail("forbidden", "Отменить просьбу может только тот, кто просил")
    if loan["status"] == "cancelled":
        return _loan_view(user, loan)
    if loan["status"] not in ["pending", "accepted"]:
        fail("bad_state", "Эту просьбу уже не отменить")
    loan["status"] = "cancelled"
    loan["decidedAt"] = _stamp()
    if item is not None:
        _notify(
            _owner_ids(item["owner"]),
            "gear_cancelled",
            "Просьбу отменили",
            f"{user['name']}: просьба «{item['name']}», {_pieces(loan['quantity'])}, отменена. Вещи снова свободны.",
            "/inventory?tab=mine",
        )
    _commit([loan["id"], loan["eventId"]])
    return _loan_view(user, loan)


def return_loan(actor: Actor, id_: ID) -> Entity:
    user, loan, item = _own_loan(actor, id_)
    if item is None or not _owns(user, item["owner"]):
        fail("forbidden", "Отметить возврат может владелец вещи")
    if loan["status"] == "returned":
        return _loan_view(user, loan)
    if loan["status"] != "accepted":
        fail("bad_state", "Вернуть можно только то, что выдали")
    loan["status"] = "returned"
    loan["returnedAt"] = _stamp()
    _notify(
        [loan["requesterId"]],
        "gear_returned",
        "Выдача закрыта",
        f"«{item['name']}», {_pieces(loan['quantity'])}: владелец получил вещи обратно. Выдача закрыта.",
        f"/events/{loan['eventId']}#inventory",
    )
    _commit([loan["id"], loan["eventId"]])
    return _loan_view(user, loan)


# ---------- Помощь от партнёров ----------


def _offer_view(o: Entity) -> Entity:
    return {
        **o,
        "sponsor": _owner_view({"kind": "org", "id": o["sponsorOrgId"]}),
        "person": _person(o["userId"]),
    }


def _support_view(actor: Actor, n: Entity) -> Entity:
    club = _org(n["orgId"])
    is_owner = actor is not None and club is not None and club["ownerId"] == actor["id"]
    sponsors = (
        [o for o in _approved_orgs_of(actor["id"]) if o["type"] == "sponsor"] if actor is not None else []
    )
    sponsor_ids = {s["id"] for s in sponsors}
    is_admin = actor is not None and actor["role"] == "admin"
    visible = [
        o
        for o in n["offers"]
        if is_owner or o["sponsorOrgId"] in sponsor_ids or o["status"] == "accepted" or is_admin
    ]
    mine = next(
        (o for o in n["offers"] if o["sponsorOrgId"] in sponsor_ids and o["status"] != "withdrawn"), None
    )
    e = store.data().record("events", n["eventId"]) if n["eventId"] else None
    deadline = clock.parse(n["deadline"]) if n["deadline"] else None
    return {
        **n,
        "org": _owner_view({"kind": "org", "id": n["orgId"]}),
        "event": {
            "id": e["id"],
            "title": e["title"],
            "startsAt": e["startsAt"],
            "state": core.domain.event_state(e),
        }
        if e is not None
        else None,
        "offers": [_offer_view(o) for o in visible],
        "closedBy": _owner_view({"kind": "org", "id": n["closedByOrgId"]}) if n["closedByOrgId"] else None,
        "isOwner": is_owner,
        "myOffer": _offer_view(mine) if mine is not None else None,
        "offerAs": [
            {"id": s["id"], "name": s["name"]}
            for s in sponsors
            if not any(o["sponsorOrgId"] == s["id"] and o["status"] != "withdrawn" for o in n["offers"])
        ]
        if n["status"] == "open"
        else [],
        "overdue": n["status"] == "open" and deadline is not None and deadline < clock.now(),
    }


SUPPORT_RANK: dict[str, int] = {"open": 0, "closed": 1, "cancelled": 2}


def list_support(actor: Actor, p: dict[str, Any]) -> list[Entity]:
    needs = _state().support
    if p.get("city"):
        org_ids = {o["id"] for o in store.data().organizations if o.get("city") == p["city"]}
        needs = [n for n in needs if n["orgId"] in org_ids]
    if p.get("mine"):
        user = _require_user(actor)
        mine = {o["id"] for o in store.data().organizations if o["ownerId"] == user["id"]}
        needs = [
            n for n in needs if n["orgId"] in mine or any(o["sponsorOrgId"] in mine for o in n["offers"])
        ]
    else:
        # Снятые просьбы видит только сам клуб.
        needs = [
            n for n in needs if n["status"] != "cancelled" or _owns(actor, {"kind": "org", "id": n["orgId"]})
        ]
    if p.get("orgId"):
        needs = [n for n in needs if n["orgId"] == p["orgId"]]
    if p.get("sponsorId"):
        needs = [n for n in needs if n["closedByOrgId"] == p["sponsorId"]]
    if p.get("eventId"):
        needs = [n for n in needs if n["eventId"] == p["eventId"]]
    if p.get("status") and p["status"] != "all":
        needs = [n for n in needs if n["status"] == p["status"]]
    views = [_support_view(actor, n) for n in needs]
    views.sort(key=lambda v: (SUPPORT_RANK[v["status"]], _newest_first(v["createdAt"])))
    return views


def create_support(actor: Actor, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    club = _org(input_["orgId"]) if input_.get("orgId") else None
    if club is None:
        fail("validation", "Выберите организацию", {"orgId": "Выберите клуб"})
    if club["ownerId"] != user["id"]:
        fail("forbidden", "Просить о помощи может только представитель клуба")
    if club["status"] != "approved":
        fail("org_not_approved", "Просить партнёров о помощи можно после допуска организации")
    if club["type"] == "sponsor":
        fail("forbidden", "Партнёр помогает сам и не публикует просьбы")
    errors: dict[str, str] = {}
    title = _trim(input_.get("title"), 140)
    if len(title) < 5:
        errors["title"] = "Напишите, что нужно и сколько: например, «Нужны 2 мяча и 10 мест в зале»"
    deadline: str | None = None
    if _given(input_.get("deadline")):
        d = clock.parse(input_["deadline"])
        if d is None:
            errors["deadline"] = "Дата не распознана"
        elif d < clock.now():
            errors["deadline"] = "Срок уже прошёл. Выберите дату в будущем"
        else:
            deadline = clock.iso(d)
    event_id: ID | None = None
    if input_.get("eventId"):
        e = _get_event(input_["eventId"])
        if e["organizer"]["kind"] != "org" or e["organizer"]["id"] != club["id"]:
            errors["eventId"] = "Выберите событие этого клуба"
        elif core.domain.event_state(e) != "upcoming":
            errors["eventId"] = "Событие уже прошло или отменено"
        else:
            event_id = e["id"]
    if errors:
        fail("validation", "Проверьте поля формы", errors)
    need: Entity = {
        "id": store.next_id("sn"),
        "orgId": club["id"],
        "eventId": event_id,
        "title": title,
        "details": _trim(input_.get("details"), 600),
        "deadline": deadline,
        "status": "open",
        "offers": [],
        "closedByOrgId": None,
        "closedAt": None,
        "createdBy": user["id"],
        "createdAt": _stamp(),
    }
    _state().support.insert(0, need)
    sponsor_owners = [
        o["ownerId"]
        for o in store.data().organizations
        if o["type"] == "sponsor" and o["status"] == "approved"
    ]
    _notify(
        sponsor_owners,
        "support_new",
        "Клубу нужна помощь",
        f"{_q(club['name'])}: {title}.",
        "/inventory?tab=needs",
    )
    _commit([need["id"]])
    return _support_view(user, need)


def _get_support(id_: ID) -> Entity:
    found = next((n for n in _state().support if n["id"] == id_), None)
    return found if found is not None else fail("not_found", "Просьба о помощи не найдена")


def offer_support(actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    need = _get_support(id_)
    sponsor = _org(input_["orgId"]) if input_.get("orgId") else None
    if sponsor is None:
        fail("validation", "Выберите, от чьего имени помогаете", {"orgId": "Выберите партнёра"})
    if sponsor["ownerId"] != user["id"] or sponsor["type"] != "sponsor":
        fail(
            "forbidden",
            "Откликаться могут партнёры. Зарегистрируйте организацию с типом «Спонсор или партнёр»",
        )
    if sponsor["status"] != "approved":
        fail("org_not_approved", "Откликаться можно после допуска партнёра администратором")
    if need["status"] != "open":
        fail("bad_state", "Клубу уже помогли" if need["status"] == "closed" else "Клуб снял просьбу")
    comment = _trim(input_.get("comment"), 400)
    if len(comment) < 5:
        fail(
            "validation",
            "Напишите, чем поможете",
            {"comment": "Например: «Дадим 2 мяча на сезон, привезём в субботу»"},
        )
    existing = next(
        (o for o in need["offers"] if o["sponsorOrgId"] == sponsor["id"] and o["status"] != "withdrawn"), None
    )
    if existing is not None:
        if existing["status"] != "pending":
            fail("already_decided", "Клуб уже ответил на ваш отклик")
        existing["comment"] = comment
        existing["at"] = _stamp()
    else:
        need["offers"].append(
            {
                "id": store.next_id("so"),
                "sponsorOrgId": sponsor["id"],
                "userId": user["id"],
                "comment": comment,
                "status": "pending",
                "at": _stamp(),
                "decidedAt": None,
            }
        )
    club = _org(need["orgId"])
    _notify(
        [club["ownerId"]] if club is not None else [],
        "support_offer",
        "Партнёр готов помочь",
        f"{_q(sponsor['name'])} откликнулся на просьбу «{need['title']}»: {comment}",
        f"/org/{need['orgId']}#support",
    )
    _commit([need["id"]])
    return _support_view(user, need)


def decide_offer(actor: Actor, id_: ID, offer_id: ID, input_: dict[str, Any]) -> Entity:
    user = _require_person(actor)
    need = _get_support(id_)
    club = _org(need["orgId"])
    if club is None or club["ownerId"] != user["id"]:
        fail("forbidden", "Решение принимает представитель клуба")
    offer = next((o for o in need["offers"] if o["id"] == offer_id), None)
    if offer is None:
        fail("not_found", "Отклик не найден")
    choice = input_.get("decision")
    decision = "accepted" if choice == "accept" else "declined" if choice == "decline" else None
    if decision is None:
        fail("bad_request", "Неизвестное решение")
    if offer["status"] == decision:
        return _support_view(user, need)
    if offer["status"] != "pending":
        fail(
            "already_decided",
            "Партнёр отозвал отклик"
            if offer["status"] == "withdrawn"
            else "По этому отклику уже есть решение",
        )
    if need["status"] != "open":
        fail("bad_state", "Просьба уже закрыта")
    at = _stamp()
    offer["status"] = decision
    offer["decidedAt"] = at
    sponsor = _org(offer["sponsorOrgId"])
    if decision == "accepted":
        need["status"] = "closed"
        need["closedByOrgId"] = offer["sponsorOrgId"]
        need["closedAt"] = at
        _notify(
            [offer["userId"]],
            "support_accepted",
            "Клуб принял помощь",
            f"{_q(club['name'])} принял вашу помощь: «{need['title']}». "
            "На странице клуба теперь видно, что вы поддержали его.",
            "/inventory?tab=needs",
        )
        for other in [o for o in need["offers"] if o["status"] == "pending"]:
            other["status"] = "declined"
            other["decidedAt"] = at
            _notify(
                [other["userId"]],
                "support_declined",
                "Клубу уже помогли",
                f"{_q(club['name'])} договорился с другим партнёром: «{need['title']}». Спасибо за отклик.",
                "/inventory?tab=needs",
            )
    else:
        _notify(
            [offer["userId"]],
            "support_declined",
            "Клуб выбрал другой вариант",
            f"{_q(club['name'])} не принял отклик {_q(sponsor['name'] if sponsor is not None else 'партнёра')} "
            f"на «{need['title']}».",
            "/inventory?tab=needs",
        )
    _commit([need["id"]], ["organizations"])
    return _support_view(user, need)


def withdraw_offer(actor: Actor, id_: ID, offer_id: ID) -> Entity:
    user = _require_person(actor)
    need = _get_support(id_)
    offer = next((o for o in need["offers"] if o["id"] == offer_id), None)
    if offer is None:
        fail("not_found", "Отклик не найден")
    sponsor = _org(offer["sponsorOrgId"])
    if sponsor is None or sponsor["ownerId"] != user["id"]:
        fail("forbidden", "Отозвать отклик может только партнёр")
    if offer["status"] == "withdrawn":
        return _support_view(user, need)
    if offer["status"] != "pending":
        fail("already_decided", "Клуб уже ответил на отклик")
    offer["status"] = "withdrawn"
    offer["decidedAt"] = _stamp()
    _commit([need["id"]])
    return _support_view(user, need)


def cancel_support(actor: Actor, id_: ID) -> Entity:
    user = _require_person(actor)
    need = _get_support(id_)
    club = _org(need["orgId"])
    if club is None or club["ownerId"] != user["id"]:
        fail("forbidden", "Снять просьбу может только представитель клуба")
    if need["status"] == "cancelled":
        return _support_view(user, need)
    if need["status"] != "open":
        fail("bad_state", "Просьба уже закрыта партнёром")
    need["status"] = "cancelled"
    at = _stamp()
    for o in [x for x in need["offers"] if x["status"] == "pending"]:
        o["status"] = "declined"
        o["decidedAt"] = at
        _notify(
            [o["userId"]],
            "support_declined",
            "Клуб снял просьбу",
            f"{_q(club['name'])} снял просьбу «{need['title']}». Спасибо за отклик.",
            "/inventory?tab=needs",
        )
    _commit([need["id"]])
    return _support_view(user, need)


# ---------- Кто я для полки ----------


def inventory_me(actor: Actor) -> Entity:
    if actor is None:
        return {
            "userId": None,
            "shareAs": [],
            "clubs": [],
            "sponsors": [],
            "events": [],
            "incomingPending": 0,
        }
    approved = _approved_orgs_of(actor["id"])
    now = clock.now()

    def upcoming_for_actor(e: Entity) -> bool:
        if core.domain.event_state(e) != "upcoming":
            return False
        starts = clock.parse(e["startsAt"])
        return starts is not None and starts > now and _is_player(actor, e)

    database = store.data()
    org_ids = {o["id"] for o in database.organizations if o["ownerId"] == actor["id"]}
    org_ids.update(m["orgId"] for m in database.engagement.managers if m["userId"] == actor["id"])
    event_ids = {
        p["eventId"]
        for p in database.participations
        if p["userId"] == actor["id"] and p["status"] == "confirmed"
    }
    table = COLLECTIONS["events"].table
    related = sa.or_(
        sa.and_(table.c.organizer_kind == "user", table.c.organizer_id == actor["id"]),
        sa.and_(table.c.organizer_kind == "org", table.c.organizer_id.in_(org_ids)),
        table.c.id.in_(event_ids),
    )
    upcoming = sorted(
        database.records("events", related, table.c.starts_at > now, predicate=upcoming_for_actor),
        key=lambda e: moment(e["startsAt"]),
    )
    events = [
        {
            "id": e["id"],
            "title": e["title"],
            "startsAt": e["startsAt"],
            "isOrganizer": core.domain.is_organizer(actor, e),
        }
        for e in upcoming[:20]
    ]
    mine_items = {i["id"] for i in _state().shelf if _owns(actor, i["owner"])}
    return {
        "userId": actor["id"],
        "shareAs": [_to_org(o) for o in approved],
        "clubs": [_to_org(o) for o in approved if o["type"] != "sponsor"],
        "sponsors": [_to_org(o) for o in approved if o["type"] == "sponsor"],
        "events": events,
        "incomingPending": sum(
            1 for x in _state().loans if x["itemId"] in mine_items and x["status"] == "pending"
        ),
    }


# ---------- Подключение к API ----------


def inventory_resources(actor: Callable[[], Actor]) -> Resources:
    """Ресурсы для getList / getOne / create / update / deleteOne."""
    return Resources(
        listers={
            "shelf": lambda p: Listed(
                list_shelf(actor(), p),
                ["q", "kind", "sportId", "districtId", "mine", "ownerOrgId", "eventId", "city"],
            ),
            "gear-loans": lambda p: Listed(list_loans(actor(), p), ["role", "eventId"]),
            "support-needs": lambda p: Listed(
                list_support(actor(), p),
                ["status", "orgId", "sponsorId", "mine", "eventId", "city"],
            ),
        },
        getters={
            "shelf": lambda id_, meta=None: shelf_item(actor(), id_),  # noqa: ARG005
            "support-needs": lambda id_, meta=None: _support_view(actor(), _get_support(id_)),  # noqa: ARG005
        },
        creators={
            "shelf": lambda v: create_shelf_item(actor(), v),
            "support-needs": lambda v: create_support(actor(), v),
        },
        updaters={
            "shelf": lambda id_, v: update_shelf_item(actor(), id_, v),
        },
        deleters={
            "shelf": lambda id_: delete_shelf_item(actor(), id_),
        },
    )


def inventory_routes(actor: Callable[[], Actor]) -> list[Route]:
    """Действия API (custom): адрес без /api и обработчик."""
    return [
        route("get", r"^/events/([^/]+)/gear$", lambda p, _b, _query: event_gear(actor(), p[0])),
        route(
            "put",
            r"^/events/([^/]+)/gear/([^/]+)/pledge$",
            lambda p, b, _query: set_pledge(actor(), p[0], p[1], b),
        ),
        route("post", r"^/shelf/([^/]+)/request$", lambda p, b, _query: request_loan(actor(), p[0], b)),
        route("post", r"^/gear-loans/([^/]+)/decide$", lambda p, b, _query: decide_loan(actor(), p[0], b)),
        route("post", r"^/gear-loans/([^/]+)/cancel$", lambda p, _b, _query: cancel_loan(actor(), p[0])),
        route("post", r"^/gear-loans/([^/]+)/return$", lambda p, _b, _query: return_loan(actor(), p[0])),
        route(
            "post", r"^/support-needs/([^/]+)/offer$", lambda p, b, _query: offer_support(actor(), p[0], b)
        ),
        route(
            "post",
            r"^/support-needs/([^/]+)/offers/([^/]+)/decide$",
            lambda p, b, _query: decide_offer(actor(), p[0], p[1], b),
        ),
        route(
            "post",
            r"^/support-needs/([^/]+)/offers/([^/]+)/withdraw$",
            lambda p, _b, _query: withdraw_offer(actor(), p[0], p[1]),
        ),
        route(
            "post", r"^/support-needs/([^/]+)/cancel$", lambda p, _b, _query: cancel_support(actor(), p[0])
        ),
        route("get", r"^/inventory/me$", lambda _p, _b, _query: inventory_me(actor())),
    ]
