"""Бизнес-правила платформы: события, запись, обсуждение, направления, организации, люди, уведомления.

Все права и переходы статусов живут здесь, а не в интерфейсе: экран показывает только то,
что разрешил сервер. Модули из `features` дополняют эти правила и обращаются к ним через `Domain`
и хост участия.
"""

# Хост участия обращается к закрытым методам Domain.
# ruff: noqa: SLF001

import re
import secrets
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta
from typing import Any

from app.assistant import config as assistant_config
from app.domain import assistant, bus, clock, store, text
from app.domain.errors import fail
from app.domain.features import (
    again,
    calendar,
    composition,
    family,
    favorites,
    greeter,
    inventory,
    invite_only,
    kit,
    managers,
    org_suspend,
    payments,
    plan_b,
    reliability,
    stop_list,
    team,
    urgent,
    venues,
    waitlist_offer,
)
from app.domain.features.participation_host import ParticipationHost
from app.domain.lib import demo_roles
from app.domain.lib.cities import city_by_id, city_by_name, city_of_point, default_city, point_in_city
from app.domain.lib.dates import (
    day_part,
    end_of_day,
    format_event_date,
    is_weekend,
    moment,
    start_of_day,
    weekend_bounds,
)
from app.domain.lib.event_rules import public_discussion, valid_event_image, valid_org_logo
from app.domain.lib.geo import distance_km
from app.domain.lib.labels import ORG_TYPE
from app.domain.lib.money import price_summary
from app.domain.lib.numbers import parse_number
from app.domain.lib.text import capitalize, edit_distance, initials, normalize, ru_sort_key, short_name
from app.domain.schema import COLLECTIONS
from app.domain.statuses import (
    ACTIVE_PARTICIPATION,
    CompanionStatus,
    EventStatus,
    JoinMode,
    MessageStatus,
    OrganizationStatus,
    ParticipationStatus,
)
from app.domain.types import ID, Actor, Entity

OPEN_STATES = ["upcoming", "live"]
# Не больше пяти сообщений в обсуждения за полминуты от одного человека.
MESSAGE_LIMIT = 5
MESSAGE_WINDOW = timedelta(seconds=30)
MAX_SERIES = 12
# За сколько часов до начала должен набраться порог сбора.
THRESHOLD_DEADLINE_HOURS = 24
CITY_CENTER = {"lat": 56.0106, "lng": 92.8526}
LEVELS = ["any", "beginner", "amateur", "experienced"]
INTENSITIES = ["low", "medium", "high"]
# Профиль: возраст — как в форме профиля, радиус «рядом со мной» — в километрах; готовность — «пойду» или «соберу».
PROFILE_AGE = range(14, 111)
PROFILE_RADIUS_KM = range(1, 51)
READINESS = ("join", "organize")

# Поля, которые организатор может менять через PUT /events/:id. Остальное (статус, организатор, пометки) — нет.
EVENT_PATCH_FIELDS = [
    "title",
    "description",
    "startsAt",
    "durationMin",
    "place",
    "level",
    "beginnersWelcome",
    "firstStep",
    "price",
    "paymentNote",
    "cancelPolicy",
    "joinMode",
    "capacity",
    "minParticipants",
    "privateInfo",
    "discussion",
    "extra",
    "coverUrl",
    # В4, Н1: площадка и дополнения к доступной среде
    "venueId",
    "accessExtras",
    # В7: состав
    "composition",
    # С13, Н6: по приглашению, с детьми
    "visibility",
    "family",
    # Оплата на сайте
    "paymentMode",
]

ISO_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z\Z")
_DATE_TOKEN_RE = re.compile(r"\{\{date:([^}]+)\}\}")
_HHMM_RE = re.compile(r"[0-9]{2}:[0-9]{2}")
_SPACES_RE = re.compile(r"\s+")


def _premoderate(text_: str) -> Entity:
    """Предмодерация работает, только если её включили в админке; иначе текст проходит без пометки."""
    if assistant_config.feature_on("premoderation"):
        return assistant.premoderate(text_)
    return {"flag": "none", "reason": ""}


def _premoderate_organization(input_: Entity) -> Entity:
    if assistant_config.feature_on("premoderation"):
        return assistant.premoderate_organization(input_)
    return {"flag": "none", "reason": ""}


def _date_in_text(text: str, match: re.Match[str], now: datetime) -> str:
    """Дата из токена: посреди предложения со строчной («до сегодня, 20 октября»), в начале — как есть."""
    at = clock.parse(match.group(1))
    if at is None:
        return match.group(1)
    label = format_event_date(at, now)
    before = text[: match.start()].rstrip()
    return label if not before or before[-1] in ".!?:\n" else label[:1].lower() + label[1:]


# EventQuery (фильтры ленты, SearchFilters из типов API) и дополнительно:
# scope ('feed' | 'participating' | 'organizing' | 'org' | 'user' | 'admin'), orgId, organizerUserId,
# sportId, point, ids, forYou (подборка «Для вас»: только события с объяснением, почему подходят),
# aiFlagged, status, access (Н1: «Нужна доступная среда» — все отмеченные условия).


def _rounded_km(a: Entity | None, b: Entity | None) -> float | None:
    """Расстояние в километрах с одним знаком; None, если точки или координат нет."""
    km = distance_km(a, b) if a is not None and b is not None else None
    return None if km is None else round(km, 1)


def _date_token(iso: str) -> str:
    """Дата в тексте уведомления хранится как ISO и подписывается при чтении («Завтра, 25 октября, 10:00»)."""
    return f"{{{{date:{iso}}}}}"


def _iso_now() -> str:
    """Текущий момент строкой ISO в UTC — так даты хранятся в записях."""
    return clock.iso(clock.now())


def _text(value: Any) -> str:
    """Текстовое поле запроса: строка как есть, число — его запись, всё остальное — пустая строка."""
    if isinstance(value, str):
        return value
    number = parse_number(value) if isinstance(value, int | float) else None
    return "" if number is None else str(number)


def _trim(value: Any, max_: int) -> str:
    return _text(value).strip()[:max_]


def _collapse(value: Any, max_: int) -> str:
    """Как `_trim`, но пробелы внутри схлопываются в один."""
    return _trim(_SPACES_RE.sub(" ", _text(value)), max_)


def _by_id(rows: Iterable[Entity], id_: Any) -> Entity | None:
    return next((r for r in rows if r["id"] == id_), None)


def _field(obj: Any, key: str) -> Any:
    """Поле вложенного объекта из запроса: у не-объекта полей нет."""
    return obj.get(key) if isinstance(obj, dict) else None


def _list(value: Any, field: str, message: str) -> list[Any]:
    """Список из запроса: None — пустой список, значение другого типа — ошибка проверки."""
    if value is None:
        return []
    if not isinstance(value, list):
        fail("validation", message, {field: message})
    return value


def _whole(value: Any, allowed: range) -> int | None:
    """Целое число из запроса в допустимых пределах; иначе None."""
    number = parse_number(value)
    return number if isinstance(number, int) and number in allowed else None


def _geo_point(value: Any) -> dict[str, float] | None:
    """Точка `{lat, lng}` из запроса с координатами в допустимых пределах; иначе None."""
    lat, lng = parse_number(_field(value, "lat")), parse_number(_field(value, "lng"))
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": lat, "lng": lng}


def _shown(sports: list[Entity]) -> list[Entity]:
    """Направления для выбора: скрытые администратором не предлагаются, старые встречи их сохраняют."""
    return [s for s in sports if not s.get("hidden")]


def _is_admin(actor: Actor) -> bool:
    return actor is not None and actor.get("role") == "admin"


def _moderation_reason(rule: Entity | None, comment: str) -> str:
    """Причина решения модератора одной строкой: пункт правил и комментарий — как в уведомлении."""
    return ". ".join(
        x for x in [f"правило {rule['number']}, «{rule['title']}»" if rule else "", comment] if x
    )


def _freeze_participations(ps: list[Entity]) -> None:
    """Снятие и удаление модератором: запись приостанавливается и остаётся у человека с пометкой,
    а прежний статус хранится, чтобы возврат события вернул и места, и заявки."""
    for p in ps:
        if p["status"] in ACTIVE_PARTICIPATION:
            p["prevStatus"] = p["status"]
            p["status"] = ParticipationStatus.EVENT_REMOVED


def _catalog_order(s: Entity) -> tuple[int, tuple[str, str]]:
    """Порядок направлений в каталоге: сначала популярные, внутри — по названию."""
    return (0 if s.get("popular") else 1, ru_sort_key(s["name"]))


def _when_range(when: Any, date: Any) -> tuple[datetime, datetime] | None:
    """Границы фильтра «Когда» по дням пояса отображения; None — без ограничения."""
    now = moment()
    if when == "today":
        return start_of_day(now), end_of_day(now)
    if when == "tomorrow":
        tomorrow = now + timedelta(days=1)
        return start_of_day(tomorrow), end_of_day(tomorrow)
    if when == "weekend":
        return weekend_bounds(now)
    if when == "week":
        return start_of_day(now), end_of_day(now + timedelta(days=7))
    if when == "date":
        day = clock.parse(date)
        return (start_of_day(day), end_of_day(day)) if day is not None else None
    return None


class _ParticipationHost:
    """Что модулям записи (состав, резерв, план Б, календарь, серия) нужно от доменного слоя."""

    def __init__(self, d: "Domain", *, read_events: bool = False) -> None:
        self._d = d
        self._read_events = read_events

    @property
    def db(self) -> store.Database:
        # Данные могут перечитаться из другой вкладки — берём текущие при каждом обращении
        return store.data()

    def next_id(self, prefix: str) -> str:
        return store.next_id(prefix)

    def user(self, id_: ID | None) -> Entity | None:
        return self._d.user(id_)

    def event(self, id_: ID) -> Entity | None:
        return self._d._event_for_read(id_) if self._read_events else self._d._event(id_)

    def event_state(self, e: Entity) -> str:
        return self._d.event_state(e)

    def confirmed_count(self, e: Entity) -> int:
        return self._d._counts(e)["confirmed"]

    def organizer_user_ids(self, e: Entity) -> list[ID]:
        return self._d._organizer_user_ids(e)

    def is_organizer(self, actor: Actor, e: Entity) -> bool:
        return self._d.is_organizer(actor, e)

    def actor_point(self, actor: Actor) -> dict[str, float] | None:
        return self._d._actor_point(actor)

    def can_join(self, actor: Actor, e: Entity) -> dict[str, Any]:
        return self._d.can_join(actor, e)

    def notify(self, user_ids: list[ID], type_: str, title: str, text: str, link: str) -> None:
        self._d._notify(user_ids, type_, title, text, link)

    def after_count_change(self, e: Entity, before: int) -> None:
        self._d._after_count_change(e, before)

    def promote_waitlist(self, e: Entity) -> list[ID]:
        return self._d._promote_waitlist(e)

    def join(self, actor: Actor, event_id: ID, input_: dict[str, Any] | None = None) -> Entity:
        return self._d.join(actor, event_id, input_)

    def leave(self, actor: Actor, event_id: ID, opts: dict[str, Any] | None = None) -> Entity:
        return self._d.leave(actor, event_id, opts)

    def event_view(self, actor: Actor, e: Entity) -> Entity:
        return self._d.event_view(actor, e)

    def event_details(self, actor: Actor, id_: ID) -> Entity:
        return self._d.event_details(actor, id_)

    def commit(self, resources: list[str], ids: list[ID]) -> None:
        self._d._commit(resources, ids)


class Domain:
    def __init__(self) -> None:
        # Когда человек писал в обсуждения в последние полминуты — для ограничения частоты.
        self._recent_messages: dict[str, list[datetime]] = {}

    @property
    def db(self) -> store.Database:
        return store.data()

    @property
    def assistant_context(self) -> dict[str, Any]:
        # Скрытые направления помощник не предлагает
        sports = [s for s in self.db.sports if not s.get("hidden")]
        return {"sports": sports, "districts": self.db.districts, "now": clock.now()}

    def render_text(self, text: str) -> str:
        """Подставляет даты в тексты уведомлений и системных сообщений относительно текущего дня."""
        if "{{date:" not in text:
            return text
        now = clock.now()
        return _DATE_TOKEN_RE.sub(lambda match: _date_in_text(text, match, now), text)

    def _format_change_value(self, value: str) -> str:
        if isinstance(value, str) and ISO_RE.search(value):
            return format_event_date(value, clock.now())
        return value

    # ---------- Справочники и поиск сущностей ----------

    def user(self, id_: ID | None) -> Entity | None:
        return _by_id(self.db.users, id_) if id_ else None

    def _get_user(self, id_: ID) -> Entity:
        u = self.user(id_)
        # Удалённый аккаунт: профиль не открывается, позвать человека нельзя.
        return u if u is not None and u["role"] != "deleted" else fail("not_found", "Пользователь не найден")

    def _sport(self, id_: ID | None) -> Entity | None:
        return _by_id(self.db.sports, id_)

    def _org(self, id_: ID | None) -> Entity | None:
        return _by_id(self.db.organizations, id_)

    def _get_org(self, id_: ID) -> Entity:
        o = self._org(id_)
        return o if o is not None else fail("not_found", "Организация не найдена. Проверьте ссылку")

    def _event(self, id_: ID | None) -> Entity | None:
        return self.db.record("events", id_) if id_ is not None else None

    def _event_for_read(self, id_: ID | None) -> Entity | None:
        """Bounded tracked lookup: full and partial in-transaction changes remain authoritative."""
        return self._event(id_)

    def _organizer_events_for_read(self, ref: Entity) -> list[Entity]:
        table = COLLECTIONS["events"].table
        return self.db.records(
            "events", table.c.organizer_kind == ref["kind"], table.c.organizer_id == ref["id"],
            predicate=lambda e: e["organizer"] == ref,
        )

    def _district(self, id_: ID | None) -> Entity | None:
        return _by_id(self.db.districts, id_)

    def _district_name(self, id_: ID | None) -> str | None:
        d = self._district(id_)
        return d["name"] if d is not None else None

    def _match_for(self, actor: Actor) -> Entity | None:
        """Контекст подбора для человека; у гостя и администратора подбора нет."""
        return (
            self._match_context(actor, self._event_for_read)
            if actor is not None and actor["role"] != "admin"
            else None
        )

    def _get_event(self, id_: ID | None) -> Entity:
        e = self._event(id_)
        return e if e is not None else fail("not_found", "Событие не найдено. Возможно, ссылка устарела")

    def _require_user(self, actor: Actor) -> Entity:
        return actor if actor is not None else fail("auth_required", "Войдите, чтобы продолжить")

    def _require_admin(self, actor: Actor) -> Entity:
        user = self._require_user(actor)
        if user["role"] != "admin":
            fail("forbidden", "Этот раздел доступен только администратору")
        return user

    def _admin_ids(self) -> list[ID]:
        return [u["id"] for u in self.db.users if u["role"] == "admin"]

    def _owned_orgs(self, user_id: ID) -> list[Entity]:
        managed = managers.managed_org_ids(user_id)  # С14
        return [o for o in self.db.organizations if o["ownerId"] == user_id or o["id"] in managed]

    def person(self, user: Entity | None, short: bool = False) -> Entity:
        if not user or user["role"] == "deleted":
            return {"id": "", "name": "Удалённый пользователь", "avatarUrl": None, "initials": "?"}
        return {
            "id": user["id"],
            "name": short_name(user["name"]) if short else user["name"],
            "avatarUrl": user.get("avatarUrl"),
            "initials": initials(user["name"]),
        }

    def sport_view(self, id_: ID) -> Entity:
        s = self._sport(id_)
        if s is None:
            return {
                "id": id_,
                "name": "Без направления",
                "icon": None,
                "kind": "custom",
                "popular": False,
                "categoryIds": [],
                "synonyms": [],
                "fields": [],
            }
        merged = self._sport(s["mergedInto"]) if s.get("mergedInto") else None
        target = merged if merged is not None else s
        category_fields = [
            f for c in self.db.categories if c["id"] in target["categoryIds"] for f in c.get("fields") or []
        ]
        # Поле с тем же ключом из категории важнее поля самого направления.
        fields: list[Any] = []
        seen: set[Any] = set()
        for f in [*category_fields, *(target.get("fields") or [])]:
            if f.get("key") not in seen:
                seen.add(f.get("key"))
                fields.append(f)
        return {
            "id": target["id"],
            "name": target["name"],
            "icon": target.get("icon"),
            "kind": target["kind"],
            "popular": target["popular"],
            "categoryIds": target["categoryIds"],
            "synonyms": target["synonyms"],
            "fields": fields,
        }

    # ---------- Состояние события ----------

    def event_state(self, e: Entity) -> str:
        if e["status"] == EventStatus.CANCELLED:
            return "cancelled"
        if e["status"] == EventStatus.REMOVED:
            return "removed"
        if e["status"] == EventStatus.DELETED:
            return "deleted"
        start = clock.parse(e["startsAt"])
        if start is None:
            # Без понятной даты начала событие считается предстоящим
            return "upcoming"
        end = start + timedelta(minutes=e["durationMin"])
        now = clock.now()
        if now >= end:
            return "past"
        if now >= start:
            return "live"
        return "upcoming"

    def _participations_of(self, event_id: ID) -> list[Entity]:
        return [p for p in self.db.participations if p["eventId"] == event_id]

    def _counts(self, e: Entity) -> Entity:
        ps = self._participations_of(e["id"])

        def by(s: str) -> int:
            return len([p for p in ps if p["status"] == s])

        confirmed = family.seat_count(ps)  # Н6: ребёнок тоже занимает место
        capacity = e.get("capacity")
        min_participants = e.get("minParticipants")
        return {
            "confirmed": confirmed,
            "pending": by(ParticipationStatus.PENDING),
            "waitlist": by(ParticipationStatus.WAITLIST),
            "spotsLeft": max(0, capacity - self._seats_taken(e)) if capacity else None,
            "toThreshold": min_participants - confirmed
            if min_participants and confirmed < min_participants
            else None,
        }

    def _seats_taken(self, e: Entity) -> int:
        """С4: занятые места — участники плюс места, придержанные за людьми из листа ожидания."""
        now = clock.now()
        return (
            family.seat_count(self._participations_of(e["id"]))  # Н6: дети занимают места
            + waitlist_offer.held_seats(self.db, e["id"], now)
            + team.team_held_seats(self.db, e["id"], now)  # Н3: места, придержанные за командой
        )

    @property
    def participation_host(self) -> ParticipationHost:
        """Что модулям записи (состав, резерв, план Б, календарь, серия) нужно от доменного слоя."""
        return _ParticipationHost(self)

    @property
    def participation_read_host(self) -> ParticipationHost:
        """For invite redemption on GET: only grants change, never event records."""
        return _ParticipationHost(self, read_events=True)

    def _threshold(self, e: Entity) -> Entity:
        if not e.get("minParticipants"):
            return {"gathered": None, "deadline": None}
        start = clock.parse(e["startsAt"])
        return {
            "gathered": self._counts(e)["confirmed"] >= e["minParticipants"],
            "deadline": clock.iso(start - timedelta(hours=THRESHOLD_DEADLINE_HOURS))
            if start is not None
            else None,
        }

    def _after_count_change(self, e: Entity, before: int) -> None:
        """Порог сбора после изменения состава, если сам порог не менялся."""
        self._check_threshold(e, before, e.get("minParticipants"))

    def _check_threshold(self, e: Entity, before: int, before_min: int | None) -> None:
        """Порог сбора после изменения состава: `before` участников было при пороге `before_min`.

        Набрался — все участники и организатор узнают, что встреча состоится; упал ниже — организатор
        узнаёт, что людей снова не хватает. Платформа сама не отменяет.
        """
        if self.event_state(e) != "upcoming":
            return
        min_ = e.get("minParticipants")
        after = self._counts(e)["confirmed"]
        was_gathered = bool(before_min and before >= before_min)
        is_gathered = bool(min_ and after >= min_)
        if min_ and is_gathered and not was_gathered:
            confirmed = [
                p["userId"]
                for p in self._participations_of(e["id"])
                if p["status"] == ParticipationStatus.CONFIRMED
            ]
            self._notify(
                [*confirmed, *self._organizer_user_ids(e)],
                "threshold_reached",
                "Встреча состоится",
                f"«{e['title']}»: набралось {after} из нужных {min_}. Ждём вас {_date_token(e['startsAt'])}.",
                f"/events/{e['id']}",
            )
            self._system_message(e, f"Набралось {min_} участников, встреча состоится.")
        elif min_ and before_min and was_gathered and not is_gathered:
            self._notify(
                self._organizer_user_ids(e),
                "threshold_lost",
                "Участников меньше порога",
                f"«{e['title']}»: сейчас {after} из нужных {min_}. Позовите ещё людей или решите, проводить ли встречу.",
                f"/events/{e['id']}/manage",
            )

    def _organizer_user_ids(self, e: Entity) -> list[ID]:
        return kit.organizer_ids(e)

    def is_organizer(self, actor: Actor, e: Entity) -> bool:
        return actor is not None and actor["id"] in self._organizer_user_ids(e)

    def _organizer_facts(self, ref: Entity, own: list[Entity] | None = None) -> Entity:
        own = own if own is not None else self._organizer_events_for_read(ref)
        past = [e for e in own if self.event_state(e) == "past"]
        # С15: встречи, которые участники не подтвердили, не считаются проведёнными
        return reliability.with_reliability(
            {
                "held": len(past),
                "cancelled": len([e for e in own if e["status"] == EventStatus.CANCELLED]),
                "upcoming": len([e for e in own if self.event_state(e) in OPEN_STATES]),
            },
            past,
        )

    def organizer_view(self, e: Entity, facts: Entity | None = None) -> Entity:
        facts = self._organizer_facts(e["organizer"]) if facts is None else facts
        if e["organizer"]["kind"] == "org":
            o = self._org(e["organizer"]["id"]) or {}
            return {
                "kind": "org",
                "id": e["organizer"]["id"],
                "name": o.get("name") or "Организация",
                "avatarUrl": o.get("logoUrl"),
                # Страница из импорта постов ведётся платформой, клуб её не подтверждал: не «проверена»
                "verified": o.get("status") == OrganizationStatus.APPROVED and o.get("ownerId") != "u-import",
                "orgType": o.get("type"),
                "facts": facts,
                "link": f"/orgs/{e['organizer']['id']}",
            }
        u = self.user(e["organizer"]["id"]) or {}
        return {
            "kind": "user",
            "id": e["organizer"]["id"],
            "name": u.get("name") or "Пользователь",
            "avatarUrl": u.get("avatarUrl"),
            "verified": False,
            "orgType": None,
            "facts": facts,
            "link": f"/profile/{e['organizer']['id']}",
        }

    def _waitlist_position(self, e: Entity, participation_id: ID) -> int | None:
        queue = sorted(
            (p for p in self._participations_of(e["id"]) if p["status"] == ParticipationStatus.WAITLIST),
            key=lambda p: p["createdAt"],
        )
        index = next((i for i, p in enumerate(queue) if p["id"] == participation_id), -1)
        return index + 1 if index >= 0 else None

    def _mine(self, actor: Actor, e: Entity) -> Entity | None:
        if actor is None:
            return None
        return next(
            (p for p in self.db.participations if p["eventId"] == e["id"] and p["userId"] == actor["id"]),
            None,
        )

    def can_join(self, actor: Actor, e: Entity, mine: Entity | None = None) -> dict[str, Any]:
        """Можно ли записаться — и готовый текст, почему нет. `mine` — запись человека, если уже найдена."""
        if mine is None:
            mine = self._mine(actor, e)
        state = self.event_state(e)
        if state == "removed":
            return {
                "ok": False,
                "code": "event_removed",
                "reason": "Событие снято с публикации модератором, записаться нельзя",
            }
        if state == "deleted":
            return {"ok": False, "code": "event_deleted", "reason": "Событие удалено"}
        if state == "cancelled":
            return {"ok": False, "code": "event_cancelled", "reason": "Организатор отменил событие"}
        if state == "past":
            return {"ok": False, "code": "event_past", "reason": "Событие уже прошло"}
        if state == "live":
            return {"ok": False, "code": "event_not_open", "reason": "Событие уже началось, запись закрыта"}
        if actor is None:
            return {"ok": True, "reason": ""}
        if actor["role"] == "admin":
            return {
                "ok": False,
                "code": "admin_cannot_join",
                "reason": "Администратор не записывается на события",
            }
        if self.is_organizer(actor, e):
            return {"ok": False, "code": "own_event", "reason": "Это ваше событие"}
        if mine is not None and mine["status"] in ACTIVE_PARTICIPATION:
            return {"ok": False, "code": "already_joined", "reason": "Вы уже записаны"}
        if mine is not None and mine["status"] == ParticipationStatus.REJECTED:
            return {
                "ok": False,
                "code": "rejected_before",
                "reason": "Организатор уже отклонил вашу заявку на это событие",
            }
        # D-16: убран из участников или в стоп-листе организатора — сильнее приглашения
        stop = stop_list.stop_block(self.db, actor, e, mine, clock.now())
        if stop is not None:
            return {"ok": False, **stop}
        # С13: встреча по приглашению — нужна действующая ссылка или приглашение
        invite_block = invite_only.invite_block(self.db, actor, e, False)
        if invite_block is not None:
            return {"ok": False, **invite_block}
        # В7: встреча только для женщин или только для мужчин
        composition_block = composition.composition_block(actor, e)
        if composition_block is not None:
            return {"ok": False, **composition_block}
        return {"ok": True, "reason": ""}

    def _can_ask(self, actor: Actor, e: Entity, mine: Entity | None = None) -> dict[str, Any]:
        state = self.event_state(e)
        if state not in OPEN_STATES:
            return {"ok": False, "reason": "Обсуждение закрыто: событие больше не активно"}
        if actor is None:
            return {"ok": False, "reason": "Войдите, чтобы задать вопрос"}
        stop = stop_list.stop_ask_block(self.db, actor, e, clock.now())  # D-16
        if stop is not None:
            return {"ok": False, "reason": stop}
        if (
            not public_discussion(e)
            and e["discussion"] == "participants"
            and not self.is_organizer(actor, e)
            and actor["role"] != "admin"
            and not (mine is not None and mine["status"] in ACTIVE_PARTICIPATION)
        ):
            return {
                "ok": False,
                "reason": "Обсуждение открыто только участникам. Запишитесь, чтобы задать вопрос",
            }
        return {"ok": True, "reason": ""}

    def _match_context(
        self, user: Entity, event_lookup: Callable[[ID | None], Entity | None] | None = None
    ) -> Entity:
        """Что подбору нужно знать о человеке: см. assistant.MatchContext."""
        event_lookup = event_lookup or self._event
        events = [
            event_lookup(p["eventId"])
            for p in self.db.participations
            if p["userId"] == user["id"] and p["status"] == ParticipationStatus.CONFIRMED
        ]
        past = [e for e in events if e is not None and self.event_state(e) == "past"]
        past_ids = {e["id"] for e in past}
        companions: dict[str, str] = {}
        for p in self.db.participations:
            if (
                p["eventId"] in past_ids
                and p["status"] == ParticipationStatus.CONFIRMED
                and p["userId"] != user["id"]
            ):
                u = self.user(p["userId"])
                if u is not None and p["userId"] not in companions:
                    companions[p["userId"]] = u["name"].split(" ")[0]
        past_organizers: dict[str, str] = {}
        for e in past:
            o = e["organizer"]
            owner = self._org(o["id"]) if o["kind"] == "org" else self.user(o["id"])
            if owner is not None and o["id"] != user["id"]:
                past_organizers[f"{o['kind']}:{o['id']}"] = owner["name"]
        favorite_sport_ids: list[str] = []
        for f in self.db.engagement.favorites:
            fe = event_lookup(f["eventId"]) if f["userId"] == user["id"] else None
            if fe is not None and fe["sportId"] not in favorite_sport_ids:
                favorite_sport_ids.append(fe["sportId"])

        def facts(e: Entity) -> Entity:
            counts = self._counts(e)
            going = [
                p["userId"]
                for p in sorted(
                    (
                        p
                        for p in self._participations_of(e["id"])
                        if p["status"] == ParticipationStatus.CONFIRMED
                    ),
                    key=lambda p: p["createdAt"],
                )
            ]
            return {"going": going, "spotsLeft": counts["spotsLeft"], "toThreshold": counts["toThreshold"]}

        return {
            "user": user,
            "districts": self.db.districts,
            "now": clock.now(),
            "pastDayParts": [day_part(e["startsAt"]) for e in past],
            "pastWeekends": [is_weekend(e["startsAt"]) for e in past],
            "pastSportIds": [e["sportId"] for e in past],
            "pastOrganizers": past_organizers,
            "companions": companions,
            "favoriteSportIds": favorite_sport_ids,
            "facts": facts,
        }

    def _actor_point(self, actor: Actor) -> dict[str, Any] | None:
        if actor is None:
            return None
        if actor.get("home") is not None:
            return actor["home"]
        d = self._district(actor.get("districtId"))
        return {"lat": d["lat"], "lng": d["lng"]} if d is not None else None

    def event_view(self, actor: Actor, e: Entity, opts: dict[str, Any] | None = None) -> Entity:
        """`opts`: `point`, `match`, готовый `organizerView` для карточек одной ленты."""
        opts = opts or {}
        mine = self._mine(actor, e)
        is_organizer = self.is_organizer(actor, e)
        is_admin = _is_admin(actor)
        join = self.can_join(actor, e, mine)
        ask = self._can_ask(actor, e, mine)
        state = self.event_state(e)
        see_private = (
            (mine is not None and mine["status"] == ParticipationStatus.CONFIRMED) or is_organizer or is_admin
        )
        point = opts["point"] if "point" in opts else self._actor_point(actor)
        seats = [
            self.person(self.user(p["userId"]), True)
            for p in sorted(
                (p for p in self._participations_of(e["id"]) if p["status"] == ParticipationStatus.CONFIRMED),
                key=lambda p: p["createdAt"],
            )[:24]
        ]
        my = (
            {
                "id": mine["id"],
                "status": mine["status"],
                "note": mine.get("note"),
                "rejectReason": mine.get("rejectReason"),
                "waitlistPosition": self._waitlist_position(e, mine["id"])
                if mine["status"] == ParticipationStatus.WAITLIST
                else None,
                "unackedChangeIds": self._unacked_change_ids(e, mine)
                if mine["status"] in ACTIVE_PARTICIPATION
                else [],
                "needsEscort": bool(mine.get("needsEscort")),  # Н1
                "offerUntil": waitlist_offer.offer_until_of(mine, clock.now())  # С4
                if state == "upcoming"
                else None,
                "leftBecause": mine.get("leftBecause")
                if mine["status"] == ParticipationStatus.CANCELLED
                else None,  # С6
                "children": mine.get("children") or [],  # Н6
                "adultSeat": mine.get("adultSeat") is not False,
            }
            if mine is not None
            else None
        )
        if my is not None and mine is not None and mine["status"] == ParticipationStatus.REMOVED:
            my["removedReason"] = mine.get("removedReason") or ""  # D-16
        if my is not None:
            my["payment"] = payments.my_payment_of(self, e, mine)  # оплата на сайте
        start = clock.parse(e["startsAt"])
        editable_removed = state == "removed" and start is not None and start > clock.now()
        can = {
            "join": join["ok"],
            "joinReason": join["reason"],
            "joinCode": "" if join["ok"] else join.get("code") or "",
            "leave": bool(
                mine is not None and mine["status"] in ACTIVE_PARTICIPATION and state == "upcoming"
            ),
            "ask": ask["ok"],
            "askReason": ask["reason"],
            "manage": is_organizer and state != "deleted",
            "moderate": is_admin,
            "seePrivate": see_private,
            "edit": is_organizer and (state == "upcoming" or editable_removed),
            "appeal": is_organizer and editable_removed,
        }
        match = opts.get("match")
        if match is None:
            match = self._match_for(actor)
        explained = assistant.explain_event(e, match) if match is not None and not is_organizer else None
        threshold = self._threshold(e)
        see_service = is_admin
        moderation = e.get("moderation")
        actor_id = actor["id"] if actor is not None else None
        organizer_view = opts.get("organizerView")
        if organizer_view is None:
            organizer_view = self.organizer_view(e)
        return {
            **e,
            "discussion": "everyone" if public_discussion(e) else e["discussion"],
            # Служебные поля модерации и помощника — только администратору
            "createdBy": e["createdBy"] if see_service or is_organizer else "",
            "aiFlag": e["aiFlag"] if see_service else "none",
            "aiReason": e["aiReason"] if see_service else "",
            "moderation": {
                **moderation,
                "by": moderation.get("by") if see_service else "",
                "appeal": moderation.get("appeal") if see_service or is_organizer else None,
            }
            if moderation is not None
            else None,
            "changes": [
                {
                    **c,
                    "items": [
                        {
                            **i,
                            "from": self._format_change_value(i["from"]),
                            "to": self._format_change_value(i["to"]),
                        }
                        for i in c["items"]
                    ],
                    "acknowledgedBy": c["acknowledgedBy"]
                    if is_organizer or is_admin
                    else [id_ for id_ in c["acknowledgedBy"] if id_ == actor_id],
                }
                for c in e["changes"]
            ],
            "gathered": threshold["gathered"],
            "thresholdDeadline": threshold["deadline"],
            "privateInfo": e["privateInfo"] if see_private else "",
            # Есть ли что открывать участникам: без этого гость видел замок над пустым полем.
            "hasPrivateInfo": bool(e["privateInfo"]),
            "sport": self.sport_view(e["sportId"]),
            # Карточки не делят изменяемые словари даже при общем расчёте фактов в ленте.
            "organizerView": {**organizer_view, "facts": dict(organizer_view["facts"])},
            "state": state,
            "counts": self._counts(e),
            "seats": seats,
            "my": my,
            "isOrganizer": is_organizer,
            "can": can,
            "distanceKm": _rounded_km(point, e["place"]),
            "districtName": self._district_name(e["place"].get("districtId")),
            "matchReasons": explained["reasons"] if explained is not None else [],
            "matchScore": explained["score"] if explained is not None else None,
            **venues.event_venue_fields(self.db, e),  # В4, Н1: площадка и доступная среда
            "composition": composition.composition_of(e),  # В7
            "urgent": urgent.urgent_badge(e, clock.now()),  # С3
            "program": greeter.program_of(e["id"]),  # Н2
            "favorite": favorites.is_favorite(actor, e["id"]),  # С8
            "heldCheck": reliability.held_check_of(self, actor, e),  # С15
            **invite_only.invite_view_fields(
                e, is_organizer or is_admin
            ),  # С13: код ссылки — только организатору
        }

    def _unacked_change_ids(self, e: Entity, mine: Entity) -> list[ID]:
        """Изменения, которые участник ещё не подтвердил.

        Сделанные до записи человек уже видел в карточке — подтверждать их не нужно.
        """
        joined_at = clock.parse(mine["createdAt"])
        ids: list[ID] = []
        for c in e["changes"]:
            at = clock.parse(c["at"])
            if (
                at is not None
                and joined_at is not None
                and at > joined_at
                and mine["userId"] not in c["acknowledgedBy"]
            ):
                ids.append(c["id"])
        return ids

    def _participant_view(self, p: Entity, e: Entity) -> Entity:
        u = self.user(p["userId"])
        return {
            **p,
            "user": {
                **self.person(u),
                "level": u["levels"].get(e["sportId"]) if u is not None else None,
                "age": u.get("age") if u is not None else None,
            },
            "waitlistPosition": self._waitlist_position(e, p["id"])
            if p["status"] == ParticipationStatus.WAITLIST
            else None,
            "stopListed": stop_list.is_stop_listed(self.db, p["userId"], e, clock.now()),  # D-16
        }

    # ---------- Лента и поиск ----------

    def list_events(
        self, actor: Actor, q: dict[str, Any] | None = None, *, raw: bool = False,
        candidates: list[Entity] | None = None,
    ) -> list[Entity]:
        q = q or {}
        scope = q.get("scope") or "feed"
        if scope not in {"feed", "admin", "participating", "organizing", "user", "org"}:
            fail("validation", "Неизвестный раздел мероприятий")
        if scope == "admin":
            self._require_admin(actor)
        if scope in ("participating", "organizing") and actor is None:
            fail("auth_required", "Войдите, чтобы увидеть свои события")
        if candidates is None and scope in ("user", "org"):
            owner_id = q.get("organizerUserId") if scope == "user" else q.get("orgId")
            candidates = self._organizer_events_for_read({"kind": scope, "id": owner_id}) if owner_id else []
        if candidates is None and scope == "participating" and actor is not None:
            ids = {p["eventId"] for p in self.db.participations if p["userId"] == actor["id"]}
            candidates = [event for id_ in ids if (event := self._event_for_read(id_)) is not None]
        if candidates is None and scope == "organizing" and actor is not None:
            from app.domain.event_reads import organized
            candidates = organized(self.db, actor["id"])
        if candidates is None and q.get("ids") is not None:
            ids = set(_list(q["ids"], "ids", "Передайте список событий"))
            table = COLLECTIONS["events"].table
            candidates = self.db.records("events", table.c.id.in_(ids), predicate=lambda e: e["id"] in ids)
        if candidates is None and scope in {"feed", "admin"}:
            from app.domain.event_query import candidates as event_candidates
            candidates = event_candidates(q)

        when = _when_range(q.get("when"), q.get("date"))
        month = q.get("month")
        requested_city = q.get("place@city")
        city_filter = city_by_id(requested_city) if isinstance(requested_city, str) else None
        if month and (not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month)):
            fail("validation", "Выберите месяц в формате ГГГГ-ММ")
        point = q.get("point")
        if point is None:
            point = self._actor_point(actor)
        match = None if raw and not q.get("forYou") else self._match_for(actor)
        query_text = _text(q.get("q")).strip()
        only_ids = (
            None
            if q.get("ids") is None
            else {id_ for id_ in _list(q["ids"], "ids", "Передайте список событий") if isinstance(id_, str)}
        )
        sport_ids = q.get("sportIds")
        if sport_ids is None and q.get("sportId"):
            sport_ids = [q["sportId"]]
        # Объединённое направление ищется под основным
        wanted_sports = [
            self._main_sport_id(id_) for id_ in _list(sport_ids, "sportIds", "Выберите направления из списка")
        ]
        price_max = parse_number(q.get("priceMax"))
        radius_km = parse_number(q.get("radiusKm"))
        if radius_km is None:
            radius_km = parse_number(actor.get("radiusKm")) if actor is not None else None
        if radius_km is None:
            radius_km = 5
        own_org_ids = [o["id"] for o in self._owned_orgs(actor["id"])] if actor is not None else []
        organizer_names: dict[tuple[str, str], str] = {}

        def organizer_name(e: Entity) -> str:
            ref = e["organizer"]
            key = (ref["kind"], ref["id"])
            if key not in organizer_names:
                owner = self._org(ref["id"]) if ref["kind"] == "org" else self.user(ref["id"])
                organizer_names[key] = (owner or {}).get("name") or (
                    "Организация" if ref["kind"] == "org" else "Пользователь"
                )
            return organizer_names[key]

        def keep(e: Entity) -> bool:
            if requested_city and (city_filter is None or not point_in_city(e.get("place"), city_filter)):
                return False
            if month:
                starts = clock.parse(e["startsAt"])
                if starts is None or clock.local(starts).strftime("%Y-%m") != month:
                    return False
            state = self.event_state(e)
            if only_ids is not None and e["id"] not in only_ids:
                return False
            if scope == "feed":
                if state not in OPEN_STATES:
                    return False
            elif scope == "participating":
                # Удалённое событие остаётся в «Моих занятиях» с пометкой: человек должен узнать, что встречи не будет.
                if not any(
                    p["eventId"] == e["id"] and p["userId"] == actor["id"] for p in self.db.participations
                ):
                    return False
            elif scope == "organizing":
                # Удалённое модератором остаётся у организатора с причиной, удалённое им самим — исчезает.
                if not self.is_organizer(actor, e) or (state == "deleted" and e.get("moderation") is None):
                    return False
            elif scope == "org":
                if e["organizer"]["kind"] != "org" or e["organizer"]["id"] != q.get("orgId"):
                    return False
                privileged = _is_admin(actor) or q.get("orgId") in own_org_ids
                if (
                    (state == "deleted" and e.get("moderation") is None)
                    if privileged
                    else (state not in OPEN_STATES and state != "past")
                ):
                    return False
            elif scope == "user":
                if e["organizer"]["kind"] != "user" or e["organizer"]["id"] != q.get("organizerUserId"):
                    return False
                if state not in OPEN_STATES and state != "past":
                    return False
            # С13: встречи по приглашению — не в ленте, поиске и на карте; на страницах организатора — только ему
            if invite_only.is_invite_only(e) and (
                scope == "feed"
                or (scope in ("org", "user") and not self.is_organizer(actor, e) and not _is_admin(actor))
            ):
                return False
            if q.get("family") and not family.family_matches(e, q["family"]):  # Н6
                return False
            # D-16: подборка «Для вас» не предлагает встречи организатора, который не пускает человека
            if (
                q.get("forYou")
                and actor is not None
                and stop_list.is_stop_listed(self.db, actor["id"], e, clock.now())
            ):
                return False
            if q.get("status") and e["status"] != q["status"]:
                return False
            if q.get("aiFlagged") and e["aiFlag"] == "none":
                return False
            if wanted_sports and e["sportId"] not in wanted_sports:
                return False
            if when is not None:
                starts = clock.parse(e["startsAt"])
                if starts is not None and not when[0] <= starts <= when[1]:
                    return False
            if q.get("dayPart") and day_part(e["startsAt"]) != q["dayPart"]:
                return False
            if q.get("beginners") and not (e.get("beginnersWelcome") or e["level"] == "beginner"):
                return False
            if q.get("level") and e["level"] != q["level"] and e["level"] != "any":
                return False
            if q.get("joinMode") and e["joinMode"] != q["joinMode"]:
                return False
            if q.get("free") and e["price"]["kind"] != "free":
                return False
            if price_max is not None:
                counts = self._counts(e)
                per_person = price_summary(e["price"], counts["confirmed"], e.get("minParticipants"))[
                    "perPerson"
                ]
                if per_person is not None and per_person > price_max:
                    return False
            if q.get("districtId") and e["place"].get("districtId") != q["districtId"]:
                return False
            if not venues.event_meets_needs(self.db, e, q.get("access")):  # Н1
                return False
            if q.get("composition") and composition.composition_of(e) != q["composition"]:  # В7
                return False
            km = distance_km(point, e["place"]) if q.get("near") and point is not None else None
            if km is not None and km > radius_km:
                return False
            if query_text:
                s = self._sport(e["sportId"])
                words = [
                    e["title"],
                    e["description"],
                    e["place"].get("address"),
                    e["place"].get("landmark"),
                    *([s["name"], *(s.get("synonyms") or [])] if s is not None else []),
                    organizer_name(e),
                ]
                if not text.text_matches(query_text, " ".join(w for w in words if w)):
                    return False
            return True

        events = [e for e in candidates if keep(e)]

        # Внутренний путь провайдера: отбор и права те же, но карточки нужны только
        # после безопасных фильтров по исходным полям и выделения страницы.
        if raw:
            if q.get("forYou"):
                previews = []
                for event in events:
                    explained = assistant.explain_event(event, match) if match is not None and not self.is_organizer(actor, event) else None
                    previews.append({**event, "counts": self._counts(event), "my": self._mine(actor, event),
                                     "matchScore": explained["score"] if explained else None})
                return assistant.for_you_order(previews)
            events.sort(key=lambda event: event["startsAt"], reverse=scope == "admin")
            return events

        views = self.event_views(actor, events, {"point": point, "match": match})
        if q.get("forYou"):
            return assistant.for_you_order(views)
        views.sort(key=lambda v: v["startsAt"], reverse=scope == "admin")
        return views

    def event_views(
        self, actor: Actor, events: list[Entity], opts: dict[str, Any] | None = None
    ) -> list[Entity]:
        """Карточки выбранной группы с общим расчётом истории организаторов."""
        opts = opts or {}

        # Индекс живёт только в этом вызове. Факты учитывают всю историю организатора,
        # включая встречи, отсеянные фильтром, и считаются один раз на организатора.
        by_organizer: dict[tuple[str, str], list[Entity]] = {}
        loaded = "events" in self.db._data
        if events and loaded:
            for event in self.db.events:
                ref = event["organizer"]
                by_organizer.setdefault((ref["kind"], ref["id"]), []).append(event)
        organizer_views: dict[tuple[str, str], Entity] = {}
        views = []
        for event in events:
            ref = event["organizer"]
            key = (ref["kind"], ref["id"])
            if key not in organizer_views:
                own = by_organizer.get(key, []) if loaded else self._organizer_events_for_read(ref)
                facts = self._organizer_facts(ref, own)
                organizer_views[key] = self.organizer_view(event, facts)
            views.append(
                self.event_view(actor, event, {**opts, "organizerView": organizer_views[key]})
            )
        return views

    def _main_sport_id(self, id_: ID) -> ID:
        """Направление, под которым ищется `id_`: объединённое — под основным."""
        s = self._sport(id_)
        return (s.get("mergedInto") or id_) if s is not None else id_

    def event_details(self, actor: Actor, id_: ID, opts: dict[str, Any] | None = None) -> Entity:
        """`opts.invite` — код из ссылки-приглашения (С13)."""
        opts = opts or {}
        e = self._event_for_read(id_)
        if e is None:
            fail("not_found", "Событие не найдено. Возможно, ссылка устарела")
        is_admin = _is_admin(actor)
        is_organizer = self.is_organizer(actor, e)
        invite_only.assert_invite_access(self.db, actor, e, is_organizer, opts.get("invite"))  # С13
        if e["status"] == EventStatus.DELETED and not is_admin and not is_organizer:
            moderation = e.get("moderation")
            if moderation is None:
                fail("event_deleted", f"Организатор удалил событие «{e['title']}». Записаться на него нельзя")
            why = _moderation_reason(
                _by_id(self.db.rules, moderation.get("ruleId")), moderation.get("comment") or ""
            )
            fail(
                "event_deleted",
                f"Событие «{e['title']}» удалено модератором{f': {why}' if why else ''}. Записаться на него нельзя",
            )
        own = self._organizer_events_for_read(e["organizer"])
        view = self.event_view(
            actor,
            e,
            {
                "organizerView": self.organizer_view(e, self._organizer_facts(e["organizer"], own)),
                "match": self._match_context(actor, self._event_for_read)
                if actor is not None and not is_admin
                else None,
            },
        )
        ps = self._participations_of(e["id"])

        def of(statuses: list[str]) -> list[Entity]:
            return [
                self._participant_view(p, e)
                for p in sorted((p for p in ps if p["status"] in statuses), key=lambda p: p["createdAt"])
            ]

        return {
            **view,
            "participants": [
                self.person(self.user(p["userId"]), True)
                for p in ps
                if p["status"] == ParticipationStatus.CONFIRMED
            ],
            "manage": {
                "confirmed": of([ParticipationStatus.CONFIRMED]),
                "pending": of([ParticipationStatus.PENDING]),
                "waitlist": of([ParticipationStatus.WAITLIST]),
                "declined": of(
                    [
                        ParticipationStatus.REJECTED,
                        ParticipationStatus.CANCELLED,
                        ParticipationStatus.EVENT_REMOVED,
                        ParticipationStatus.REMOVED,
                    ]
                ),
            }
            if is_organizer or is_admin
            else None,
            "messagesCount": len(
                [
                    m
                    for m in self.db.messages
                    if m["eventId"] == e["id"] and not m["system"] and m["status"] == MessageStatus.VISIBLE
                ]
            ),
            "gear": inventory.gear_lines_of(e["id"]),  # В3: что нужно для игры (для формы правки)
        }

    def list_participations(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        q = q or {}
        user = self._require_user(actor)
        if q.get("scope") == "organizer_pending":
            return self._organizer_pending(user)
        rows = self.db.participations
        if q.get("eventId"):
            e = self._get_event(q["eventId"])

            if not self.is_organizer(user, e) and user["role"] != "admin":
                fail("forbidden", "Список заявок видит только организатор события")
            rows = [p for p in rows if p["eventId"] == q["eventId"]]
        else:
            rows = [p for p in rows if p["userId"] == user["id"]]
        if q.get("status"):
            rows = [p for p in rows if p["status"] == q["status"]]
        return [self._participant_view(p, self._get_event(p["eventId"])) for p in rows]

    def _organizer_pending(self, user: Entity) -> list[Entity]:
        """
        Стопка «Разобрать по одной» в кабинете: заявки на рассмотрении по всем событиям, где пользователь
        организатор (сам, представитель или соуправляющий клуба), пока по ним можно решать. Порядок — по началу
        события, внутри события — по времени заявки.
        """
        visits = self.db.first_visits
        pending_by_event: dict[ID, list[Entity]] = {}
        for participation_ in self.db.participations:
            if participation_["status"] == ParticipationStatus.PENDING:
                pending_by_event.setdefault(participation_["eventId"], []).append(participation_)
        event_ids = set(pending_by_event)
        candidates = self.db.records(
            "events", COLLECTIONS["events"].table.c.id.in_(event_ids),
            predicate=lambda event: event["id"] in event_ids,
        ) if event_ids else []
        events = sorted(
            (e for e in candidates if self.is_organizer(user, e) and self.event_state(e) in OPEN_STATES),
            key=lambda e: (e["startsAt"], e["id"]),
        )
        out: list[Entity] = []
        for e in events:
            pending = sorted(
                pending_by_event[e["id"]],
                key=lambda p: (p["createdAt"], p["id"]),
            )
            if not pending:
                continue
            counts = self._counts(e)
            sport = self.sport_view(e["sportId"])
            for p in pending:
                u = self.user(p["userId"])
                out.append(
                    {
                        **self._participant_view(p, e),
                        "event": {
                            "id": e["id"],
                            "title": e["title"],
                            "startsAt": e["startsAt"],
                            "capacity": e.get("capacity"),
                            "confirmedCount": counts["confirmed"],
                            "seatsLeft": counts["spotsLeft"],
                            "joinMode": e["joinMode"],
                            "sport": {"id": sport["id"], "name": sport["name"]},
                            "coverUrl": e.get("coverUrl"),
                        },
                        # Н3, Н6: так же, как проверяет decide
                        "seats": family.seats_of(p) + team.team_seats_needed(self.db, p),
                        "attended": self.user_view(u)["facts"]["attended"] if u is not None else 0,
                        "firstVisit": any(
                            f["eventId"] == e["id"] and f["userId"] == p["userId"] for f in visits
                        ),
                    }
                )
        return out

    # ---------- Запись ----------

    def join(self, actor: Actor, event_id: ID, input_: dict[str, Any] | None = None) -> Entity:
        """`input_`: `note`, `checkConflicts`, `children`."""
        input_ = input_ or {}
        user = self._require_user(actor)
        e = self._get_event(event_id)
        mine = self._mine(user, e)
        # Даже повторная запись не должна молча принимать детей на обычную встречу.
        children = input_.get("children")
        if isinstance(children, list) and children and e.get("family") is None:
            fail("bad_state", "На эту встречу детей не записывают")
        # Повторное нажатие не создаёт вторую запись
        if mine is not None and mine["status"] in ACTIVE_PARTICIPATION:
            return self.event_details(user, event_id)
        check = self.can_join(user, e, mine)
        if not check["ok"]:
            fail(check.get("code") or "bad_state", check["reason"])
        # С9: интерфейс сначала спрашивает о пересечениях, второй запрос без флага — «Всё равно записаться»
        if input_.get("checkConflicts"):
            conflicts = calendar.find_conflicts(self.participation_host, user, e)
            if conflicts:
                fail("time_conflict", calendar.conflict_message(conflicts), None, {"conflicts": conflicts})
        # Н6: запись с детьми — места нужны сразу на всех
        family_plan = family.plan_family(
            e,
            input_.get("children"),
            None if e.get("capacity") is None else e["capacity"] - self._seats_taken(e),
        )

        before = self._counts(e)["confirmed"]
        full = (
            e.get("capacity") is not None and self._seats_taken(e) >= e["capacity"]
        )  # С4: с учётом придержанных мест
        # Кого организатор позвал сам, тот не ждёт повторного одобрения
        invited = any(i["eventId"] == event_id and i["toUserId"] == user["id"] for i in self.db.invites)
        status = (
            ParticipationStatus.WAITLIST
            if full
            else ParticipationStatus.CONFIRMED
            if e["joinMode"] == JoinMode.OPEN or invited
            else ParticipationStatus.PENDING
        )
        now = _iso_now()
        note = _trim(input_.get("note"), 300)
        if mine is not None:
            mine.update(
                {
                    "status": status,
                    "prevStatus": None,
                    "note": note,
                    "rejectReason": "",
                    "createdAt": now,
                    "decidedAt": now if status == ParticipationStatus.CONFIRMED else None,
                    "offer": None,  # С4
                    "leftBecause": None,  # С6
                    "teamId": None,  # Н3
                }
            )
        else:
            mine = {
                "id": store.next_id("p"),
                "eventId": event_id,
                "userId": user["id"],
                "status": status,
                "prevStatus": None,
                "note": note,
                "rejectReason": "",
                "source": "invite" if invited else "self",
                "createdAt": now,
                "decidedAt": now if status == ParticipationStatus.CONFIRMED else None,
            }
            self.db.participations.append(mine)
        family.apply_family(mine, family_plan)  # Н6
        if status == "confirmed":
            payments.on_confirmed(self, e, mine)  # оплата на сайте: срок оплаты

        texts = {
            "confirmed": (
                "joined",
                "Новый участник",
                f"{user['name']} записался на «{e['title']}»{family.family_note(family_plan)}{' по вашему приглашению' if invited and e['joinMode'] == 'approval' else ''}.",
            ),
            "pending": (
                "application",
                "Новая заявка",
                f"{user['name']} хочет на «{e['title']}»{family.family_note(family_plan)}.{f' Сообщение: «{note}»' if note else ''}",
            ),
            "waitlist": (
                "joined",
                "Новый человек в листе ожидания",
                f"{user['name']} встал в лист ожидания на «{e['title']}».",
            ),
        }
        type_, title, text_ = texts[status]
        self._notify(
            self._organizer_user_ids(e),
            type_,
            title,
            text_,
            f"/events/{e['id']}/manage" if status == ParticipationStatus.PENDING else f"/events/{e['id']}",
        )
        if status == ParticipationStatus.WAITLIST:
            position = self._waitlist_position(e, mine["id"])
            in_queue = f", вы {position}-й в очереди" if position is not None else ""
            self._notify(
                [user["id"]],
                "waitlist_joined",
                "Вы в листе ожидания",
                f"Мест на «{e['title']}» пока нет{in_queue}. Если место освободится, сообщим.",
                f"/events/{e['id']}",
            )
        self._after_count_change(e, before)
        self._commit(["events", "participations", "notifications", "messages"], [e["id"]])
        return self.event_details(user, event_id)

    def leave(self, actor: Actor, event_id: ID, opts: dict[str, Any] | None = None) -> Entity:
        """`reason: 'reschedule'` — С6, «Не смогу в новое время»: не поздняя отмена, организатор видит причину."""
        opts = opts or {}
        user = self._require_user(actor)
        e = self._get_event(event_id)
        mine = next(
            (
                p
                for p in self.db.participations
                if p["eventId"] == event_id
                and p["userId"] == user["id"]
                and p["status"] in ACTIVE_PARTICIPATION
            ),
            None,
        )
        if mine is None:
            # Повторная отмена возвращает текущее состояние
            previous = self._mine(user, e)
            if previous is not None and previous["status"] == ParticipationStatus.CANCELLED:
                return {**self.event_details(user, event_id), "lateCancel": False}
            fail("no_participation", "У вас нет активной записи на это событие")
        if self.event_state(e) != "upcoming":
            fail("event_started", "Событие уже началось или закончилось, отменить запись нельзя")
        before = self._counts(e)["confirmed"]
        was_confirmed = mine["status"] == ParticipationStatus.CONFIRMED
        deadline = self._free_cancel_deadline(e)
        rescheduled = opts.get("reason") == "reschedule"
        late_cancel = (
            was_confirmed
            and not rescheduled
            and e["price"]["kind"] != "free"
            and deadline is not None
            and clock.now() > deadline
        )
        # С4: отказ от придержанного места
        had_offer = waitlist_offer.has_active_offer(mine, clock.now())
        mine["status"] = ParticipationStatus.CANCELLED
        mine["decidedAt"] = _iso_now()
        mine["offer"] = None
        # Оплата на сайте: возврат по правилам отмены
        payments.on_left(self, e, mine, late=late_cancel, rescheduled=rescheduled)
        what = "отменил запись" if was_confirmed else "отозвал заявку"
        self._notify(
            self._organizer_user_ids(e),
            "left",
            "Участник отменил запись" if was_confirmed else "Заявку отозвали",
            f"{user['name']} не сможет в новое время и {what} на «{e['title']}»."
            if rescheduled
            else f"{user['name']} {what} на «{e['title']}»{' позже срока бесплатной отмены' if late_cancel else ''}.",
            f"/events/{e['id']}/manage",
        )
        if was_confirmed or had_offer:
            self._promote_waitlist(e)
        self._after_count_change(e, before)
        self._commit(["events", "participations", "notifications", "messages"], [e["id"]])
        return {**self.event_details(user, event_id), "lateCancel": late_cancel}

    def _free_cancel_deadline(self, e: Entity) -> datetime | None:
        """До какого момента запись отменяется бесплатно; None — в любой момент.

        «Накануне до HH:MM» — по местному времени дня перед встречей.
        """
        policy = e["cancelPolicy"]
        start = clock.parse(e["startsAt"])
        if start is None or policy["kind"] == "anytime":
            return None
        if policy["kind"] == "hoursBefore":
            hours = parse_number(policy.get("hours"))
            return start - timedelta(hours=hours) if hours is not None else None
        hour, _, minute = str(policy.get("time") or "").partition(":")
        hour_n, minute_n = parse_number(hour), parse_number(minute)
        if hour_n is None or minute_n is None:
            return None
        eve = start_of_day(clock.local(start) - timedelta(days=1))
        return eve + timedelta(hours=hour_n, minutes=minute_n)

    def _promote_waitlist(self, e: Entity) -> list[ID]:
        """Освободилось место: первому из листа ожидания оно придерживается до подтверждения (С4).

        При записи по заявке его заявка уходит организатору. Без лимита мест — сразу в состав.
        """
        if self.event_state(e) != "upcoming":
            return []
        promoted: list[ID] = []
        now = clock.now()
        while e.get("capacity") is None or self._seats_taken(e) < e["capacity"]:
            queue = sorted(
                (
                    p
                    for p in self._participations_of(e["id"])
                    # D-16: того, кого организатор не пускает, очередь пропускает
                    if p["status"] == ParticipationStatus.WAITLIST
                    and not waitlist_offer.has_active_offer(p, now)
                    and not stop_list.is_stop_listed(self.db, p["userId"], e, now)
                ),
                key=lambda p: p["createdAt"],
            )
            nxt = queue[0] if queue else None
            if nxt is None:
                break
            invited = any(i["eventId"] == e["id"] and i["toUserId"] == nxt["userId"] for i in self.db.invites)
            if e["joinMode"] == JoinMode.OPEN or invited:
                promoted.append(nxt["userId"])
                if e.get("capacity") is not None:
                    waitlist_offer.give_offer(self.participation_host, e, nxt)
                    continue
                nxt["status"] = ParticipationStatus.CONFIRMED
                nxt["decidedAt"] = _iso_now()
                self._notify(
                    [nxt["userId"]],
                    "waitlist_promoted",
                    "Освободилось место",
                    f"Вы в составе «{e['title']}». {_date_token(e['startsAt'])}.",
                    f"/events/{e['id']}",
                )
            else:
                nxt["status"] = ParticipationStatus.PENDING
                self._notify(
                    [nxt["userId"]],
                    "waitlist_promoted",
                    "Освободилось место",
                    f"Ваша заявка на «{e['title']}» передана организатору. Ответ придёт сюда же.",
                    f"/events/{e['id']}",
                )
                self._notify(
                    self._organizer_user_ids(e),
                    "application",
                    "Заявка из листа ожидания",
                    f"Освободилось место на «{e['title']}», заявка ждёт решения.",
                    f"/events/{e['id']}/manage",
                )
                promoted.append(nxt["userId"])
                break
        return promoted

    def _pending_to_waitlist(self, e: Entity) -> None:
        """Места кончились: заявки, которые ещё ждут решения, переходят в лист ожидания."""
        if e.get("capacity") is None or self._seats_taken(e) < e["capacity"]:
            return
        for p in [x for x in self._participations_of(e["id"]) if x["status"] == ParticipationStatus.PENDING]:
            p["status"] = ParticipationStatus.WAITLIST
            self._notify(
                [p["userId"]],
                "waitlist_joined",
                "Мест не осталось",
                f"На «{e['title']}» набрался полный состав. Ваша заявка в листе ожидания. Если место освободится, организатор её рассмотрит.",
                f"/events/{e['id']}",
            )

    def decide(self, actor: Actor, participation_id: ID, input_: dict[str, Any]) -> Entity:
        """Решение по заявке принимает только организатор события; администратор заявки участников не рассматривает."""
        user = self._require_user(actor)
        p = _by_id(self.db.participations, participation_id)
        if p is None:
            fail("not_found", "Заявка не найдена")
        e = self._get_event(p["eventId"])
        if not self.is_organizer(user, e):
            fail("forbidden", "Решение по заявке принимает организатор события")
        decision = input_.get("decision")
        if decision not in ("accept", "reject"):
            fail("bad_request", "Неизвестное решение")
        # Повтор того же решения (двойное нажатие, вторая вкладка) возвращает текущее состояние
        target = ParticipationStatus.CONFIRMED if decision == "accept" else ParticipationStatus.REJECTED
        if p["status"] == target:
            return self._participant_view(p, e)
        if p["status"] != ParticipationStatus.PENDING:
            fail("already_decided", "Эта заявка уже рассмотрена")
        if self.event_state(e) not in OPEN_STATES:
            fail("event_inactive", "Событие больше не активно, заявки рассматривать нельзя")
        # Н3, Н6: заявка команды или взрослого с детьми занимает несколько мест сразу
        seats_needed = family.seats_of(p) + team.team_seats_needed(self.db, p)
        if (
            decision == "accept"
            and e.get("capacity") is not None
            and self._seats_taken(e) + seats_needed > e["capacity"]
        ):
            fail(
                "full",
                f"Мест не хватает: нужно {seats_needed}. Увеличьте лимит мест или откажите"
                if seats_needed > 1
                else "Мест не осталось. Увеличьте лимит мест или откажите",
            )
        before = self._counts(e)["confirmed"]
        reason = _trim(input_.get("reason"), 300)
        p["status"] = target
        p["rejectReason"] = reason if decision == "reject" else ""
        p["decidedAt"] = _iso_now()
        team.on_team_decided(
            self.participation_host, p, decision
        )  # Н3: команда принята или отклонена целиком
        if decision == "accept":
            payments.on_confirmed(self, e, p)  # оплата на сайте: срок оплаты
        if decision == "accept":
            self._notify(
                [p["userId"]],
                "accepted",
                "Заявка принята",
                f"Вас ждут на «{e['title']}», {_date_token(e['startsAt'])}. Адрес и контакты открыты в карточке.",
                f"/events/{e['id']}",
            )
            self._pending_to_waitlist(e)
        else:
            self._notify(
                [p["userId"]],
                "rejected",
                "Заявка отклонена",
                f"Организатор «{e['title']}» отклонил заявку{f': {reason}' if reason else '.'}",
                f"/events/{e['id']}",
            )
            self._promote_waitlist(e)
        self._audit(
            user,
            "participation.accept" if decision == "accept" else "participation.reject",
            "participation",
            p["id"],
            e["title"],
            reason,
        )
        self._after_count_change(e, before)
        self._commit(["events", "participations", "notifications", "audit", "messages"], [e["id"]])
        return self._participant_view(p, e)

    # ---------- Создание и изменение события ----------

    def _plan_sport(
        self, sport_id: Any = None, new_sport_name: Any = None, confirm_new: Any = None
    ) -> Entity:
        """Какое направление использовать. Ничего не создаёт: сначала все проверки, потом изменения.

        Новое имя сверяется с каталогом с учётом синонимов, окончаний и опечаток; при похожем
        совпадении — 409 `sport_similar` со списком, пока человек не подтвердит `confirmNew`.
        Результат: `{"id": …}` или `{"create": название}`.
        """
        if sport_id:
            s = self._sport(sport_id)
            if s is None:
                fail("validation", "Выберите направление из списка", {"sportId": "Такого направления нет"})
            return {"id": s.get("mergedInto") or s["id"]}
        name = _collapse(new_sport_name, 40)
        if len(name) < 2:
            fail("validation", "Укажите направление", {"sportId": "Выберите направление или впишите своё"})
        similar = assistant.suggest_sports(name, _shown(self.db.sports), 5)
        same = next((s for s in similar if s["match"] in {"exact", "synonym"}), None)
        if same is not None:
            return {"id": same["id"]}
        if similar and not confirm_new:
            names = ", ".join(f"«{s['name']}»" for s in similar)
            fail(
                "sport_similar",
                f"Похожее направление уже есть: {names}. Выберите его или подтвердите, что «{capitalize(name)}» — новое",
                {"sportId": "Есть похожее направление"},
                {"similar": similar},
            )
        return {"create": capitalize(name)}

    def _apply_sport(self, actor: Entity, plan: Entity) -> ID:
        if "id" in plan:
            return plan["id"]
        sport = {
            "id": store.next_id("s"),
            "name": plan["create"],
            "synonyms": [],
            "categoryIds": [],
            "icon": None,
            "kind": "custom",
            "popular": False,
            "fields": [],
            "mergedInto": None,
            "createdBy": actor["id"],
            "createdAt": _iso_now(),
        }
        self.db.sports.append(sport)
        self._audit(
            actor, "sport.create", "sport", sport["id"], sport["name"], "Новое направление от пользователя"
        )
        return sport["id"]

    def _validate_event(self, input_: dict[str, Any], partial: bool = False) -> dict[str, str]:
        errors: dict[str, str] = {}
        if input_.get("coverUrl") and not valid_event_image(input_["coverUrl"]):
            errors["coverUrl"] = "Выберите корректное фото или HTTPS-адрес изображения"

        def has(k: str) -> bool:
            return not partial or k in input_

        if has("title") and len(_trim(input_.get("title"), 90)) < 5:
            errors["title"] = "Напишите название, хотя бы 5 букв"
        if not partial and not input_.get("sportId") and not _trim(input_.get("newSportName"), 40):
            errors["sportId"] = "Выберите направление или впишите своё"
        if has("startsAt"):
            starts = clock.parse(input_.get("startsAt"))
            if starts is None:
                errors["startsAt"] = "Укажите дату и время начала"
            elif starts < clock.now() + timedelta(minutes=10):
                errors["startsAt"] = "Начало должно быть в будущем"
        if has("durationMin"):
            d = parse_number(input_.get("durationMin"))
            if d is None or not 15 <= d <= 720:
                errors["durationMin"] = "Длительность от 15 минут до 12 часов"
        if has("place") and len(_trim(_field(input_.get("place"), "address"), 160)) < 3:
            errors["place"] = "Укажите адрес или понятный ориентир"
        if has("joinMode") and input_.get("joinMode") not in JoinMode:
            errors["joinMode"] = "Выберите, как записываться"
        if has("level") and "level" in input_ and input_["level"] not in LEVELS:
            errors["level"] = "Выберите уровень из списка"
        if (
            has("discussion")
            and "discussion" in input_
            and input_["discussion"] not in ("everyone", "participants")
        ):
            errors["discussion"] = "Выберите, кто может писать в обсуждении"
        first_step = input_.get("firstStep")
        intensity = _field(first_step, "intensity")
        amenities = _field(first_step, "amenities")
        if has("firstStep") and intensity and intensity not in INTENSITIES:
            errors["firstStep"] = "Выберите нагрузку из списка"
        elif has("firstStep") and amenities is not None and not isinstance(amenities, list):
            errors["firstStep"] = "Перечислите удобства списком"
        capacity = parse_number(input_.get("capacity"))
        given_capacity = has("capacity") and input_.get("capacity") is not None
        if given_capacity and not (isinstance(capacity, int) and 2 <= capacity <= 500):
            errors["capacity"] = "Лимит мест от 2 до 500"
        if has("minParticipants") and input_.get("minParticipants"):
            m = parse_number(input_["minParticipants"])
            if not isinstance(m, int) or m < 2:
                errors["minParticipants"] = "Порог от 2 человек"
            elif capacity and m > capacity:
                errors["minParticipants"] = "Порог не может быть больше лимита мест"
        price = input_.get("price")
        if not partial and price is None:
            errors["price"] = "Укажите стоимость: бесплатно, цена с человека или делим на всех"
        if has("price") and price is not None:
            kind = _field(price, "kind")
            if kind not in ("free", "fixed", "split"):
                errors["price"] = "Выберите, сколько стоит участие"
            amount = parse_number(_field(price, "amount"))
            if kind == "fixed" and not (amount is not None and 0 < amount <= 100_000):
                errors["price"] = "Укажите цену от 1 до 100 000 ₽"
            total = parse_number(_field(price, "total"))
            if kind == "split" and not (total is not None and 0 < total <= 1_000_000):
                errors["price"] = "Укажите общую сумму"
        policy = input_.get("cancelPolicy")
        if has("cancelPolicy") and policy is not None:
            kind = _field(policy, "kind")
            hours = _field(policy, "hours")
            time = _field(policy, "time")
            ok = (
                kind == "anytime"
                or (
                    kind == "hoursBefore"
                    and isinstance(hours, int | float)
                    and not isinstance(hours, bool)
                    and 1 <= hours <= 168
                )
                or (kind == "eveBefore" and isinstance(time, str) and _HHMM_RE.fullmatch(time) is not None)
            )
            if not ok:
                errors["cancelPolicy"] = "Выберите правило отмены из списка"
        if input_.get("repeatWeeklyUntil"):
            until = clock.parse(input_["repeatWeeklyUntil"])
            start = clock.parse(input_.get("startsAt"))
            if until is None:
                errors["repeatWeeklyUntil"] = "Укажите, до какого дня повторять встречу"
            elif start is not None and until <= start:
                errors["repeatWeeklyUntil"] = "Дата окончания повторов должна быть позже первой встречи"
            elif start is not None and until - start > timedelta(weeks=MAX_SERIES):
                errors["repeatWeeklyUntil"] = f"Повторять можно не дольше {MAX_SERIES} недель"
        return errors

    def _clean_first_step(self, input_: Any, base: Entity | None = None) -> Entity:
        """«Первый шаг» из формы; поля, которых нет в запросе, остаются из `base`."""
        if not isinstance(input_, dict):
            input_ = {}
        base = base or {}

        def value(k: str, max_: int) -> str:
            return _trim(input_[k], max_) if k in input_ else base.get(k) or ""

        if "amenities" in input_:
            raw = input_["amenities"] if isinstance(input_["amenities"], list) else []
            amenities = [a for a in (_trim(x, 60) for x in raw) if a][:8]
        else:
            amenities = base.get("amenities") or []
        return {
            "intensity": input_.get("intensity") or base.get("intensity") or "medium",
            "bring": value("bring", 200),
            "preparation": value("preparation", 200),
            "age": value("age", 80),
            "howToFind": value("howToFind", 200),
            "amenities": amenities,
            "firstTimeNote": value("firstTimeNote", 300),
        }

    def _clean_extra(self, extra: Any) -> dict[str, str]:
        """Дополнительные поля карточки: не больше 20 пар «название — значение»."""
        if not isinstance(extra, dict):
            return {}
        return {_trim(k, 40): _trim(v, 120) for k, v in list(extra.items())[:20]}

    def _place_point(self, place: dict[str, Any]) -> Entity:
        """Координаты места: явные, по известному месту, по центру района, по центру города."""
        if "lat" in place and "lng" in place:
            return {"districtId": place.get("districtId"), "lat": place["lat"], "lng": place["lng"]}
        located = assistant.locate_place(f"{_text(place.get('address'))} {_text(place.get('landmark'))}")
        district_id = place.get("districtId")
        if district_id is None and located is not None:
            district_id = located["districtId"]
        if located is not None:
            return {"districtId": district_id, "lat": located["lat"], "lng": located["lng"]}
        district = self._district(district_id)
        return {
            "districtId": district_id,
            "lat": district["lat"] if district is not None else CITY_CENTER["lat"],
            "lng": district["lng"] if district is not None else CITY_CENTER["lng"],
        }

    def _companion_for_gathering(self, user: Entity, companion_id: ID) -> Entity:
        c = _by_id(self.db.companions, companion_id)
        if c is None:
            fail("not_found", "Объявление не найдено")
        if c["authorId"] != user["id"]:
            fail("forbidden", "Собрать встречу может только автор объявления")
        if c["status"] != CompanionStatus.OPEN:
            fail("companion_closed", "Объявление уже закрыто")
        return c

    def _remember(self, key: str, user: Entity, resource: str, id_: ID) -> None:
        self.db.idempotency.append(
            {"key": key, "userId": user["id"], "resource": resource, "id": id_, "at": _iso_now()}
        )
        self.db.idempotency = self.db.idempotency[-200:]

    def _recalled(self, key: str, user: Entity, resource: str) -> ID | None:
        if not key:
            return None
        found = next(
            (
                r
                for r in self.db.idempotency
                if r["key"] == key and r["userId"] == user["id"] and r["resource"] == resource
            ),
            None,
        )
        return found.get("id") if found is not None else None

    def create_event(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        user = self._require_user(actor)
        if user["role"] == "admin":
            fail("forbidden", "Администратор не создаёт события")
        key = _trim(input_.get("idempotencyKey"), 80)
        done = self._recalled(key, user, "events")
        if done and self._event(done) is not None:
            return self.event_details(user, done)

        organizer = {"kind": "user", "id": user["id"]}
        if input_.get("orgId"):
            o = self._get_org(input_["orgId"])
            if o["ownerId"] != user["id"] and not managers.is_manager(o["id"], user["id"]):
                # С14: и соуправляющий
                fail("forbidden", "Публиковать от имени организации может только её представитель")
            # До допуска организация не может публиковать и действовать от своего имени
            if o["status"] != OrganizationStatus.APPROVED:
                fail(
                    "org_not_approved",
                    "Организация ещё не допущена. Публиковать от её имени можно после проверки администратором",
                )
            org_suspend.assert_org_active(o)  # С17
            organizer = {"kind": "org", "id": o["id"]}
        errors = self._validate_event(input_)
        errors.update(payments.payment_mode_errors(self, None, input_))  # оплата на сайте
        if errors:
            fail("validation", "Проверьте поля формы", errors)
        companion = (
            self._companion_for_gathering(user, input_["companionId"]) if input_.get("companionId") else None
        )
        sport_plan = self._plan_sport(
            input_.get("sportId"), input_.get("newSportName"), input_.get("confirmNew")
        )
        gear = inventory.clean_gear_lines(input_.get("gear"))  # В3: что нужно для игры
        family_ = family.clean_family(input_.get("family"))  # Н6
        again_from = again.again_source(self.participation_host, user, input_.get("againFrom"))  # С12

        # Все проверки пройдены — дальше только изменения
        sport_id = self._apply_sport(user, sport_plan)
        flag = _premoderate(f"{_text(input_.get('title'))} {_text(input_.get('description'))}")
        now = _iso_now()
        place = input_["place"]
        point = self._place_point(place)
        base = {
            "title": _trim(input_.get("title"), 90),
            "description": _trim(input_.get("description"), 2000),
            "sportId": sport_id,
            "organizer": organizer,
            "createdBy": user["id"],
            "durationMin": parse_number(input_.get("durationMin")),
            "place": {
                "address": _trim(place.get("address"), 160),
                "landmark": _trim(place.get("landmark"), 160),
                **point,
            },
            "level": input_.get("level") or "any",
            "beginnersWelcome": bool(input_.get("beginnersWelcome")),
            "firstStep": self._clean_first_step(input_.get("firstStep")),
            "price": input_.get("price"),
            "paymentNote": _trim(input_.get("paymentNote"), 120),
            "cancelPolicy": input_.get("cancelPolicy") or {"kind": "anytime"},
            "joinMode": input_.get("joinMode"),
            "capacity": parse_number(input_.get("capacity")),
            "minParticipants": parse_number(input_.get("minParticipants")) or None,
            "status": EventStatus.PUBLISHED,
            "moderation": None,
            "cancelReason": "",
            "changes": [],
            "privateInfo": _trim(input_.get("privateInfo"), 500),
            "discussion": "everyone" if public_discussion(input_) else input_.get("discussion") or "everyone",
            "extra": self._clean_extra(input_.get("extra")),
            "coverUrl": input_.get("coverUrl") or None,
            "createdWithAssistant": bool(input_.get("createdWithAssistant")),
            "aiFlag": flag["flag"],
            "aiReason": flag["reason"],
            "createdAt": now,
            "updatedAt": now,
            **venues.event_venue_patch(self.db, input_),  # В4, Н1: площадка и доступная среда
            "composition": composition.clean_composition(input_.get("composition")),  # В7
            **invite_only.visibility_fields(input_),  # С13
            "family": family_,  # Н6
            "paymentMode": payments.payment_mode_of(input_),  # оплата на сайте
        }

        # Дата начала и конец повторов уже проверены в _validate_event
        first_start = clock.local(clock.parse(input_["startsAt"]))
        starts = [first_start]
        series = None
        if input_.get("repeatWeeklyUntil"):
            until = clock.parse(input_["repeatWeeklyUntil"])
            series = {"id": store.next_id("series"), "rule": "weekly", "until": clock.iso(until)}
            # Неделя прибавляется по местному календарю: встреча остаётся в то же время суток
            nxt = first_start + timedelta(weeks=1)
            while nxt <= until and len(starts) < MAX_SERIES:
                starts.append(nxt)
                nxt += timedelta(weeks=1)
        created = [
            {**base, "id": store.next_id("e"), "startsAt": clock.iso(starts_at), "series": series}
            for starts_at in starts
        ]
        self.db.append_records("events", created)
        first = created[0]
        inventory.apply_gear_lines([e["id"] for e in created], gear)  # В3

        if companion is not None:
            self._gather_from_companion(user, companion, first)
        if again_from is not None:
            again.invite_again(self.participation_host, user, again_from, first)  # С12: зовём прошлый состав
        if key:
            self._remember(key, user, "events", first["id"])
        favorites.notify_followers(self, first)  # С8: подписчикам и сохранённым поискам
        self._commit(
            ["events", "sports", "companions", "participations", "notifications", "audit", "messages"],
            [e["id"] for e in created],
            "created",
        )
        return self.event_details(user, first["id"])

    def _gather_from_companion(self, user: Entity, c: Entity, e: Entity) -> None:
        """«Собрать встречу»: откликнувшиеся на объявление сразу получают место и уведомление."""
        c["status"] = CompanionStatus.GATHERED
        c["eventId"] = e["id"]
        for m in c["metoo"]:
            user_id = m["userId"]
            if user_id == user["id"]:
                continue
            if stop_list.is_stop_listed(self.db, user_id, e, clock.now()):
                continue  # D-16: автор не пускает этого человека
            full = e.get("capacity") is not None and self._counts(e)["confirmed"] >= e["capacity"]
            self.db.participations.append(
                {
                    "id": store.next_id("p"),
                    "eventId": e["id"],
                    "userId": user_id,
                    "status": ParticipationStatus.WAITLIST if full else ParticipationStatus.CONFIRMED,
                    "prevStatus": None,
                    "note": "",
                    "rejectReason": "",
                    "source": "gathered",
                    "createdAt": _iso_now(),
                    "decidedAt": _iso_now(),
                }
            )
            self._notify(
                [user_id],
                "gathered",
                "Встреча собрана",
                f"{user['name']} собрал встречу по объявлению, на которое вы откликнулись: «{e['title']}», {_date_token(e['startsAt'])}. Вы уже в списке. Если не сможете, отмените запись в карточке.",
                f"/events/{e['id']}",
            )
        # Встреча только что создана: до откликнувшихся порог считался не набранным
        self._check_threshold(e, 0, None)

    def update_event(self, actor: Actor, event_id: ID, raw_patch: dict[str, Any]) -> Entity:
        """Правка события организатором.

        Принимаются только поля карточки (белый список), статус, организатор, пометки помощника
        и модерации из запроса не берутся. Снятое модератором событие можно исправить, участники
        об этом не уведомляются — изменения они увидят после возврата.
        """
        user = self._require_user(actor)
        e = self._get_event(event_id)
        if not self.is_organizer(user, e):
            fail("forbidden", "Изменять событие может только организатор")
        state = self.event_state(e)
        removed = state == "removed"
        current_start = clock.parse(e["startsAt"])
        if removed and current_start is not None and current_start <= clock.now():
            fail("event_inactive", "Снятое событие уже прошло, исправлять его поздно")
        if state == "live":
            fail("event_started", "Событие уже идёт, изменить его нельзя")
        if state != "upcoming" and not removed:
            fail("event_inactive", "Изменить можно только предстоящее событие")

        patch: dict[str, Any] = {k: raw_patch[k] for k in EVENT_PATCH_FIELDS if k in raw_patch}
        capacity = patch["capacity"] if "capacity" in patch else e.get("capacity")
        min_participants = (
            patch["minParticipants"] if "minParticipants" in patch else e.get("minParticipants")
        )
        errors = self._validate_event(
            {**patch, "capacity": capacity, "minParticipants": min_participants}, True
        )
        errors.update(payments.payment_mode_errors(self, e, patch))  # оплата на сайте
        if errors:
            fail("validation", "Проверьте поля формы", errors)
        confirmed_now = self._counts(e)["confirmed"]
        limit = parse_number(capacity)
        if limit is not None and limit < confirmed_now:
            fail(
                "validation",
                "Лимит меньше числа участников",
                {"capacity": f"Уже записано {confirmed_now}, лимит не может быть меньше"},
            )
        gear = inventory.clean_gear_lines(raw_patch.get("gear"))  # В3: что нужно для игры
        family_next = family.family_patch(patch)  # Н6: проверка возраста до любых изменений

        # Числа и даты уже проверены в _validate_event
        new_start = clock.parse(patch["startsAt"]) if "startsAt" in patch else None
        duration = parse_number(patch.get("durationMin"))
        new_capacity = parse_number(patch.get("capacity"))
        changes: list[Entity] = []
        if new_start is not None and new_start != current_start:
            changes.append(
                {"field": "startsAt", "label": "Время", "from": e["startsAt"], "to": clock.iso(new_start)}
            )
        if "durationMin" in patch and duration != e["durationMin"]:
            changes.append(
                {
                    "field": "duration",
                    "label": "Длительность",
                    "from": f"{_text(e['durationMin'])} мин",
                    "to": f"{_text(duration)} мин",
                }
            )
        place_patch = patch.get("place")
        address = (
            _trim(place_patch["address"], 160)
            if isinstance(place_patch, dict) and "address" in place_patch
            else None
        )
        if address and address != e["place"].get("address"):
            changes.append(
                {"field": "place", "label": "Место", "from": e["place"].get("address"), "to": address}
            )
        if "capacity" in patch and new_capacity != e.get("capacity"):
            changes.append(
                {
                    "field": "capacity",
                    "label": "Лимит мест",
                    "from": _text(e["capacity"]) if e.get("capacity") else "без лимита",
                    "to": _text(new_capacity) if new_capacity else "без лимита",
                }
            )
        if patch.get("price") is not None and patch["price"] != e["price"]:
            changes.append(
                {
                    "field": "price",
                    "label": "Стоимость",
                    "from": price_summary(e["price"], confirmed_now, e.get("minParticipants"))["main"],
                    "to": price_summary(patch["price"], confirmed_now, parse_number(min_participants))[
                        "main"
                    ],
                }
            )
        if patch.get("joinMode") and patch["joinMode"] != e["joinMode"]:
            changes.append(
                {
                    "field": "joinMode",
                    "label": "Запись",
                    "from": "свободная" if e["joinMode"] == JoinMode.OPEN else "по заявке",
                    "to": "свободная" if patch["joinMode"] == JoinMode.OPEN else "по заявке",
                }
            )
        # В7: смена состава попадает в «было → стало»; уже записавшихся не выписываем
        composition_ = composition.clean_composition(patch["composition"]) if "composition" in patch else None
        if composition_ and composition_ != composition.composition_of(e):
            changes.append(
                {
                    "field": "composition",
                    "label": "Состав",
                    "from": composition.composition_label(composition.composition_of(e)),
                    "to": composition.composition_label(composition_),
                }
            )

        before = confirmed_now
        before_min = e.get("minParticipants")
        text_changed = ("title" in patch and _trim(patch["title"], 90) != e["title"]) or (
            "description" in patch and _trim(patch["description"], 2000) != e["description"]
        )
        if "title" in patch:
            e["title"] = _trim(patch["title"], 90)
        if "description" in patch:
            e["description"] = _trim(patch["description"], 2000)
        if new_start is not None:
            e["startsAt"] = clock.iso(new_start)
        if "durationMin" in patch:
            e["durationMin"] = duration
        if "level" in patch:
            e["level"] = patch["level"]
        if "beginnersWelcome" in patch:
            e["beginnersWelcome"] = bool(patch["beginnersWelcome"])
        if "price" in patch:
            e["price"] = patch["price"]
        if "paymentNote" in patch:
            e["paymentNote"] = _trim(patch["paymentNote"], 120)
        if "cancelPolicy" in patch:
            e["cancelPolicy"] = patch["cancelPolicy"]
        if "capacity" in patch:
            e["capacity"] = new_capacity
        if "minParticipants" in patch:
            e["minParticipants"] = parse_number(patch["minParticipants"]) or None
        if "privateInfo" in patch:
            e["privateInfo"] = _trim(patch["privateInfo"], 500)
        if "discussion" in patch:
            e["discussion"] = patch["discussion"]
        if "paymentMode" in patch:
            e["paymentMode"] = payments.payment_mode_of(patch)  # оплата на сайте
        if "extra" in patch:
            e["extra"] = self._clean_extra(patch["extra"])
        if "coverUrl" in patch:
            e["coverUrl"] = patch["coverUrl"] or None
        if patch.get("firstStep") is not None:
            e["firstStep"] = self._clean_first_step(patch["firstStep"], e["firstStep"])
        if patch.get("place") is not None:
            pp = patch["place"] if isinstance(patch["place"], dict) else {}
            place = e["place"]
            nxt = {
                "address": address if address is not None else place.get("address"),
                "landmark": _trim(pp["landmark"], 160) if "landmark" in pp else place.get("landmark"),
                "districtId": pp["districtId"] if "districtId" in pp else place.get("districtId"),
            }
            # Новый адрес без точки на карте — точку пересчитываем, а не оставляем от старого места
            moved = nxt["address"] != place.get("address") or nxt["districtId"] != place.get("districtId")
            if "lat" in pp and "lng" in pp:
                point = {"districtId": nxt["districtId"], "lat": pp["lat"], "lng": pp["lng"]}
            elif moved:
                point = self._place_point(nxt)
            else:
                point = {"districtId": nxt["districtId"], "lat": place.get("lat"), "lng": place.get("lng")}
            e["place"] = {**nxt, **point}
        e.update(venues.event_venue_patch(self.db, patch, e))  # В4, Н1
        if composition_:
            e["composition"] = composition_  # В7
        e.update(invite_only.visibility_patch(patch, e))  # С13
        e.update(family_next)  # Н6
        if patch.get("joinMode") and patch["joinMode"] != e["joinMode"]:
            e["joinMode"] = patch["joinMode"]
            if patch["joinMode"] == JoinMode.OPEN and not removed:
                self._open_pending_applications(e)
        if public_discussion(e):
            e["discussion"] = "everyone"
        if text_changed:
            # Повторная предмодерация только поднимает пометку; снимает её администратор
            flag = _premoderate(f"{e['title']} {e['description']}")
            if flag["flag"] != "none":
                e["aiFlag"] = flag["flag"]
                e["aiReason"] = flag["reason"]
        e["updatedAt"] = _iso_now()

        if changes:
            e["changes"].append(
                {"id": store.next_id("ch"), "at": _iso_now(), "items": changes, "acknowledgedBy": []}
            )

            def show(v: Any) -> Any:
                return _date_token(v) if isinstance(v, str) and ISO_RE.search(v) else v

            text_ = "; ".join(
                f"{c['label'].lower()}: было {show(c['from'])}, стало {show(c['to'])}" for c in changes
            )
            if not removed:
                self._system_message(e, f"Организатор изменил событие: {text_}.")
                self._notify(
                    self._active_participant_ids(e),
                    "changed",
                    "Событие изменилось",
                    f"«{e['title']}»: {text_}. Подтвердите в карточке, что вы в курсе.",
                    f"/events/{e['id']}",
                )
            if any(c["field"] == "startsAt" for c in changes):
                self._audit(user, "event.reschedule", "event", e["id"], e["title"], text_)
        if not removed:
            self._promote_waitlist(e)
            self._check_threshold(e, before, before_min)
        inventory.replace_gear_lines(e["id"], gear)  # В3
        self._commit(
            ["events", "participations", "messages", "notifications", "audit", "admin", "inventory"],
            [e["id"]],
        )
        return self.event_details(user, event_id)

    def _open_pending_applications(self, e: Entity) -> None:
        """Запись стала свободной: ждущие заявки принимаются, пока есть места, остальные — в лист ожидания."""
        pending = sorted(
            (p for p in self._participations_of(e["id"]) if p["status"] == ParticipationStatus.PENDING),
            key=lambda p: p["createdAt"],
        )
        for p in pending:
            if e.get("capacity") is not None and self._seats_taken(e) >= e["capacity"]:
                p["status"] = ParticipationStatus.WAITLIST
                self._notify(
                    [p["userId"]],
                    "waitlist_joined",
                    "Вы в листе ожидания",
                    f"Запись на «{e['title']}» стала свободной, но мест уже нет. Если место освободится, придержим его для вас и напишем.",
                    f"/events/{e['id']}",
                )
            else:
                p["status"] = ParticipationStatus.CONFIRMED
                p["decidedAt"] = _iso_now()
                self._notify(
                    [p["userId"]],
                    "accepted",
                    "Вы в составе",
                    f"Запись на «{e['title']}» стала свободной, ваша заявка принята. {_date_token(e['startsAt'])}.",
                    f"/events/{e['id']}",
                )

    def acknowledge_changes(self, actor: Actor, event_id: ID) -> Entity:
        user = self._require_user(actor)
        e = self._get_event(event_id)
        mine = self._mine(user, e)
        if mine is None or mine["status"] not in ACTIVE_PARTICIPATION:
            fail("no_participation", "Подтвердить изменения может только участник события")
        for change in e["changes"]:
            if user["id"] not in change["acknowledgedBy"]:
                change["acknowledgedBy"].append(user["id"])
        self._commit(["events"], [e["id"]])
        return self.event_details(user, event_id)

    def cancel_event(self, actor: Actor, event_id: ID, input_: dict[str, Any] | None = None) -> Entity:
        input_ = input_ or {}
        user = self._require_user(actor)
        e = self._get_event(event_id)
        if not self.is_organizer(user, e):
            fail("forbidden", "Отменить событие может только организатор")
        if e["status"] == EventStatus.CANCELLED:
            return self.event_details(user, event_id)
        if self.event_state(e) not in OPEN_STATES:
            fail("event_inactive", "Событие уже не активно")
        reason = _trim(input_.get("reason"), 300)
        e["status"] = EventStatus.CANCELLED
        e["cancelReason"] = reason
        e["updatedAt"] = _iso_now()
        self._system_message(e, f"Организатор отменил событие{f': {reason}' if reason else '.'}")
        paid = " Если вы платили, деньги вернут полностью." if e["price"]["kind"] != "free" else ""
        self._notify(
            self._active_participant_ids(e),
            "cancelled",
            "Событие отменено",
            f"«{e['title']}» отменено организатором{f': {reason}' if reason else '.'}{paid}{plan_b.plan_b_hint(self.participation_host, e)}",
            f"/events/{e['id']}#plan-b",  # С6: в карточке — похожие встречи
        )
        payments.on_event_canceled(self, e)  # оплата на сайте: полный возврат
        self._audit(user, "event.cancel", "event", e["id"], e["title"], reason)
        self._commit(["events", "participations", "messages", "notifications", "audit"], [e["id"]])
        return self.event_details(user, event_id)

    def delete_own_event(self, actor: Actor, event_id: ID) -> Entity:
        """Удалить своё событие можно только без участников, иначе только отменить."""
        user = self._require_user(actor)
        e = self._get_event(event_id)
        if not self.is_organizer(user, e):
            fail("forbidden", "Удалить событие может только организатор")
        if e["status"] == EventStatus.DELETED:
            if e.get("moderation") is None:
                return {"id": e["id"]}
            fail("event_deleted", "Событие уже удалено модератором")
        if len(self._active_participant_ids(e)):
            fail(
                "has_participants",
                "На событие уже записались люди. Отмените его: участники получат уведомление",
            )
        e["status"] = EventStatus.DELETED
        e["moderation"] = None
        e["updatedAt"] = _iso_now()
        self._commit(["events"], [e["id"]], "deleted")
        return {"id": e["id"]}

    def appeal_event(self, actor: Actor, event_id: ID, input_: dict[str, Any] | None = None) -> Entity:
        """«Попросить вернуть»: организатор исправил снятое событие и просит администратора посмотреть снова."""
        input_ = input_ or {}
        user = self._require_user(actor)
        e = self._get_event(event_id)
        if not self.is_organizer(user, e):
            fail("forbidden", "Попросить вернуть событие может только организатор")
        if e["status"] != EventStatus.REMOVED or e.get("moderation") is None:
            fail("event_inactive", "Просить вернуть можно только событие, снятое модератором")
        start = clock.parse(e["startsAt"])
        if start is not None and start <= clock.now():
            fail("event_inactive", "Событие уже прошло, вернуть его нельзя")
        comment = _trim(input_.get("comment"), 600)
        e["moderation"]["appeal"] = {"at": _iso_now(), "comment": comment}
        e["updatedAt"] = _iso_now()
        self._notify(
            self._admin_ids(),
            "appeal",
            "Просят вернуть событие",
            f"{user['name']} исправил «{e['title']}» и просит вернуть его в публикацию.{f' Комментарий: «{comment}»' if comment else ''}",
            f"/admin/events/{e['id']}",
        )
        self._notify(
            [user["id"]],
            "appeal",
            "Запрос отправлен",
            f"Администратор посмотрит «{e['title']}» ещё раз. Решение придёт сюда же.",
            f"/events/{e['id']}",
        )
        self._audit(user, "event.appeal", "event", e["id"], e["title"], comment)
        self._commit(["events", "notifications", "audit", "admin"], [e["id"]])
        return self.event_details(user, event_id)

    def _active_participant_ids(self, e: Entity) -> list[ID]:
        return [p["userId"] for p in self._participations_of(e["id"]) if p["status"] in ACTIVE_PARTICIPATION]

    # ---------- Модерация событий ----------

    def moderate_event(self, actor: Actor, event_id: ID, input_: dict[str, Any]) -> Entity:
        """`input_`: `action` ('remove' | 'restore' | 'delete'), `ruleId`, `comment`."""
        admin = self._require_admin(actor)
        e = self._get_event(event_id)
        action_ = input_.get("action")
        if action_ not in ("remove", "restore", "delete"):
            fail("bad_request", "Неизвестное действие")
        # Повтор того же решения возвращает текущее состояние
        if (
            (action_ == "remove" and e["status"] == EventStatus.REMOVED)
            or (action_ == "delete" and e["status"] == EventStatus.DELETED)
            or (action_ == "restore" and e["status"] == EventStatus.PUBLISHED)
        ):
            return self.event_details(admin, e["id"])
        comment = _trim(input_.get("comment"), 400)
        rule = None
        if input_.get("ruleId"):
            rule = _by_id(self.db.rules, input_["ruleId"])
            if rule is None:
                fail("validation", "Такого пункта правил нет")
        if action_ != "restore" and rule is None:
            fail(
                "reason_required",
                "Выберите пункт правил. Его увидят организатор и участники",
                {"ruleId": "Выберите пункт правил"},
            )
        rule_id = rule["id"] if rule is not None else None
        why = _moderation_reason(rule, comment)
        organizers = self._organizer_user_ids(e)
        ps = self._participations_of(e["id"])
        # Куда вернуть событие, если модератор передумает: снятое было опубликованным,
        # отменённое организатором после удаления и возврата остаётся отменённым.
        moderated = e["status"] in (EventStatus.REMOVED, EventStatus.DELETED)
        prev_status = (e.get("moderation") or {}).get("prevStatus") if moderated else e["status"]

        if action_ == "remove":
            if e["status"] != EventStatus.PUBLISHED:
                fail("event_inactive", "Снять можно только опубликованное событие")
            e["status"] = EventStatus.REMOVED
            _freeze_participations(ps)
            self._system_message(e, f"Событие снято с публикации модератором: {why}.")
            self._notify(
                organizers,
                "removed",
                "Событие снято с публикации",
                f"«{e['title']}» снято модератором: {why}. Записи участников приостановлены и восстановятся, "
                "когда событие вернут. Исправьте карточку и нажмите «Попросить вернуть».",
                f"/events/{e['id']}",
            )
            self._notify(
                [p["userId"] for p in ps if p["status"] == ParticipationStatus.EVENT_REMOVED],
                "removed",
                "Событие снято с публикации",
                f"«{e['title']}» снято модератором. Ваша запись приостановлена: если событие вернут, "
                f"она восстановится сама. Причина: {why}.",
                f"/events/{e['id']}",
            )
        elif action_ == "delete":
            e["status"] = EventStatus.DELETED
            _freeze_participations(ps)  # заявки и лист ожидания тоже: иначе встреча молча пропадёт из списков
            payments.on_event_canceled(self, e, "Администратор удалил встречу")  # оплата на сайте
            self._notify(
                [*organizers, *(p["userId"] for p in ps if p["status"] == ParticipationStatus.EVENT_REMOVED)],
                "deleted",
                "Событие удалено",
                f"«{e['title']}» удалено модератором: {why}.",
                f"/events/{e['id']}",
            )
        else:
            if e["status"] == EventStatus.DELETED and e.get("moderation") is None:
                fail("event_inactive", "Организатор удалил событие сам, вернуть его нельзя")
            if e["status"] not in (EventStatus.REMOVED, EventStatus.DELETED):
                fail("event_inactive", "Вернуть можно только снятое или удалённое событие")
            for p in ps:
                if p["status"] == ParticipationStatus.EVENT_REMOVED:
                    p["status"] = p.get("prevStatus") or ParticipationStatus.CONFIRMED
                    p["prevStatus"] = None
            if prev_status == EventStatus.CANCELLED:
                # Отмену организатора модератор не отменяет: событие возвращается в историю отменённым.
                e["status"] = EventStatus.CANCELLED
                self._system_message(e, "Модератор отменил удаление. Событие остаётся отменённым.")
                self._notify(
                    organizers,
                    "restored",
                    "Удаление отменено",
                    f"«{e['title']}» снова видно в истории как отменённое.",
                    f"/events/{e['id']}",
                )
            else:
                e["status"] = EventStatus.PUBLISHED
                self._system_message(e, "Модератор вернул событие в публикацию.")
                back = [p["userId"] for p in ps if p["status"] in ACTIVE_PARTICIPATION]
                self._notify(
                    organizers,
                    "restored",
                    "Событие снова опубликовано",
                    f"«{e['title']}» вернули в публикацию.",
                    f"/events/{e['id']}",
                )
                self._notify(
                    back,
                    "restored",
                    "Событие снова опубликовано",
                    f"«{e['title']}» вернули в публикацию, ваша запись восстановлена. Проверьте карточку: организатор мог её изменить.",
                    f"/events/{e['id']}",
                )
        e["moderation"] = (
            None
            if action_ == "restore"
            else {
                "action": "removed" if action_ == "remove" else "deleted",
                "ruleId": rule_id,
                "comment": comment,
                "by": admin["id"],
                "at": _iso_now(),
                "appeal": None,
                "prevStatus": prev_status or EventStatus.PUBLISHED,
            }
        )
        if action_ == "restore":
            e["aiFlag"] = "none"
            e["aiReason"] = ""
        e["updatedAt"] = _iso_now()
        action = {"remove": "event.remove", "restore": "event.restore", "delete": "event.delete"}[action_]
        self._audit_entry(admin, action, "event", e["id"], e["title"], comment, rule_id)
        self._commit(["events", "participations", "messages", "notifications", "audit", "admin"], [e["id"]])
        return self.event_details(admin, e["id"])

    def dismiss_event_flag(self, actor: Actor, event_id: ID) -> Entity:
        """«Оставить» в очереди помощника: админ снимает пометку, ничего не скрывая, и это попадает в журнал."""
        admin = self._require_admin(actor)
        e = self._get_event(event_id)
        if e["aiFlag"] == "none":
            return self.event_details(admin, e["id"])
        reason = e["aiReason"]
        e["aiFlag"] = "none"
        e["aiReason"] = ""
        self._audit(
            admin,
            "event.keep",
            "event",
            e["id"],
            e["title"],
            f"Пометка помощника: {reason}" if reason else "",
        )
        self._commit(["events", "audit", "admin"], [e["id"]])
        return self.event_details(admin, e["id"])

    # ---------- Обсуждение ----------

    def message_view(self, actor: Actor, m: Entity) -> Entity:
        e = self._event(m["eventId"])
        author = self.user(m.get("authorId"))
        org = self._org(m["asOrgId"]) if m.get("asOrgId") else None
        is_admin = _is_admin(actor)
        hidden_for_viewer = m["status"] == MessageStatus.DELETED or (
            m["status"] == MessageStatus.HIDDEN and not is_admin
        )
        return {
            **m,
            "text": None if hidden_for_viewer else self.render_text(m["text"]),
            # Пометку помощника и её причину (с цитатой) видит только администратор
            "aiFlag": m["aiFlag"] if is_admin else "none",
            "aiReason": m["aiReason"] if is_admin else "",
            "author": None
            if m.get("system") or author is None
            else {
                **self.person(author),
                "isOrganizer": author["id"] in self._organizer_user_ids(e) if e is not None else False,
                "orgName": org["name"] if org is not None else None,
                "orgLogoUrl": org.get("logoUrl") if org is not None else None,
            },
            "mine": bool(actor is not None and actor["id"] == m.get("authorId")),
            "myReactions": [k for k, ids in m["reactions"].items() if actor["id"] in ids]
            if actor is not None
            else [],
            "event": {"id": m["eventId"], "title": e["title"] if e is not None else ""},
        }

    def list_messages(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `eventId`, `invite`, `scope` ('flagged' | 'all' | 'hidden')."""
        q = q or {}
        if q.get("scope"):
            self._require_admin(actor)
            rows = [m for m in self.db.messages if not m["system"]]
            if q["scope"] == "flagged":
                rows = [m for m in rows if m["aiFlag"] != "none" and m["status"] == MessageStatus.VISIBLE]
            if q["scope"] == "hidden":
                rows = [m for m in rows if m["status"] == MessageStatus.HIDDEN]
            return [
                self.message_view(actor, m) for m in sorted(rows, key=lambda m: m["createdAt"], reverse=True)
            ]
        if not q.get("eventId"):
            fail("bad_request", "Укажите событие")
        e = self._get_event(q["eventId"])
        invite_only.assert_invite_access(self.db, actor, e, self.is_organizer(actor, e), q.get("invite"))
        if e["status"] == EventStatus.DELETED and not _is_admin(actor) and not self.is_organizer(actor, e):
            fail("event_deleted", "Событие удалено")
        # Читать обсуждение может любой: режим «только участники» ограничивает только запись (canAsk).
        return [
            self.message_view(actor, m)
            for m in sorted(
                (m for m in self.db.messages if m["eventId"] == e["id"]), key=lambda m: m["createdAt"]
            )
        ]

    def post_message(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        user = self._require_user(actor)
        key = _trim(input_.get("idempotencyKey"), 80)
        done = self._recalled(key, user, "messages")
        existing = _by_id(self.db.messages, done) if done else None
        if existing is not None:
            return self.message_view(user, existing)
        e = self._get_event(input_.get("eventId"))
        invite_only.assert_invite_access(self.db, user, e, self.is_organizer(user, e))
        ask = self._can_ask(user, e, self._mine(user, e))
        if not ask["ok"]:
            fail("discussion_closed", ask["reason"])
        text_ = _trim(input_.get("text"), 1000)
        if not text_:
            fail("validation", "Напишите сообщение", {"text": "Напишите сообщение"})
        reply_to = input_.get("replyTo")
        parent = None
        if reply_to:
            parent = next(
                (m for m in self.db.messages if m["id"] == reply_to and m["eventId"] == e["id"]), None
            )
            if parent is None:
                fail("validation", "Сообщение, на которое вы отвечаете, не найдено")

        now = clock.now()
        recent = [t for t in self._recent_messages.get(user["id"], []) if now - t < MESSAGE_WINDOW]
        if len(recent) >= MESSAGE_LIMIT:
            fail("rate_limit", "Вы пишете слишком часто. Подождите полминуты")
        self._recent_messages[user["id"]] = [*recent, now]

        organizers = self._organizer_user_ids(e)
        from_organizer = user["id"] in organizers
        flag = _premoderate(text_)
        message = {
            "id": store.next_id("m"),
            "eventId": e["id"],
            "authorId": user["id"],
            "asOrgId": e["organizer"]["id"] if from_organizer and e["organizer"]["kind"] == "org" else None,
            "text": text_,
            "replyTo": parent["id"] if parent is not None else None,
            "reactions": {},
            "status": MessageStatus.VISIBLE,
            "hiddenReason": "",
            "hiddenBy": None,
            "system": False,
            "aiFlag": flag["flag"],
            "aiReason": flag["reason"],
            "createdAt": clock.iso(now),
        }
        self.db.messages.append(message)
        if not from_organizer:
            self._notify(
                organizers,
                "question",
                "Вопрос в обсуждении",
                f"{user['name']} пишет в «{e['title']}»: «{text_[:80]}»",
                f"/events/{e['id']}#discussion",
            )
        if parent is not None and parent.get("authorId") and parent["authorId"] != user["id"]:
            self._notify(
                [parent["authorId"]],
                "answer",
                "Организатор ответил" if from_organizer else "Вам ответили",
                f"«{e['title']}»: {text_[:100]}",
                f"/events/{e['id']}#discussion",
            )
        if key:
            self._remember(key, user, "messages", message["id"])
        self._commit(["messages", "notifications", "events", "admin"], [e["id"]], "created")
        return self.message_view(user, message)

    def react(self, actor: Actor, message_id: ID, key: str) -> Entity:
        user = self._require_user(actor)
        m = _by_id(self.db.messages, message_id)
        if m is None:
            fail("not_found", "Сообщение не найдено")
        if key not in ("thanks", "agree", "going"):
            fail("bad_request", "Такой реакции нет")
        if m.get("system") or m["status"] != MessageStatus.VISIBLE:
            fail("message_unavailable", "На это сообщение нельзя отреагировать")
        ids = m["reactions"].get(key) or []
        m["reactions"][key] = (
            [id_ for id_ in ids if id_ != user["id"]] if user["id"] in ids else [*ids, user["id"]]
        )
        self._commit(["messages"], [m["eventId"]])
        return self.message_view(user, m)

    def delete_own_message(self, actor: Actor, message_id: ID) -> Entity:
        user = self._require_user(actor)
        m = _by_id(self.db.messages, message_id)
        if m is None:
            fail("not_found", "Сообщение не найдено")
        if m.get("authorId") != user["id"]:
            fail("forbidden", "Удалить можно только своё сообщение")
        if m["status"] == MessageStatus.DELETED:
            return self.message_view(user, m)
        m["status"] = MessageStatus.DELETED
        self._commit(["messages"], [m["eventId"]])
        return self.message_view(user, m)

    def moderate_message(self, actor: Actor, message_id: ID, input_: dict[str, Any]) -> Entity:
        """Скрыть может админ (любое) или организатор (в своём событии).

        Скрытое админом организатор вернуть не может. «Оставить» снимает пометку помощника — это
        решение администратора, оно попадает в журнал.
        """
        user = self._require_user(actor)
        m = _by_id(self.db.messages, message_id)
        if m is None:
            fail("not_found", "Сообщение не найдено")
        e = self._get_event(m["eventId"])
        is_admin = user["role"] == "admin"
        if not is_admin and not self.is_organizer(user, e):
            fail("forbidden", "Скрывать сообщения может администратор или организатор события")
        if m.get("system"):
            fail("message_unavailable", "Системные сообщения не модерируются")
        if m["status"] == MessageStatus.DELETED:
            fail("message_unavailable", "Автор уже удалил это сообщение")
        rule = _by_id(self.db.rules, input_["ruleId"]) if input_.get("ruleId") else None
        rule_id = rule["id"] if rule is not None else None
        reason = _trim(input_.get("reason"), 300) or (
            f"Правило {rule['number']}: {rule['title']}" if rule is not None else ""
        )
        title = f"Сообщение в «{e['title']}»"
        action = input_.get("action")
        if action == "hide":
            if m["status"] == MessageStatus.HIDDEN:
                return self.message_view(user, m)
            if len(reason) < 3:
                fail("reason_required", "Укажите причину скрытия", {"reason": "Укажите причину"})
            m["status"] = MessageStatus.HIDDEN
            m["hiddenReason"] = reason
            m["hiddenBy"] = "admin" if is_admin else "organizer"
            if m.get("authorId") and m["authorId"] != user["id"]:
                self._notify(
                    [m["authorId"]],
                    "message_hidden",
                    "Сообщение скрыто",
                    f"Ваше сообщение в «{e['title']}» скрыто: {reason}.",
                    f"/events/{e['id']}#discussion",
                )
            self._audit_entry(user, "message.hide", "message", m["id"], title, reason, rule_id)
        elif action == "restore":
            if m["status"] == MessageStatus.VISIBLE:
                return self.message_view(user, m)
            if not is_admin and m.get("hiddenBy") == "admin":
                fail("forbidden", "Это сообщение скрыл администратор, вернуть его может только он")
            m["status"] = MessageStatus.VISIBLE
            m["hiddenReason"] = ""
            m["hiddenBy"] = None
            self._audit_entry(user, "message.restore", "message", m["id"], title, reason, None)
        elif action == "keep":
            if not is_admin:
                fail("forbidden", "Снять пометку помощника может только администратор")
            if m["aiFlag"] == "none":
                return self.message_view(user, m)
            self._audit_entry(
                user, "message.keep", "message", m["id"], title, f"Пометка помощника: {m['aiReason']}", None
            )
        else:
            fail("bad_request", "Неизвестное действие")
        if is_admin:
            m["aiFlag"] = "none"
            m["aiReason"] = ""
        self._commit(["messages", "notifications", "audit", "admin"], [e["id"]])
        return self.message_view(user, m)

    def _system_message(self, e: Entity, text: str) -> None:
        self.db.messages.append(
            {
                "id": store.next_id("m"),
                "eventId": e["id"],
                "authorId": None,
                "asOrgId": None,
                "text": text,
                "replyTo": None,
                "reactions": {},
                "status": MessageStatus.VISIBLE,
                "hiddenReason": "",
                "hiddenBy": None,
                "system": True,
                "aiFlag": "none",
                "aiReason": "",
                "createdAt": _iso_now(),
            }
        )

    # ---------- Направления ----------

    def list_sports(self, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `q` (поиск — подсказки SportSuggestion), `kind`, `categoryId`, `includeMerged`,
        `includeHidden` (скрытые администратором — для админки)."""
        q = q or {}
        shown = self.db.sports if q.get("includeHidden") else _shown(self.db.sports)
        if q.get("q"):
            return assistant.suggest_sports(q["q"], shown, 10)
        rows = [
            s
            for s in shown
            if (q.get("includeMerged") or not s.get("mergedInto"))
            and (not q.get("kind") or s["kind"] == q["kind"])
            and (not q.get("categoryId") or q["categoryId"] in s["categoryIds"])
        ]
        rows.sort(key=_catalog_order)
        return [
            {
                **self.sport_view(s["id"]),
                "id": s["id"],
                "name": s["name"],
                "kind": s["kind"],
                "hidden": bool(s.get("hidden")),
            }
            for s in rows
        ]

    def sport_details(self, id_: ID) -> Entity:
        s = self._sport(id_)
        if s is None:
            fail("not_found", "Направление не найдено")
        from app.domain.event_reads import count
        table = COLLECTIONS["events"].table
        event_count = count(self.db, table.c.sport_id == s["id"], predicate=lambda e: e["sportId"] == s["id"])
        return {
            **self.sport_view(s["id"]),
            "id": s["id"],
            "name": s["name"],
            "kind": s["kind"],
            "mergedInto": s.get("mergedInto"),
            "createdBy": self.person(self.user(s["createdBy"])) if s.get("createdBy") else None,
            "createdAt": s.get("createdAt"),
            "eventsCount": event_count,
            "similar": assistant.suggest_sports(
                s["name"],
                [x for x in self.db.sports if x["id"] != s["id"]],
                3,
            ),
        }

    def list_categories(self, q: dict[str, Any] | None = None) -> list[Entity]:
        """Разделы каталога с направлениями; скрытые — только с `includeHidden` (админка)."""
        all_ = bool((q or {}).get("includeHidden"))
        sports = self.db.sports if all_ else _shown(self.db.sports)
        return [
            {
                **c,
                "sports": [
                    self.sport_view(s["id"])
                    for s in sorted(
                        (s for s in sports if not s.get("mergedInto") and c["id"] in s["categoryIds"]),
                        key=_catalog_order,
                    )
                ],
            }
            for c in sorted(self.db.categories, key=lambda c: c.get("order") or 0)
            if all_ or not c.get("hidden")
        ]

    def create_sport(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        """Своё направление пользователь добавляет вместе с событием или объявлением, а не отдельно.

        Так в каталоге не копятся названия без единой встречи. Совпадение с каталогом возвращается сразу.
        """
        user = self._require_user(actor)
        plan = self._plan_sport(None, input_.get("name"), input_.get("confirmNew"))
        if "id" in plan:
            return self.sport_view(plan["id"])
        if user["role"] != "admin":
            fail("forbidden", "Своё направление добавляется вместе с событием или объявлением «Ищу компанию»")
        id_ = self._apply_sport(user, plan)
        self._commit(["sports", "audit", "admin"], [id_], "created")
        return self.sport_view(id_)

    def promote_sport(self, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
        """`input_`: `icon`, `categoryIds`, `popular`."""
        admin = self._require_admin(actor)
        s = self._sport(id_)
        if s is None:
            fail("not_found", "Направление не найдено")
        category_ids = _list(input_.get("categoryIds"), "categoryIds", "Выберите категории из списка")
        s["kind"] = "catalog"
        if "icon" in input_:
            s["icon"] = input_["icon"]
        if input_.get("categoryIds") is not None:
            s["categoryIds"] = [c for c in category_ids if any(x["id"] == c for x in self.db.categories)]
        if "popular" in input_:
            s["popular"] = input_["popular"]
        self._audit(admin, "sport.promote", "sport", s["id"], s["name"], "Добавлено в каталог")
        self._commit(["sports", "audit", "admin"], [s["id"]])
        return self.sport_view(s["id"])

    def merge_sport(self, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
        admin = self._require_admin(actor)
        s = self._sport(id_)
        if s is None:
            fail("not_found", "Направление не найдено")
        target = self._sport(input_.get("into"))
        if target is None:
            fail("validation", "Выберите, с каким направлением объединить", {"into": "Выберите направление"})
        if target["id"] == s["id"]:
            fail("validation", "Нельзя объединить направление само с собой")
        if target.get("mergedInto"):
            fail("validation", "Это направление само объединено с другим, выберите основное")

        def swap(ids: list[ID]) -> list[ID]:
            return list(dict.fromkeys(target["id"] if x == s["id"] else x for x in ids))

        for e in self.db.records("events", COLLECTIONS["events"].table.c.sport_id == s["id"],
                                 predicate=lambda e: e["sportId"] == s["id"]):
            e["sportId"] = target["id"]
        for c in self.db.companions:
            if c["sportId"] == s["id"]:
                c["sportId"] = target["id"]
        for o in self.db.organizations:
            o["sportIds"] = swap(o["sportIds"])
        for u in self.db.users:
            u["interests"] = swap(u["interests"])
            if u["levels"].get(s["id"]) and not u["levels"].get(target["id"]):
                u["levels"][target["id"]] = u["levels"][s["id"]]
            u["levels"].pop(s["id"], None)
        target["synonyms"] = list(dict.fromkeys([*target["synonyms"], s["name"].lower(), *s["synonyms"]]))
        s["mergedInto"] = target["id"]
        self._audit(admin, "sport.merge", "sport", s["id"], s["name"], f"Объединено с «{target['name']}»")
        self._commit(
            ["sports", "events", "companions", "organizations", "audit", "admin"],
            [s["id"], target["id"]],
        )
        return self.sport_view(target["id"])

    # ---------- Организации ----------

    def organization_view(self, actor: Actor, o: Entity, *, include_similar: bool = True) -> Entity:
        is_owner = bool(actor is not None and actor["id"] == o["ownerId"])
        is_admin = _is_admin(actor)
        manager = managers.is_manager(o["id"], actor["id"] if actor is not None else None)  # С14
        privileged = is_owner or is_admin or manager
        from app.domain.event_reads import project
        table = COLLECTIONS["events"].table
        own_events = project(self.db, {"id", "organizer", "status", "startsAt", "durationMin"},
                             table.c.organizer_kind == "org", table.c.organizer_id == o["id"],
                             predicate=lambda e: e["organizer"] == {"kind": "org", "id": o["id"]})
        n = normalize(o["name"])
        suspension = o.get("suspension")
        # Остальным — без владельца и истории решений (в ней id администраторов и причины отказов);
        # дата допуска остаётся для подписи «на платформе с…».
        visible = o if privileged else {k: v for k, v in o.items() if k != "ownerId"}
        return {
            **visible,
            "reviews": o["reviews"]
            if privileged
            else [
                {**r, "adminId": None, "reason": ""}
                for r in o["reviews"]
                if r["decision"] == OrganizationStatus.APPROVED
            ],
            "contacts": o["contacts"]
            if o["status"] == OrganizationStatus.APPROVED or is_owner or is_admin
            else {"phone": "", "email": "", "social": ""},
            "sports": [self.sport_view(id_) for id_ in o["sportIds"]],
            "typeLabel": ORG_TYPE.get(o["type"]) if isinstance(o.get("type"), str) else None,
            "facts": self._organizer_facts({"kind": "org", "id": o["id"]}, own_events),
            "isOwner": is_owner,
            "isManager": manager,
            "lastReview": o["reviews"][-1] if privileged and o["reviews"] else None,
            "owner": self.person(self.user(o["ownerId"])) if privileged else None,
            "eventsCount": len(
                [
                    e
                    for e in own_events
                    if e["organizer"]["kind"] == "org"
                    and e["organizer"]["id"] == o["id"]
                    and e["status"] != EventStatus.DELETED
                ]
            ),
            "similar": [
                x["name"]
                for x in self.db.organizations
                if x["id"] != o["id"] and abs(len(normalize(x["name"])) - len(n)) <= 4
                and edit_distance(normalize(x["name"]), n) <= 4
            ]
            if is_admin and include_similar
            else [],
            "coverUrl": o.get("coverUrl"),
            "aiFlag": o["aiFlag"] if is_admin else "none",
            "aiReason": o["aiReason"] if is_admin else "",
            # С17: причину приостановки видят только представитель и администратор
            "suspension": {**suspension, **({} if is_owner or is_admin else {"reason": "", "by": ""})}
            if suspension is not None
            else None,
        }

    def list_organizations(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `scope` ('public' | 'mine' | 'admin'), `status`, `q`, `aiFlagged`."""
        q = q or {}
        scope = q.get("scope") or "public"
        rows = self.db.organizations
        if scope == "admin":
            self._require_admin(actor)
        if scope == "mine":
            rows = [o for o in rows if o["ownerId"] == self._require_user(actor)["id"]]
        if scope == "public":
            rows = [o for o in rows if o["status"] == OrganizationStatus.APPROVED]
        if q.get("status"):
            rows = [o for o in rows if o["status"] == q["status"]]
        if q.get("aiFlagged"):
            rows = [o for o in rows if o["aiFlag"] != "none"]
        if q.get("q"):
            query = normalize(_text(q["q"]))
            rows = [o for o in rows if query in normalize(f"{o['name']} {o['description']}")]
        # Свежие изменения сверху; администратору — сначала то, что ждёт решения
        rows = sorted(rows, key=lambda o: o["updatedAt"], reverse=True)
        if scope == "admin":
            order = {
                OrganizationStatus.PENDING: 0,
                OrganizationStatus.RETURNED: 1,
                OrganizationStatus.REJECTED: 2,
                OrganizationStatus.DRAFT: 3,
                OrganizationStatus.APPROVED: 4,
                OrganizationStatus.BLOCKED: 5,
            }
            rows.sort(key=lambda o: order.get(o["status"], len(order)))
        return [self.organization_view(actor, o, include_similar=False) for o in rows]

    def organization_details(self, actor: Actor, id_: ID) -> Entity:
        """Публичная страница появляется только после допуска; представитель и админ видят её всегда."""
        o = self._get_org(id_)
        privileged = (
            _is_admin(actor)
            or (actor is not None and actor["id"] == o["ownerId"])
            or managers.is_manager(o["id"], actor["id"] if actor is not None else None)
        )  # С14
        if o["status"] != OrganizationStatus.APPROVED and not privileged:
            fail("not_found", "Страница организации пока недоступна: её ещё не проверил администратор")
        return self.organization_view(actor, o)

    def _validate_org(self, input_: dict[str, Any]) -> dict[str, str]:
        errors: dict[str, str] = {}
        if len(_trim(input_.get("name"), 80)) < 3:
            errors["name"] = "Напишите название, хотя бы 3 буквы"
        type_ = input_.get("type")
        if not (isinstance(type_, str) and ORG_TYPE.get(type_)):
            errors["type"] = "Выберите тип организации"
        if len(_trim(input_.get("description"), 1500)) < 30:
            errors["description"] = "Расскажите подробнее, чем вы занимаетесь: хотя бы 30 знаков"
        sport_ids = input_.get("sportIds")
        if not (isinstance(sport_ids, list) and sport_ids):
            errors["sportIds"] = "Выберите хотя бы одно направление"
        contacts = input_.get("contacts")
        if not _trim(_field(contacts, "phone"), 40) and not _trim(_field(contacts, "email"), 80):
            errors["contacts"] = "Укажите телефон или почту для связи"
        return errors

    @staticmethod
    def _org_media(input_: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
        """Логотип и обложка из `input_`: пустое значение снимает картинку. Ключей нет — нет изменений."""
        values: dict[str, Any] = {}
        errors: dict[str, str] = {}
        for key in ("logoUrl", "coverUrl"):
            if key not in input_:
                continue
            value = None if input_[key] in (None, "") else input_[key]
            values[key] = value
            if value is None:
                continue
            if key == "logoUrl" and not valid_org_logo(value):
                errors[key] = (
                    "Логотип не подошёл. Выберите готовый знак или загрузите картинку JPEG, PNG или WebP"
                )
            if key == "coverUrl" and not valid_event_image(value):
                errors[key] = "Обложка не подошла. Загрузите фото в формате JPEG, PNG или WebP"
        return values, errors

    def create_organization(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        """`input_` — OrganizationInput и `submit`: сразу отправить на проверку."""
        user = self._require_user(actor)
        if user["role"] == "admin":
            fail("forbidden", "Администратор не регистрирует организации")
        submit = bool(input_.get("submit"))
        media, media_errors = self._org_media(input_)
        if submit:
            errors = {**self._validate_org(input_), **media_errors}
            if errors:
                fail("validation", "Проверьте поля заявки", errors)
        elif len(_trim(input_.get("name"), 80)) < 3:
            fail("validation", "Напишите название, чтобы сохранить черновик", {"name": "Напишите название"})
        elif media_errors:
            fail("validation", "Проверьте поля заявки", media_errors)
        sport_ids = _list(input_.get("sportIds"), "sportIds", "Выберите направления из списка")
        flag = _premoderate_organization(input_)
        now = _iso_now()
        contacts = input_.get("contacts")
        o = {
            "id": store.next_id("o"),
            "name": _trim(input_.get("name"), 80),
            "type": input_.get("type"),
            "description": _trim(input_.get("description"), 1500),
            "sportIds": [id_ for id_ in sport_ids if self._sport(id_) is not None],
            "city": _trim(input_.get("city"), 40) or "Красноярск",
            "districtId": input_.get("districtId"),
            "address": _trim(input_.get("address"), 160),
            "contacts": {
                "phone": _trim(_field(contacts, "phone"), 40),
                "email": _trim(_field(contacts, "email"), 80),
                "social": _trim(_field(contacts, "social"), 120),
            },
            "logoUrl": media.get("logoUrl"),
            "coverUrl": media.get("coverUrl"),
            "ownerId": user["id"],
            "status": OrganizationStatus.PENDING if submit else OrganizationStatus.DRAFT,
            "reviews": [
                {"id": store.next_id("rv"), "decision": "submitted", "reason": "", "adminId": None, "at": now}
            ]
            if submit
            else [],
            "createdWithAssistant": bool(input_.get("createdWithAssistant")),
            "aiFlag": flag["flag"],
            "aiReason": flag["reason"],
            "createdAt": now,
            "updatedAt": now,
        }
        self.db.organizations.append(o)
        if submit:
            self._on_submitted(o, user)
        self._commit(["organizations", "notifications", "users", "admin"], [o["id"]], "created")
        return self.organization_view(user, o)

    def _on_submitted(self, o: Entity, owner: Entity) -> None:
        self._notify(
            self._admin_ids(),
            "org_submitted",
            "Новая заявка организации",
            f"«{o['name']}» ждёт решения.{' Помощник пометил заявку.' if o['aiFlag'] != 'none' else ''}",
            f"/admin/organizations/{o['id']}",
        )
        self._notify(
            [owner["id"]],
            "org_submitted",
            "Заявка отправлена",
            f"«{o['name']}» на проверке. Обычно это занимает до одного дня.",
            f"/org/{o['id']}",
        )

    def update_organization(self, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
        """`input_` — часть OrganizationInput и `submit`: отправить на проверку."""
        user = self._require_user(actor)
        o = self._get_org(id_)
        if o["ownerId"] != user["id"]:
            fail("forbidden", "Изменять организацию может только её представитель")
        if o["status"] == OrganizationStatus.PENDING:
            fail("org_wrong_status", "Заявка на проверке. Изменить её можно после решения администратора")
        if o["status"] == OrganizationStatus.BLOCKED:
            fail("org_wrong_status", "Организация заблокирована")
        submit = bool(input_.get("submit"))
        _list(input_.get("sportIds"), "sportIds", "Выберите направления из списка")

        def pick(key: str) -> Any:
            """Новое значение поля или прежнее, если поле не передано (null — тоже «не передано»)."""
            value = input_.get(key)
            return o.get(key) if value is None else value

        merged = {
            "name": pick("name"),
            "type": pick("type"),
            "description": pick("description"),
            "sportIds": pick("sportIds"),
            "city": pick("city"),
            "districtId": input_["districtId"] if "districtId" in input_ else o.get("districtId"),
            "address": pick("address"),
            "contacts": pick("contacts"),
        }
        media, media_errors = self._org_media(input_)
        errors = self._validate_org(merged)
        strict = submit or o["status"] == OrganizationStatus.APPROVED
        shown = {**(errors if strict else {}), **media_errors}
        if shown:
            fail("validation", "Проверьте поля заявки", shown)
        o.update(
            {
                **merged,
                **media,
                "name": _trim(merged["name"], 80),
                "description": _trim(merged["description"], 1500),
                "address": _trim(merged["address"], 160),
                "updatedAt": _iso_now(),
            }
        )
        if submit and o["status"] in (
            OrganizationStatus.DRAFT,
            OrganizationStatus.REJECTED,
            OrganizationStatus.RETURNED,
        ):
            flag = _premoderate_organization(merged)
            o["aiFlag"] = flag["flag"]
            o["aiReason"] = flag["reason"]
            o["status"] = OrganizationStatus.PENDING
            o["reviews"].append(
                {
                    "id": store.next_id("rv"),
                    "decision": "submitted",
                    "reason": "",
                    "adminId": None,
                    "at": _iso_now(),
                }
            )
            self._on_submitted(o, user)
        self._commit(["organizations", "notifications", "admin"], [o["id"]])
        return self.organization_view(user, o)

    def decide_organization(self, actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
        """`input_`: `decision` ('approve' | 'reject' | 'return'), `reason`."""
        admin = self._require_admin(actor)
        o = self._get_org(id_)
        # Решение → статус организации (он же записывается в историю решений), действие журнала, уведомление.
        decisions = {
            "approve": (OrganizationStatus.APPROVED, "org.approve", "org_approved"),
            "reject": (OrganizationStatus.REJECTED, "org.reject", "org_rejected"),
            "return": (OrganizationStatus.RETURNED, "org.return", "org_returned"),
        }
        decision_ = input_.get("decision")
        if not (isinstance(decision_, str) and decision_ in decisions):
            fail("bad_request", "Неизвестное решение")
        status, action, type_ = decisions[decision_]
        # Повтор того же решения (двойное нажатие, вторая вкладка) возвращает текущее состояние
        if o["status"] == status:
            return self.organization_view(admin, o)
        if o["status"] != OrganizationStatus.PENDING:
            fail("already_decided", "Заявка уже рассмотрена")
        reason = _trim(input_.get("reason"), 600)
        if decision_ != "approve" and len(reason) < 5:
            fail(
                "reason_required",
                "Укажите причину. Её увидит организация",
                {"reason": "Напишите, что не так и что исправить"},
            )
        o["status"] = status
        o["aiFlag"] = "none"
        o["updatedAt"] = _iso_now()
        o["reviews"].append(
            {
                "id": store.next_id("rv"),
                "decision": status,
                "reason": "" if decision_ == "approve" else reason,
                "adminId": admin["id"],
                "at": _iso_now(),
            }
        )
        texts = {
            "approve": (
                "Организация допущена",
                f"«{o['name']}» прошла проверку. Теперь можно публиковать события от её имени, они появятся в поиске сразу.",
            ),
            "reject": ("Заявка отклонена", f"«{o['name']}»: {reason} Исправьте заявку и отправьте снова."),
            "return": ("Заявку вернули на доработку", f"«{o['name']}»: {reason}"),
        }
        self._notify([o["ownerId"]], type_, texts[decision_][0], texts[decision_][1], f"/org/{o['id']}")
        self._audit_entry(admin, action, "org", o["id"], o["name"], reason, None)
        self._commit(["organizations", "notifications", "audit", "admin", "events"], [o["id"]])
        return self.organization_view(admin, o)

    # ---------- «Ищу компанию» ----------

    def _companion_point(self, c: Entity) -> dict[str, Any] | None:
        """Точка объявления для посторонних — центр района, а не адрес автора."""
        d = self._district(c.get("districtId"))
        return {"lat": d["lat"], "lng": d["lng"]} if d is not None else None

    def companion_view(self, actor: Actor, c: Entity, match: Entity | None = None) -> Entity:
        """`match` — уже собранный контекст подбора (для списка); без него собирается заново."""
        author = self.user(c["authorId"])
        ctx = match if match is not None else self._match_for(actor)
        point = self._actor_point(actor)
        actor_id = actor["id"] if actor is not None else None
        is_mine = actor_id == c["authorId"]
        shown_point = c.get("point") if is_mine else self._companion_point(c)
        return {
            **c,
            "point": shown_point,
            "author": {
                **self.person(author),
                "level": author["levels"].get(c["sportId"]) if author is not None else None,
            },
            "sport": self.sport_view(c["sportId"]),
            "districtName": self._district_name(c.get("districtId")),
            "metooCount": len(c["metoo"]),
            "isDemo": c["id"].startswith("c-compdemo-"),
            "metooPeople": [self.person(self.user(m["userId"]), True) for m in c["metoo"]],
            "iMetoo": actor_id is not None and any(m["userId"] == actor_id for m in c["metoo"]),
            "isMine": is_mine,
            "matchReasons": assistant.explain_companion(
                {**c, "point": self._companion_point(c)}, author, ctx
            )["reasons"]
            if ctx is not None and author is not None and not is_mine
            else [],
            "distanceKm": _rounded_km(point, shown_point),
        }

    def list_companions(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `sportId`, `status`, `mine`, `districtId`, `q`."""
        q = q or {}
        match = self._match_for(actor)
        rows = self.db.companions
        if q.get("city"):
            city = city_by_name(q["city"])
            city_authors = {u["id"] for u in self.db.users if u.get("city") == q["city"]}
            def in_city(c: Entity) -> bool:
                location = self._companion_point(c) or c.get("point")
                if location is not None and city is not None:
                    return point_in_city(location, city)
                return c["authorId"] in city_authors

            rows = [c for c in rows if in_city(c)]
        if q.get("mine"):
            rows = [c for c in rows if c["authorId"] == self._require_user(actor)["id"]]
        else:
            status = q.get("status") or "open"
            rows = [c for c in rows if c["status"] == status]
        if q.get("sportId"):
            rows = [c for c in rows if c["sportId"] == q["sportId"]]
        if q.get("districtId"):
            rows = [c for c in rows if c.get("districtId") == q["districtId"]]
        if q.get("q"):
            query = _text(q["q"])

            def matches(c: Entity) -> bool:
                s = self._sport(c["sportId"])
                sport_words = [s["name"], *(s.get("synonyms") or [])] if s is not None else []
                return text.text_matches(query, " ".join([c["text"], *sport_words]))

            rows = [c for c in rows if matches(c)]

        # Сначала объявления, которые подходят человеку по большему числу причин, затем свежие
        views = [self.companion_view(actor, c, match) for c in rows]
        return sorted(views, key=lambda v: (len(v["matchReasons"]), v["createdAt"]), reverse=True)

    def companion_details(self, actor: Actor, id_: ID) -> Entity:
        c = _by_id(self.db.companions, id_)
        if c is None:
            fail("not_found", "Объявление не найдено")
        return self.companion_view(actor, c)

    def create_companion(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        user = self._require_user(actor)
        if user["role"] == "admin":
            fail("forbidden", "Администратор не публикует объявления")
        errors: dict[str, str] = {}
        if not input_.get("sportId") and not _trim(input_.get("newSportName"), 40):
            errors["sportId"] = "Выберите направление или впишите своё"
        if len(_trim(input_.get("text"), 500)) < 10:
            errors["text"] = "Расскажите, кого ищете, хотя бы одним предложением"
        if not _trim(input_.get("when"), 80):
            errors["when"] = "Напишите, когда вам удобно"
        if "level" in input_ and input_["level"] not in ("beginner", "amateur", "experienced"):
            errors["level"] = "Выберите уровень из списка"
        if input_.get("districtId") and self._district(input_["districtId"]) is None:
            errors["districtId"] = "Выберите район из списка"
        if errors:
            fail("validation", "Проверьте поля объявления", errors)
        plan = self._plan_sport(input_.get("sportId"), input_.get("newSportName"), input_.get("confirmNew"))
        sport_id = self._apply_sport(user, plan)
        c = {
            "id": store.next_id("c"),
            "authorId": user["id"],
            "sportId": sport_id,
            "text": _trim(input_.get("text"), 500),
            "districtId": input_.get("districtId"),
            # Домашний адрес автора в объявление не попадает: только выбранная точка или центр района
            "point": input_.get("point"),
            "when": _trim(input_.get("when"), 80),
            "level": input_.get("level") or user["levels"].get(sport_id) or "beginner",
            "readiness": "organize" if input_.get("readiness") == "organize" else "join",
            "metoo": [],
            "status": CompanionStatus.OPEN,
            "eventId": None,
            "createdWithAssistant": bool(input_.get("createdWithAssistant")),
            "createdAt": _iso_now(),
        }
        if c["point"] is None:
            c["point"] = self._companion_point(c)
        self.db.companions.append(c)
        self._commit(["companions", "sports", "audit"], [c["id"]], "created")
        return self.companion_view(user, c)

    def set_metoo(self, actor: Actor, id_: ID, on: bool) -> Entity:
        """«Я тоже»: PUT ставит отклик, DELETE снимает. Повтор ничего не меняет."""
        user = self._require_user(actor)
        if user["role"] == "admin":
            fail("forbidden", "Администратор не откликается на объявления")
        c = _by_id(self.db.companions, id_)
        if c is None:
            fail("not_found", "Объявление не найдено")
        if c["authorId"] == user["id"]:
            fail("own_companion", "Это ваше объявление")
        has = any(m["userId"] == user["id"] for m in c["metoo"])
        if has == on:
            return self.companion_view(user, c)
        if c["status"] != CompanionStatus.OPEN:
            fail("companion_closed", "Объявление уже закрыто")
        if on:
            c["metoo"].append({"userId": user["id"], "at": _iso_now()})
            s = self._sport(c["sportId"])
            sport = s["name"].lower() if s is not None else ""
            self._notify(
                [c["authorId"]],
                "metoo",
                "Откликнулись на ваше объявление",
                f"{user['name']} тоже хочет: {sport}. Откликнулось {len(c['metoo'])}.",
                "/companions",
            )
        else:
            c["metoo"] = [m for m in c["metoo"] if m["userId"] != user["id"]]
        self._commit(["companions", "notifications"], [c["id"]])
        return self.companion_view(user, c)

    def toggle_metoo(self, actor: Actor, id_: ID) -> Entity:
        """Устарело. Переключатель: двойное нажатие снимает отклик. Используйте set_metoo (PUT / DELETE)."""
        user = self._require_user(actor)
        c = _by_id(self.db.companions, id_)
        if c is None:
            fail("not_found", "Объявление не найдено")
        return self.set_metoo(user, id_, not any(m["userId"] == user["id"] for m in c["metoo"]))

    def invite(self, actor: Actor, input_: dict[str, Any]) -> Entity:
        """«Позвать»: организатор приглашает автора объявления (или откликнувшегося) на своё событие."""
        user = self._require_user(actor)
        e = self._get_event(input_.get("eventId"))
        if not self.is_organizer(user, e):
            fail("forbidden", "Позвать можно только на своё событие")
        if self.event_state(e) != "upcoming":
            fail("event_inactive", "Событие уже не принимает участников")
        target = self._get_user(input_.get("userId"))
        if target["id"] == user["id"]:
            fail("bad_request", "Нельзя позвать самого себя")
        if target["role"] == "admin":
            fail("bad_request", "Администратора нельзя позвать на событие")
        if input_.get("companionId"):
            c = _by_id(self.db.companions, input_["companionId"])
            if c is None:
                fail("not_found", "Объявление не найдено")
            if c["authorId"] != target["id"] and not any(m["userId"] == target["id"] for m in c["metoo"]):
                fail("bad_request", "Этот человек не писал и не откликался на это объявление")
            if c["status"] == CompanionStatus.CLOSED:
                fail("companion_closed", "Объявление уже закрыто")
        if stop_list.is_stop_listed(self.db, target["id"], e, clock.now()):
            fail("stop_listed", "Сначала уберите человека из стоп-листа")  # D-16
        if any(i["eventId"] == e["id"] and i["toUserId"] == target["id"] for i in self.db.invites):
            fail("duplicate", "Вы уже звали этого человека на это событие")
        mine = self._mine(target, e)
        if mine is not None and mine["status"] in ACTIVE_PARTICIPATION:
            fail("already_joined", f"{target['name']} уже записан на это событие")
        self.db.invites.append(
            {
                "id": store.next_id("inv"),
                "eventId": e["id"],
                "fromUserId": user["id"],
                "toUserId": target["id"],
                "companionId": input_.get("companionId"),
                "createdAt": _iso_now(),
            }
        )
        self._notify(
            [target["id"]],
            "invite",
            "Вас позвали",
            f"{user['name']} зовёт вас на «{e['title']}», {_date_token(e['startsAt'])}. Посмотрите условия и запишитесь{': по приглашению заявку подтверждать не нужно' if e['joinMode'] == 'approval' else ''}.",
            f"/events/{e['id']}",
        )
        self._commit(["invites", "notifications"], [e["id"]])
        return {"ok": True}

    def close_companion(self, actor: Actor, id_: ID) -> Entity:
        user = self._require_user(actor)
        c = _by_id(self.db.companions, id_)
        if c is None:
            fail("not_found", "Объявление не найдено")
        if c["authorId"] != user["id"] and user["role"] != "admin":
            fail("forbidden", "Закрыть объявление может только автор")
        if c["status"] == CompanionStatus.CLOSED:
            return self.companion_view(user, c)
        c["status"] = CompanionStatus.CLOSED
        self._commit(["companions"], [c["id"]])
        return self.companion_view(user, c)

    def list_invites(self, actor: Actor) -> list[Entity]:
        user = self._require_user(actor)

        def not_joined(i: Entity) -> bool:
            # Записался — приглашение больше не показываем
            mine = next(
                (
                    p
                    for p in self.db.participations
                    if p["eventId"] == i["eventId"] and p["userId"] == user["id"]
                ),
                None,
            )
            return not (mine is not None and mine["status"] in ACTIVE_PARTICIPATION)

        def view(i: Entity) -> Entity:
            e = self._event(i["eventId"])
            return {
                **i,
                "from": self.person(self.user(i["fromUserId"])),
                "event": self.event_view(user, e) if e is not None else None,
            }

        rows = [view(i) for i in self.db.invites if i["toUserId"] == user["id"] and not_joined(i)]
        return [i for i in rows if i["event"] is not None and i["event"]["state"] == "upcoming"]

    # ---------- Люди ----------

    def user_view(self, u: Entity) -> Entity:
        own_events = self._organizer_events_for_read({"kind": "user", "id": u["id"]})
        organized_events = {e["id"]: e for e in own_events}
        for org in self._owned_orgs(u["id"]):
            organized_events.update({e["id"]: e for e in self._organizer_events_for_read({"kind": "org", "id": org["id"]})})
        events = [
            self._event(p["eventId"])
            for p in self.db.participations
            if p["userId"] == u["id"] and p["status"] == ParticipationStatus.CONFIRMED
        ]
        attended_events = [e for e in events if e is not None and self.event_state(e) == "past"]
        organized_past = [
            e
            for e in organized_events.values()
            if u["id"] in self._organizer_user_ids(e) and self.event_state(e) == "past"
        ]
        tried = {e["sportId"] for e in [*attended_events, *organized_past]}
        return {
            "id": u["id"],
            "name": u["name"],
            "avatarUrl": u.get("avatarUrl"),
            "initials": initials(u["name"]),
            "age": u.get("age"),
            "city": u.get("city"),
            "districtId": u.get("districtId"),
            "districtName": self._district_name(u.get("districtId")),
            "about": u.get("about"),
            "interests": [self.sport_view(id_) for id_ in u["interests"]],
            "levels": u["levels"],
            "readiness": u.get("readiness"),
            "facts": {
                **self._organizer_facts({"kind": "user", "id": u["id"]}, own_events),
                "attended": len(attended_events),
                "sportsTried": len(tried),
            },
            "createdAt": u.get("createdAt"),
        }

    def identity(self, actor: Actor) -> Entity | None:
        if actor is None:
            return None
        orgs = [
            {
                "id": o["id"],
                "name": o["name"],
                "status": o["status"],
                **({} if o["ownerId"] == actor["id"] else {"managed": True}),  # С14
            }
            for o in self._owned_orgs(actor["id"])
        ]
        return {
            **self.user_view(actor),
            "role": "admin" if actor["role"] == "admin" else "org" if orgs else "user",
            "userRole": actor["role"],
            "email": actor.get("email"),
            "phone": actor.get("phone"),
            "home": actor.get("home"),
            "radiusKm": actor.get("radiusKm"),
            "orgs": orgs,
            "demo": actor.get("demo"),
            "unreadNotifications": len(
                [n for n in self.db.notifications if n["userId"] == actor["id"] and not n["read"]]
            ),
            "gender": actor.get("gender"),  # В7
        }

    def user_profile(self, id_: ID) -> Entity:
        u = self._get_user(id_)
        if u["role"] == "admin":
            fail("not_found", "Профиль недоступен")
        return self.user_view(u)

    def list_users(self, actor: Actor, q: dict[str, Any] | None = None, *, raw: bool = False) -> list[Entity]:
        """`q`: `q`, `sportId`, `readiness`."""
        q = q or {}
        self._require_user(actor)
        return [
            u if raw else self.user_view(u)
            for u in self.db.users
            if u["role"] == "user"
            and (not q.get("sportId") or q["sportId"] in u["interests"])
            and (not q.get("readiness") or u.get("readiness") == q["readiness"])
            and (not q.get("q") or normalize(_text(q["q"])) in normalize(u["name"]))
        ]

    def update_profile(self, actor: Actor, id_: ID, patch: dict[str, Any]) -> Entity | None:
        user = self._require_user(actor)
        if user["id"] != id_:
            fail("forbidden", "Можно изменить только свой профиль")
        if "name" in patch and len(_trim(patch["name"], 60)) < 2:
            fail("validation", "Проверьте имя", {"name": "Напишите имя"})
        avatar = None if patch.get("avatarUrl") in (None, "") else patch["avatarUrl"]
        if avatar is not None and not valid_event_image(avatar):
            fail(
                "validation",
                "Проверьте фото профиля",
                {"avatarUrl": "Это фото не подошло. Выберите другое в формате JPEG, PNG или WebP"},
            )
        interests = _list(patch.get("interests"), "interests", "Выберите интересы из списка")
        levels = patch.get("levels")
        if levels is not None and not isinstance(levels, dict):
            message = "Укажите уровень для каждого направления"
            fail("validation", message, {"levels": message})
        # Возраст и радиус лежат в целочисленных колонках, точка дома — в JSON: проверяем до записи.
        age = _whole(patch.get("age"), PROFILE_AGE)
        radius = _whole(patch.get("radiusKm"), PROFILE_RADIUS_KM)
        home = _geo_point(patch.get("home"))
        errors: dict[str, str] = {}
        if patch.get("age") is not None and age is None:
            errors["age"] = f"Возраст — целое число от {PROFILE_AGE.start} до {PROFILE_AGE.stop - 1}"
        if patch.get("radiusKm") is not None and radius is None:
            errors["radiusKm"] = f"Радиус — от {PROFILE_RADIUS_KM.start} до {PROFILE_RADIUS_KM.stop - 1} км"
        if patch.get("home") is not None and home is None:
            errors["home"] = "Точка дома — широта и долгота"
        if patch.get("districtId") is not None and self._district(patch["districtId"]) is None:
            errors["districtId"] = "Выберите район из списка"
        if patch.get("readiness") not in (None, *READINESS):
            errors["readiness"] = "Выберите вариант из списка"
        if errors:
            fail("validation", "Проверьте профиль", errors)
        u = self._get_user(id_)
        if "avatarUrl" in patch:
            u["avatarUrl"] = avatar
        if "name" in patch:
            u["name"] = _trim(patch["name"], 60)
        if "about" in patch:
            u["about"] = _trim(patch["about"], 500)
        if "age" in patch:
            u["age"] = age
        if "phone" in patch:
            u["phone"] = _trim(patch["phone"], 40)
        if "districtId" in patch:
            u["districtId"] = patch["districtId"]
            d = self._district(patch["districtId"])
            city = city_of_point(d)
            if city is not None:
                u["city"] = city["name"]
            if d is not None and "home" not in patch:
                u["home"] = {"lat": d["lat"], "lng": d["lng"]}
        if "home" in patch:
            u["home"] = home
        if "radiusKm" in patch:
            u["radiusKm"] = radius
        if patch.get("interests") is not None:
            u["interests"] = [s for s in interests if self._sport(s) is not None]
        if levels is not None:
            u["levels"] = {k: v for k, v in levels.items() if self._sport(k) is not None}
        if "readiness" in patch:
            u["readiness"] = patch["readiness"]
        if "gender" in patch:
            u["gender"] = composition.clean_gender(patch["gender"])  # В7
        # В7: от пола зависит, на какие встречи можно записаться
        self._commit(["users", "events"] if "gender" in patch else ["users"], [u["id"]])
        return self.identity(u)

    def register(self, input_: dict[str, Any]) -> Entity:
        name = _trim(input_.get("name"), 60)
        if len(name) < 2:
            fail("validation", "Напишите имя", {"name": "Как к вам обращаться"})
        email = _trim(input_.get("email"), 80).lower()
        if email and any(u.get("email") == email for u in self.db.users):
            fail(
                "duplicate",
                "Такая почта уже есть. Войдите с ней или укажите другую",
                {"email": "Эта почта уже зарегистрирована"},
            )
        d = self._district(input_.get("districtId"))
        city = city_of_point(d) or city_by_name(input_.get("city")) or default_city()
        interests = _list(input_.get("interests"), "interests", "Выберите интересы из списка")
        level = input_.get("level") or "beginner"
        user = {
            "id": store.next_id("u"),
            "name": name,
            "avatarUrl": None,
            "age": None,
            "role": "user",
            "city": city["name"],
            "districtId": d["id"] if d is not None else None,
            "about": "",
            "interests": [s for s in interests if self._sport(s) is not None],
            "levels": {s: level for s in interests if isinstance(s, str)},
            "readiness": "join",
            "home": {"lat": d["lat"], "lng": d["lng"]} if d is not None else None,
            "radiusKm": 5,
            "email": email or f"{secrets.token_hex(5)}@vmeste.demo",  # почта-заглушка
            "phone": "",
            "demo": None,
            "createdAt": _iso_now(),
        }
        self.db.users.append(user)
        self._commit(["users"], [user["id"]], "created")
        return user

    # ---------- Уведомления ----------

    def _notify(self, user_ids: list[ID], type_: str, title: str, text: str, link: str) -> None:
        at = _iso_now()
        for user_id in dict.fromkeys(u for u in user_ids if u):
            self.db.notifications.insert(
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

    def list_notifications(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `unread`."""
        q = q or {}
        user = self._require_user(actor)
        rows = [
            n
            for n in self.db.notifications
            if n["userId"] == user["id"] and (not q.get("unread") or not n["read"])
        ]
        return [{**n, "text": self.render_text(n["text"])} for n in rows[:100]]

    def mark_read(self, actor: Actor, ids: list[ID] | None = None) -> Entity:
        user = self._require_user(actor)
        for n in self.db.notifications:
            if n["userId"] == user["id"] and (ids is None or n["id"] in ids):
                n["read"] = True
        self._commit(["notifications", "users"], [user["id"]])
        return {
            "ok": True,
            "unread": len([n for n in self.db.notifications if n["userId"] == user["id"] and not n["read"]]),
        }

    # ---------- Журнал и сводка ----------

    def _audit(
        self,
        actor: Entity,
        action: str,
        target_type: str,
        target_id: ID,
        target_title: str,
        reason: str = "",
    ) -> None:
        self._audit_entry(actor, action, target_type, target_id, target_title, reason, None)

    def _audit_entry(
        self,
        actor: Entity,
        action: str,
        target_type: str,
        target_id: ID,
        target_title: str,
        reason: str,
        rule_id: ID | None,
    ) -> None:
        self.db.audit.insert(
            0,
            {
                "id": store.next_id("a"),
                "actorId": actor["id"],
                "action": action,
                "targetType": target_type,
                "targetId": target_id,
                "targetTitle": target_title,
                "ruleId": rule_id,
                "reason": _trim(reason, 600),
                "at": _iso_now(),
            },
        )

    def list_audit(self, actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
        """`q`: `action` (начало кода действия), `targetType`, `q`."""
        q = q or {}
        self._require_admin(actor)

        def view(a: Entity) -> Entity:
            actor_ = self.user(a.get("actorId"))
            rule = _by_id(self.db.rules, a.get("ruleId"))
            return {
                **a,
                "reason": self.render_text(a["reason"]),
                "actorName": actor_["name"] if actor_ is not None else "Система",
                "ruleTitle": rule["title"] if rule is not None else None,
            }

        action = _text(q.get("action"))
        query = normalize(_text(q.get("q")))
        return [
            view(a)
            for a in self.db.audit
            if (not action or a["action"].startswith(action))
            and (not q.get("targetType") or a["targetType"] == q["targetType"])
            and (not query or query in normalize(f"{a['targetTitle']} {a['reason']}"))
        ]

    def admin_event_counts(self, actor: Actor) -> Entity:
        self._require_admin(actor)
        from app.domain.event_reads import counts_by_sport
        return {"bySport": counts_by_sport(self.db)}

    def admin_stats(self, actor: Actor) -> Entity:
        self._require_admin(actor)
        week_ago = clock.now() - timedelta(days=7)

        def recent(iso: str) -> bool:
            at = clock.parse(iso)
            return at is not None and at >= week_ago

        questions = [
            m for m in self.db.messages if not m["system"] and not m.get("replyTo") and recent(m["createdAt"])
        ]
        from app.domain.event_reads import project
        events = project(self.db, {"id", "status", "startsAt", "durationMin", "aiFlag", "createdAt"})
        return {
            "pendingOrgs": len(
                [o for o in self.db.organizations if o["status"] == OrganizationStatus.PENDING]
            ),
            "flaggedMessages": len(
                [
                    m
                    for m in self.db.messages
                    if m["aiFlag"] != "none" and m["status"] == MessageStatus.VISIBLE
                ]
            ),
            "flaggedEvents": len(
                [e for e in events if e["aiFlag"] != "none" and e["status"] == EventStatus.PUBLISHED]
            ),
            "flaggedOrgs": len(
                [
                    o
                    for o in self.db.organizations
                    if o["aiFlag"] != "none" and o["status"] == OrganizationStatus.PENDING
                ]
            ),
            "publishedEvents": len([e for e in events if self.event_state(e) in OPEN_STATES]),
            "removedEvents": len([e for e in events if e["status"] == EventStatus.REMOVED]),
            "customSports": len(
                [s for s in self.db.sports if s["kind"] == "custom" and not s.get("mergedInto")]
            ),
            "week": {
                "newEvents": len([e for e in events if recent(e["createdAt"])]),
                "joins": len(
                    [
                        p
                        for p in self.db.participations
                        if p["status"] == ParticipationStatus.CONFIRMED and recent(p["createdAt"])
                    ]
                ),
                "questions": len(questions),
                "answeredQuestions": len(
                    [q for q in questions if any(m.get("replyTo") == q["id"] for m in self.db.messages)]
                ),
            },
        }

    # ---------- Помощник: журнал без текста запросов ----------

    def log_ai_request(self, actor: Actor, kind: str, duration_ms: float, ok: bool, fallback: bool) -> None:
        self.db.ai_requests.insert(
            0,
            {
                "id": store.next_id("ai"),
                "kind": kind,
                "userId": actor["id"] if actor is not None else None,
                "durationMs": round(duration_ms),
                "ok": ok,
                "fallback": fallback,
                "at": _iso_now(),
            },
        )
        self.db.ai_requests = self.db.ai_requests[:200]

    def explain_event_for(self, actor: Actor, event_id: ID) -> Entity:
        user = self._require_user(actor)
        e = self._get_event(event_id)
        result = assistant.explain_event(e, self._match_context(user))
        return {
            **result,
            "summary": f"Вам подходит: {', '.join(r[:1].lower() + r[1:] for r in result['reasons'])}"
            if result["reasons"]
            else "Совпадений с вашим профилем мало",
        }

    # ---------- Демо ----------

    def demo_accounts(self) -> list[Entity]:
        def account(u: Entity) -> Entity:
            identity = self.identity(u)
            # Бейдж и подсказка — про организацию из демо-данных и её текущий статус: так подпись
            # не расходится со статусом после допуска или отказа, а чужие пробные организации не мешают.
            demo_org = demo_roles.DEMO_ORGS.get(u["id"])
            org = _by_id(self.db.organizations, demo_org[0]) if demo_org else None
            return {
                "id": u["id"],
                "name": u["name"],
                "initials": initials(u["name"]),
                "age": u.get("age"),
                "role": identity["role"],
                "title": u["demo"]["title"],
                "hint": demo_roles.demo_hint(u["id"], u["demo"]["hint"], org["status"] if org else None),
                "orgs": [{"id": org["id"], "name": org["name"], "status": org["status"]}] if org else [],
            }

        demo_users = sorted(
            (u for u in self.db.users if u.get("demo") is not None), key=lambda u: u["demo"]["order"]
        )
        return [account(u) for u in demo_users]

    def set_assistant_failure(self, on: bool, mode: str = "error") -> Entity:
        self.db.settings["assistantFailure"] = on
        self.db.settings["assistantFailureMode"] = "timeout" if mode == "timeout" else "error"
        self._commit(["demo"], [])
        return {"assistantFailure": on, "assistantFailureMode": self.db.settings["assistantFailureMode"]}

    def demo_state(self) -> Entity:
        s = self.db.settings
        return {
            "assistantFailure": s.get("assistantFailure"),
            "assistantFailureMode": s.get("assistantFailureMode") or "error",
            "schemaVersion": self.db.version,
            "seededAt": self.db.seeded_at,
            "datesShiftedAt": s.get("datesShiftedAt"),
            "datesShiftedDays": s.get("datesShiftedDays") or 0,
        }

    # ---------- Запись изменений ----------

    def _commit(self, resources: list[str], ids: list[ID], type_: str = "updated") -> None:
        bus.publish(resources, ids, type_)


domain = Domain()
