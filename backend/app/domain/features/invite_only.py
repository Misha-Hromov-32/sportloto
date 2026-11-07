"""С13. Корпоративный спорт, облегчённо.

Встреча «по приглашению» не попадает в ленту, поиск, на карту и в аналитику и открывается только
по ссылке с кодом. Кто открыл действующую ссылку, тот получает доступ; после «Сменить ссылку» старая
перестаёт работать. Компания может «Пригласить своих» — зарегистрированных людей по почте или имени.
"""

import copy
import re
import secrets
from collections.abc import Callable
from typing import Any

from app.domain import clock, store
from app.domain.errors import fail
from app.domain.features import stop_list
from app.domain.features.participation_host import ParticipationHost, date_token, input_text, my_participation
from app.domain.lib.text import initials, normalize, short_name
from app.domain.routing import Route, route
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

INVITE_REQUIRED = "Встреча закрытая. Попросите приглашение у организатора"
INVITE_EXPIRED = "Ссылка-приглашение больше не действует. Попросите у организатора новую"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_PEOPLE = 30

_SEPARATORS = re.compile(r"[\n,;]+")


def is_invite_only(e: Entity) -> bool:
    return e.get("visibility") == "invite"


def clean_visibility(value: Any) -> str:
    return "invite" if value == "invite" else "public"


def new_invite_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def grants(db: store.Database) -> list[Entity]:
    return db.invite_grants


def visibility_fields(input_: dict[str, Any]) -> Entity:
    """Поля для новой встречи: код появляется только у закрытой."""
    visibility = clean_visibility(input_.get("visibility"))
    return (
        {"visibility": visibility, "inviteCode": new_invite_code()}
        if visibility == "invite"
        else {"visibility": visibility}
    )


def visibility_patch(patch: dict[str, Any], e: Entity) -> Entity:
    """Правка: закрыть встречу (появится код) или открыть её для всех."""
    if "visibility" not in patch:
        return {}
    visibility = clean_visibility(patch["visibility"])
    if visibility == clean_visibility(e.get("visibility")):
        return {}
    if visibility == "invite":
        return {"visibility": visibility, "inviteCode": e.get("inviteCode") or new_invite_code()}
    return {"visibility": visibility}


def invite_view_fields(e: Entity, privileged: bool) -> Entity:
    """Код ссылки видят только организатор и администратор."""
    return {
        "visibility": clean_visibility(e.get("visibility")),
        "inviteCode": (e.get("inviteCode") or "") if privileged else "",
    }


def has_invite_access(db: store.Database, actor: Actor, e: Entity, is_organizer: bool) -> bool:
    """Откуда человек мог узнать о закрытой встрече: запись, приглашение, команда, действующая ссылка."""
    if not is_invite_only(e):
        return True
    if actor is None:
        return False
    if actor["role"] == "admin" or is_organizer:
        return True
    if my_participation(db, actor["id"], e["id"]) is not None:
        return True
    if any(i["eventId"] == e["id"] and i["toUserId"] == actor["id"] for i in db.invites):
        return True
    if any(
        t["eventId"] == e["id"] and any(m["userId"] == actor["id"] for m in t["members"])
        for t in db.event_teams
    ):
        return True
    return any(
        g["eventId"] == e["id"] and g["userId"] == actor["id"] and g["code"] == e.get("inviteCode")
        for g in grants(db)
    )


def invite_block(db: store.Database, actor: Actor, e: Entity, is_organizer: bool) -> dict[str, str] | None:
    """Для проверки «можно ли записаться»: без действующего приглашения нельзя."""
    return (
        None
        if has_invite_access(db, actor, e, is_organizer)
        else {"code": "invite_required", "reason": INVITE_REQUIRED}
    )


def assert_invite_access(
    db: store.Database,
    actor: Actor,
    e: Entity,
    is_organizer: bool,
    code: str | None = None,
) -> None:
    """Карточка закрытой встречи: без доступа и без верного кода — понятный отказ без деталей."""
    if has_invite_access(db, actor, e, is_organizer):
        return
    if code and code == e.get("inviteCode"):
        return
    fail(
        "invite_required",
        INVITE_EXPIRED if code else INVITE_REQUIRED,
        None,
        {"inviteExpired": bool(code), "signedIn": actor is not None},
    )


def redeem_invite(host: ParticipationHost, actor: Actor, event_id: ID, code: Any) -> bool:
    """Человек открыл действующую ссылку: запоминаем доступ.

    Чтобы встреча открывалась и без кода — из уведомлений и «Моих занятий».
    Возвращает True, если что-то изменилось.
    """
    if actor is None or not isinstance(code, str) or not code:
        return False
    e = host.event(event_id)
    if e is None or not is_invite_only(e) or code != e.get("inviteCode"):
        return False
    if any(
        g["eventId"] == e["id"] and g["userId"] == actor["id"] and g["code"] == code for g in grants(host.db)
    ):
        return False
    grants(host.db).append(
        {"eventId": e["id"], "userId": actor["id"], "code": code, "at": clock.iso(clock.now())}
    )
    host.commit([], [e["id"]])
    return True


def invite_path(e: Entity, extra: str = "") -> str:
    params = [
        p
        for p in [f"invite={e['inviteCode']}" if is_invite_only(e) and e.get("inviteCode") else "", extra]
        if p
    ]
    query = f"?{'&'.join(params)}" if params else ""
    return f"/events/{e['id']}{query}"


def require_organizer(host: ParticipationHost, actor: Actor, event_id: ID) -> tuple[Entity, Entity]:
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    e = host.event(event_id)
    if e is None:
        fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
    if not host.is_organizer(user, e) and user["role"] != "admin":
        fail("forbidden", "Ссылку-приглашение видит только организатор")
    return user, e


def is_company_event(db: store.Database, e: Entity) -> bool:
    if e["organizer"]["kind"] != "org":
        return False
    id_ = e["organizer"]["id"]
    org = next((o for o in db.organizations if o["id"] == id_), None)
    return (org or {}).get("type") == "company"


def invite_link_view(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    _, e = require_organizer(host, actor, event_id)
    code = (e.get("inviteCode") or "") if is_invite_only(e) else ""
    return {
        "visibility": clean_visibility(e.get("visibility")),
        "code": code,
        "path": invite_path(e),
        "company": is_company_event(host.db, e),
        "opened": sum(1 for g in grants(host.db) if g["eventId"] == e["id"] and g["code"] == code)
        if code
        else 0,
    }


def rotate_invite_code(host: ParticipationHost, actor: Actor, event_id: ID) -> Entity:
    """«Сменить ссылку»: старая перестаёт работать, записавшиеся и приглашённые доступ не теряют."""
    user, e = require_organizer(host, actor, event_id)
    if not host.is_organizer(user, e):
        fail("forbidden", "Сменить ссылку может только организатор")
    if not is_invite_only(e):
        fail("bad_state", "Встреча открыта для всех, ссылка-приглашение ей не нужна")
    if host.event_state(e) != "upcoming":
        fail("event_inactive", "Встреча уже прошла или отменена")
    code = new_invite_code()
    while code == e.get("inviteCode"):
        code = new_invite_code()
    e["inviteCode"] = code
    e["updatedAt"] = clock.iso(clock.now())
    host.commit(["events"], [e["id"]])
    return invite_link_view(host, actor, event_id)


def person_short(u: Entity) -> Entity:
    return {"id": u["id"], "name": u["name"], "avatarUrl": u["avatarUrl"], "initials": initials(u["name"])}


def suggest_people(host: ParticipationHost, actor: Actor, q: Any) -> list[Entity]:
    """Подсказки «кого позвать»: по имени или точной почте. Почту и телефон в ответ не отдаём."""
    user = actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")
    text = normalize(input_text(q))
    email = input_text(q).strip().lower()
    if len(text) < 2:
        return []
    rows = [
        {"u": u, "byEmail": "@" in email and u["email"].lower() == email}
        for u in host.db.users
        if u["role"] == "user" and u["id"] != user["id"]
    ]
    found = [
        row
        for row in rows
        if row["byEmail"]
        or any(w.startswith(text) for w in normalize(row["u"]["name"]).split(" "))
        or normalize(row["u"]["name"]).startswith(text)
    ][:6]

    def district_name(u: Entity) -> str:
        district = next((d for d in host.db.districts if d["id"] == u.get("districtId")), None)
        return district["name"] if district is not None else ""

    return [
        {**person_short(row["u"]), "hint": "Совпала почта" if row["byEmail"] else district_name(row["u"])}
        for row in found
    ]


def resolve_person(db: store.Database, entry: str) -> Entity | None:
    """Строка из списка — человек на платформе: id из подсказки, точная почта или полное имя без тёзок."""
    value = entry.strip()
    if not value:
        return None
    by_id = next((u for u in db.users if u["id"] == value), None)
    if by_id is not None:
        return by_id
    if "@" in value:
        return next((u for u in db.users if u["email"].lower() == value.lower()), None)
    same = [u for u in db.users if normalize(u["name"]) == normalize(value)]
    return same[0] if len(same) == 1 else None


def _entries(people: Any) -> list[str]:
    """Список из формы: массив строк или текст через запятую, точку с запятой или с новой строки."""
    if isinstance(people, str):
        raw: list[Any] = _SEPARATORS.split(people)
    elif isinstance(people, list):
        raw = people
    else:
        raw = []
    return [x.strip() for x in raw if isinstance(x, str) and x.strip()]


def invite_own(host: ParticipationHost, actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
    """«Пригласить своих»: компания зовёт сотрудников списком. Приглашённые на встречу по заявке не ждут одобрения."""
    user, e = require_organizer(host, actor, event_id)
    if not host.is_organizer(user, e):
        fail("forbidden", "Пригласить может только организатор")
    if not is_company_event(host.db, e):
        fail("forbidden", "Пригласить своих списком может организация-компания")
    if host.event_state(e) != "upcoming":
        fail("event_inactive", "Встреча уже прошла или отменена")
    entries = _entries(input_.get("people"))
    if not entries:
        fail("validation", "Впишите почту или имя хотя бы одного человека", {"people": "Список пуст"})
    if len(entries) > MAX_PEOPLE:
        fail(
            "validation",
            f"За один раз можно пригласить до {MAX_PEOPLE} человек",
            {"people": "Слишком длинный список"},
        )

    result: Entity = {"sent": [], "already": [], "notFound": []}
    seen: set[ID] = set()
    now = clock.iso(clock.now())
    organizer_name = host.event_view(None, e)["organizerView"]["name"]
    for entry in entries:
        target = resolve_person(host.db, entry)
        if target is None or target["role"] != "user" or host.is_organizer(target, e):
            result["notFound"].append(entry)
            continue
        if target["id"] in seen:
            continue
        seen.add(target["id"])
        # Стоп-лист сильнее приглашения: сначала человека убирают из списка.
        if stop_list.is_stop_listed(host.db, target["id"], e, clock.now()):
            fail("stop_listed", f"{target['name']}: сначала уберите человека из стоп-листа")
        invited = any(i["eventId"] == e["id"] and i["toUserId"] == target["id"] for i in host.db.invites)
        mine = my_participation(host.db, target["id"], e["id"])
        if invited or (mine is not None and mine["status"] in ACTIVE_PARTICIPATION):
            result["already"].append(person_short(target))
            continue
        host.db.invites.append(
            {
                "id": host.next_id("inv"),
                "eventId": e["id"],
                "fromUserId": user["id"],
                "toUserId": target["id"],
                "companionId": None,
                "createdAt": now,
            }
        )
        host.notify(
            [target["id"]],
            "invite",
            f"Вас приглашает {organizer_name}",
            f"«{e['title']}», {date_token(e['startsAt'])}. Встреча закрытая, она открывается только по приглашению. Нажмите, чтобы посмотреть и записаться.",
            invite_path(e, "intent=join"),
        )
        result["sent"].append(person_short(target))
    if result["sent"]:
        host.commit(["invites", "notifications", "events"], [e["id"]])
    return result


def short_person(u: Entity | None) -> Entity:
    if u is not None:
        return {**person_short(u), "name": short_name(u["name"])}
    return {"id": "", "name": "Удалённый пользователь", "avatarUrl": None, "initials": "?"}


def seed_invite_only(
    data: dict[str, list[Entity]],
    at: Callable[[int, str], str],
    ago: Callable[[int], str],
) -> None:
    """Демо: компания «КрасТехСофт» и её представитель Ирина Павлова.

    Закрытый корпоративный волейбол с постоянной ссылкой (код KTS-VOLLEY) и тремя записавшимися сотрудниками.
    """
    day = 24 * 60
    base = next((u for u in data["users"] if u["id"] == "u-anna"), None)
    if base is None:
        return
    data["users"].append(
        {
            **copy.deepcopy(base),
            "id": "u-irina-p",
            "name": "Ирина Павлова",
            "age": 38,
            "gender": "female",
            "districtId": "d-center",
            "about": "Отвечаю за корпоративный спорт в «КрасТехСофт». Собираю коллег на волейбол и забеги.",
            "interests": ["s-volleyball", "s-running"],
            "levels": {"s-volleyball": "amateur"},
            "readiness": "organize",
            "email": "irina.pavlova@krastech.demo",
            "phone": "+7 913 555-40-12",
            "demo": {
                "title": "Представитель компании «КрасТехСофт»",
                "hint": "Закрытая встреча по ссылке-приглашению, «Пригласить своих»",
                "order": 9.5,
            },
            "createdAt": ago(90 * day),
        }
    )
    data["organizations"].append(
        {
            "id": "o-krastech",
            "name": "КрасТехСофт",
            "type": "company",
            "description": "IT-компания в центре Красноярска. Для сотрудников собираем волейбол по четвергам и ездим на забеги командой. Встречи закрытые, только по приглашению.",
            "sportIds": ["s-volleyball", "s-running"],
            "city": "Красноярск",
            "districtId": "d-center",
            "address": "ул. Ленина, 113, офис 501",
            "contacts": {"phone": "+7 391 215-40-12", "email": "sport@krastechsoft-kras.ru", "social": ""},
            "logoUrl": None,
            "ownerId": "u-irina-p",
            "status": "approved",
            "reviews": [
                {
                    "id": "or-kts-1",
                    "decision": "submitted",
                    "reason": "",
                    "adminId": None,
                    "at": ago(40 * day),
                },
                {
                    "id": "or-kts-2",
                    "decision": "approved",
                    "reason": "",
                    "adminId": "u-maria",
                    "at": ago(39 * day),
                },
            ],
            "createdWithAssistant": False,
            "aiFlag": "none",
            "aiReason": "",
            "createdAt": ago(40 * day),
            "updatedAt": ago(39 * day),
        }
    )
    volley = next((e for e in data["events"] if e["id"] == "e-volley-hall"), None)
    if volley is None:
        return
    data["events"].append(
        {
            **copy.deepcopy(volley),
            "id": "e-corp-volley",
            "title": "Корпоративный волейбол «КрасТехСофт»",
            "description": "Играем коллегами после работы: делимся на команды по 6, меняемся каждые 15 минут. Мячи и сетка наши. Можно позвать коллегу из другого отдела.",
            "organizer": {"kind": "org", "id": "o-krastech"},
            "createdBy": "u-irina-p",
            "startsAt": at(3, "19:00"),
            "durationMin": 120,
            "joinMode": "open",
            "capacity": 18,
            "minParticipants": None,
            "level": "any",
            "beginnersWelcome": True,
            "price": {"kind": "free"},
            "paymentNote": "",
            "cancelPolicy": {"kind": "anytime"},
            "status": "published",
            "moderation": None,
            "cancelReason": "",
            "changes": [],
            "series": None,
            "privateInfo": "Пропуск в зал по корпоративной карте. Телефон Ирины: +7 913 555-40-12.",
            "visibility": "invite",
            "inviteCode": "KTS-VOLLEY",
            "composition": "mixed",
            "createdAt": ago(3 * day),
            "updatedAt": ago(3 * day),
        }
    )
    for i, user_id in enumerate(["u-egor", "u-pavel", "u-nikita"]):
        data["participations"].append(
            {
                "id": f"p-corp-{i + 1}",
                "eventId": "e-corp-volley",
                "userId": user_id,
                "status": "confirmed",
                "prevStatus": None,
                "note": "",
                "rejectReason": "",
                "source": "invite",
                "createdAt": ago((2 * 24 - i) * 60),
                "decidedAt": ago((2 * 24 - i) * 60),
            }
        )


def invite_only_routes(host: Callable[[], ParticipationHost], actor: Callable[[], Actor]) -> list[Route]:
    return [
        route(
            "get", r"^/events/([^/]+)/invite-link$", lambda p, _b, _q: invite_link_view(host(), actor(), p[0])
        ),
        route(
            "post",
            r"^/events/([^/]+)/invite-link/rotate$",
            lambda p, _b, _q: rotate_invite_code(host(), actor(), p[0]),
        ),
        route("post", r"^/events/([^/]+)/invite-own$", lambda p, b, _q: invite_own(host(), actor(), p[0], b)),
        route("get", r"^/people/suggest$", lambda _p, _b, q: suggest_people(host(), actor(), q.get("q"))),
    ]
