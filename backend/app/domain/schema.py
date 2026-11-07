"""Таблицы доменных данных и их соответствие коллекциям правил.

Правила (app/domain) работают со словарями в форме контракта API: ключи camelCase, даты — ISO-строки.
Здесь каждая коллекция описана таблицей с типизированными колонками: ключ словаря → колонка
snake_case. Вложенные значения (место, цена, изменения, отзывы) — JSONB.

Колонка `ord` хранит порядок элементов коллекции: правила местами опираются на него
(новые уведомления — в начале списка, лист ожидания — по порядку записи).
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from app.db.base import Base
from app.db.models import AiRequest, User
from app.domain.statuses import (
    CompanionStatus,
    EventStatus,
    JoinMode,
    MessageStatus,
    OrganizationStatus,
    ParticipationStatus,
)

metadata = Base.metadata

ID = "id"
STR = "str"
ISO = "iso"
INT = "int"
NUM = "num"
BOOL = "bool"
IDS = "ids"
STRS = "strs"
JSON = "json"

_TYPES: dict[str, Callable[[], sa.types.TypeEngine[Any]]] = {
    ID: lambda: sa.String(64),
    STR: sa.Text,
    ISO: lambda: sa.DateTime(timezone=True),
    INT: sa.Integer,
    NUM: sa.Double,
    BOOL: sa.Boolean,
    IDS: lambda: ARRAY(sa.String(64)),
    STRS: lambda: ARRAY(sa.Text),
    JSON: JSONB,
}


def snake(key: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", key).lower()


@dataclass(frozen=True, slots=True)
class Col:
    key: str
    kind: str
    null: bool = True
    fk: str | None = None
    index: bool = False
    name: str | None = None
    # Допустимые значения: ограничение CHECK в таблице.
    values: type[StrEnum] | None = None

    @property
    def column_name(self) -> str:
        return self.name or snake(self.key)


@dataclass(frozen=True, slots=True)
class Field:
    """Ключ словаря и колонки, в которых он хранится. Составные поля (`organizer`) — несколько колонок."""

    key: str
    columns: tuple[str, ...]
    kinds: tuple[str, ...]
    load: Callable[..., Any] | None = None
    dump: Callable[[Any], tuple[Any, ...]] | None = None


@dataclass(slots=True)
class Collection:
    """Коллекция правил: `path` — ключ в данных (`events`, `inventory.lines`), `attr` — атрибут базы."""

    path: str
    attr: str
    table: sa.Table
    fields: list[Field]
    # Ключ записи в словаре. None — у записей нет своего id: коллекция сохраняется целиком при изменении.
    key: str | None = "id"
    # Список строк (`reminders`): одна колонка `value`.
    scalar: bool = False
    # Только добавление (журнал помощника): старые записи правилам не нужны и не загружаются.
    write_only: bool = False
    # Значения колонок, которых нет в словарях правил (при вставке).
    insert_defaults: dict[str, Any] = field(default_factory=dict)
    keys: frozenset[str] = field(default_factory=frozenset)


COLLECTIONS: dict[str, Collection] = {}


def _fk(target: str) -> sa.ForeignKey:
    # Проверка в конце транзакции: правила добавляют связанные записи в любом порядке.
    return sa.ForeignKey(target, deferrable=True, initially="DEFERRED")


def _check(column: str, values: type[StrEnum]) -> sa.CheckConstraint:
    allowed = ", ".join(f"'{v.value}'" for v in values)
    return sa.CheckConstraint(f"{column} IN ({allowed})", name=column)


def _register(collection: Collection) -> Collection:
    collection.keys = frozenset(f.key for f in collection.fields)
    COLLECTIONS[collection.path] = collection
    return collection


def define(
    path: str,
    table_name: str,
    *cols: Col,
    composites: tuple[Field, ...] = (),
    key: str | None = "id",
    extra_columns: tuple[sa.Column[Any], ...] = (),
    indexes: tuple[tuple[str, ...], ...] = (),
    unique: tuple[str, ...] = (),
) -> Collection:
    """`unique` — колонки естественного ключа: одна запись человека на событие, одно «в избранном»."""
    columns: list[sa.Column[Any]] = []
    if key is None:
        columns.append(sa.Column("pk", sa.BigInteger, sa.Identity(), primary_key=True))
    for c in cols:
        args: list[Any] = [_fk(c.fk)] if c.fk else []
        columns.append(
            sa.Column(
                c.column_name,
                _TYPES[c.kind](),
                *args,
                primary_key=key is not None and c.key == key,
                nullable=c.null and not (key is not None and c.key == key),
                index=c.index,
            )
        )
    columns.extend(extra_columns)
    columns.append(sa.Column("ord", sa.BigInteger, nullable=False, server_default="0"))
    constraints: list[sa.Constraint] = [_check(c.column_name, c.values) for c in cols if c.values]
    if unique:
        # Отложенная проверка: при сохранении изменений строки обновляются по одной.
        constraints.append(sa.UniqueConstraint(*unique, deferrable=True, initially="DEFERRED"))
    table = sa.Table(table_name, metadata, *columns, *constraints)
    for names in indexes:
        sa.Index(f"ix_{table_name}_{'_'.join(names)}", *(table.c[n] for n in names))
    fields = [Field(c.key, (c.column_name,), (c.kind,)) for c in cols]
    fields.extend(composites)
    attr = snake(path.rsplit(".", maxsplit=1)[-1]) if "." in path else snake(path)
    return _register(Collection(path=path, attr=attr, table=table, fields=fields, key=key))


def define_scalar(path: str, table_name: str) -> Collection:
    table = sa.Table(
        table_name,
        metadata,
        sa.Column("pk", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("ord", sa.BigInteger, nullable=False, server_default="0"),
    )
    attr = snake(path.rsplit(".", maxsplit=1)[-1])
    return _register(Collection(path=path, attr=attr, table=table, fields=[], key=None, scalar=True))


def ref_composite(key: str, prefix: str) -> tuple[Field, tuple[sa.Column[Any], ...]]:
    """Ссылка `{ kind: 'user' | 'org', id }` — две колонки: `<prefix>_kind` и `<prefix>_id`."""
    kind_col, id_col = f"{prefix}_kind", f"{prefix}_id"
    columns = (
        sa.Column(kind_col, sa.String(16), nullable=False),
        sa.Column(id_col, sa.String(64), nullable=False),
    )
    return (
        Field(
            key,
            (kind_col, id_col),
            (ID, ID),
            load=lambda kind, id_: {"kind": kind, "id": id_},
            dump=lambda v: (v["kind"], v["id"]),
        ),
        columns,
    )


# ---------- Справочники ----------
# Города, районы, каталог направлений и правила правит администратор («Справочники»): новая версия
# демо-данных только добавляет недостающие записи и не меняет существующие (provider.REFERENCE_COLLECTIONS).

define(
    "cities",
    "cities",
    Col("id", ID),
    Col("name", STR, null=False),
    Col("nameIn", STR),
    Col("region", STR),
    Col("timeZone", STR, null=False),
    Col("center", JSON, null=False),
    Col("radiusKm", NUM),
    Col("isDefault", BOOL),
    Col("hidden", BOOL),
    Col("order", INT, name="sort_order"),
)

define(
    "districts",
    "districts",
    Col("id", ID),
    Col("name", STR, null=False),
    Col("lat", NUM, null=False),
    Col("lng", NUM, null=False),
)

define(
    "categories",
    "sport_categories",
    Col("id", ID),
    Col("name", STR, null=False),
    Col("icon", STR),
    Col("order", INT, name="sort_order"),
    Col("parentId", ID),
    Col("fields", JSON),
    Col("hidden", BOOL),
)

define(
    "sports",
    "sports",
    Col("id", ID),
    Col("name", STR, null=False),
    Col("synonyms", STRS),
    Col("categoryIds", IDS),
    Col("icon", STR),
    Col("kind", ID, null=False),
    Col("popular", BOOL),
    Col("fields", JSON),
    Col("mergedInto", ID, fk="sports.id"),
    Col("createdBy", ID, fk="users.id"),
    Col("createdAt", ISO),
    Col("hidden", BOOL),
)

define(
    "rules",
    "platform_rules",
    Col("id", ID),
    Col("number", INT),
    Col("title", STR, null=False),
    Col("text", STR),
    Col("example", STR),
    Col("hidden", BOOL),
)

# ---------- Пользователи ----------
# Таблица users общая с входом (app/db/models/user.py): правила видят только поля профиля,
# хеш пароля и признак активности остаются у сервиса входа.

_users = User.__table__
COLLECTIONS["users"] = Collection(
    path="users",
    attr="users",
    table=_users,  # type: ignore[arg-type]
    fields=[
        Field("id", ("id",), (ID,)),
        Field("name", ("name",), (STR,)),
        Field("avatarUrl", ("avatar_url",), (STR,)),
        Field("age", ("age",), (INT,)),
        Field("role", ("role",), (ID,)),
        Field("city", ("city",), (STR,)),
        Field("districtId", ("district_id",), (ID,)),
        Field("about", ("about",), (STR,)),
        Field("interests", ("interests",), (IDS,)),
        Field("levels", ("levels",), (JSON,)),
        Field("readiness", ("readiness",), (ID,)),
        Field("home", ("home",), (JSON,)),
        Field("radiusKm", ("radius_km",), (INT,)),
        Field("email", ("email",), (STR,)),
        Field("phone", ("phone",), (STR,)),
        Field(
            "demo",
            ("demo_order", "demo_title", "demo_hint"),
            (NUM, STR, STR),
            load=lambda order, title, hint: (
                None if order is None else {"title": title or "", "hint": hint or "", "order": order}
            ),
            dump=lambda v: (None, None, None) if v is None else (v["order"], v["title"], v["hint"]),
        ),
        Field("createdAt", ("created_at",), (ISO,)),
        Field("gender", ("gender",), (ID,)),
    ],
)
_register(COLLECTIONS["users"])

# ---------- Организации, события, записи ----------

define(
    "organizations",
    "organizations",
    Col("id", ID),
    Col("name", STR, null=False),
    Col("type", ID, null=False),
    Col("description", STR),
    Col("sportIds", IDS),
    Col("city", STR),
    Col("districtId", ID, fk="districts.id"),
    Col("address", STR),
    Col("contacts", JSON),
    Col("logoUrl", STR),
    Col("coverUrl", STR),
    Col("ownerId", ID, fk="users.id", index=True),
    Col("status", ID, null=False, index=True, values=OrganizationStatus),
    Col("reviews", JSON),
    Col("createdWithAssistant", BOOL),
    Col("aiFlag", ID),
    Col("aiReason", STR),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("suspension", JSON),
)

_organizer, _organizer_cols = ref_composite("organizer", "organizer")
define(
    "events",
    "events",
    Col("id", ID),
    Col("title", STR, null=False),
    Col("description", STR),
    Col("sportId", ID, fk="sports.id", index=True),
    Col("createdBy", ID),
    Col("startsAt", ISO, null=False, index=True),
    Col("durationMin", INT),
    Col("place", JSON),
    Col("level", ID),
    Col("beginnersWelcome", BOOL),
    Col("firstStep", JSON),
    Col("price", JSON),
    Col("paymentNote", STR),
    Col("cancelPolicy", JSON),
    Col("joinMode", ID, values=JoinMode),
    Col("capacity", INT),
    Col("minParticipants", INT),
    Col("status", ID, null=False, index=True, values=EventStatus),
    Col("moderation", JSON),
    Col("cancelReason", STR),
    Col("changes", JSON),
    Col("series", JSON),
    Col("privateInfo", STR),
    Col("discussion", ID),
    Col("extra", JSON),
    Col("coverUrl", STR),
    Col("photos", JSON),
    Col("createdWithAssistant", BOOL),
    Col("aiFlag", ID),
    Col("aiReason", STR),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("venueId", ID, fk="venues.id"),
    Col("accessExtras", STRS),
    Col("composition", ID),
    Col("visibility", ID),
    Col("inviteCode", ID),
    Col("family", JSON),
    # Оплата на сайте: способ оплаты и итог сбора складчины
    Col("paymentMode", ID),
    Col("payCollect", JSON),
    composites=(_organizer,),
    extra_columns=_organizer_cols,
    indexes=(("organizer_kind", "organizer_id"), ("venue_id", "starts_at")),
)

define(
    "participations",
    "participations",
    Col("id", ID),
    Col("eventId", ID, null=False, fk="events.id", index=True),
    Col("userId", ID, null=False, fk="users.id", index=True),
    Col("status", ID, null=False, values=ParticipationStatus),
    Col("prevStatus", ID),
    Col("note", STR),
    Col("rejectReason", STR),
    Col("source", ID),
    Col("needsEscort", BOOL),
    Col("createdAt", ISO),
    Col("decidedAt", ISO),
    Col("offer", JSON),
    Col("leftBecause", ID),
    Col("children", JSON),
    Col("adultSeat", BOOL),
    Col("teamId", ID),
    # Почему организатор убрал из участников (стоп-лист)
    Col("removedReason", STR),
    unique=("event_id", "user_id"),
)

define(
    "messages",
    "messages",
    Col("id", ID),
    Col("eventId", ID, null=False, fk="events.id", index=True),
    Col("authorId", ID, fk="users.id"),
    Col("asOrgId", ID),
    Col("text", STR),
    Col("replyTo", ID),
    Col("reactions", JSON),
    Col("status", ID, null=False, values=MessageStatus),
    Col("hiddenReason", STR),
    Col("hiddenBy", ID),
    Col("system", BOOL),
    Col("aiFlag", ID),
    Col("aiReason", STR),
    Col("createdAt", ISO),
    Col("pinnedAt", ISO),
)

define(
    "companions",
    "companions",
    Col("id", ID),
    Col("authorId", ID, null=False, fk="users.id"),
    Col("sportId", ID, fk="sports.id"),
    Col("text", STR),
    Col("districtId", ID),
    Col("point", JSON),
    Col("when", STR, name="when_text"),
    Col("level", ID),
    Col("readiness", ID),
    Col("metoo", JSON),
    Col("status", ID, null=False, values=CompanionStatus),
    Col("eventId", ID),
    Col("createdWithAssistant", BOOL),
    Col("createdAt", ISO),
)

define(
    "invites",
    "invites",
    Col("id", ID),
    Col("eventId", ID, null=False, fk="events.id", index=True),
    Col("fromUserId", ID, fk="users.id"),
    Col("toUserId", ID, fk="users.id"),
    Col("companionId", ID),
    Col("createdAt", ISO),
)

define(
    "notifications",
    "notifications",
    Col("id", ID),
    Col("userId", ID, null=False, fk="users.id", index=True),
    Col("type", ID, null=False),
    Col("title", STR),
    Col("text", STR),
    Col("link", STR),
    Col("read", BOOL),
    Col("createdAt", ISO),
)

define(
    "audit",
    "audit_log",
    Col("id", ID),
    Col("actorId", ID),
    Col("action", ID, null=False, index=True),
    Col("targetType", ID),
    Col("targetId", ID),
    Col("targetTitle", STR),
    Col("ruleId", ID),
    Col("reason", STR),
    Col("at", ISO),
)

# Журнал помощника пишется в общую таблицу ai_requests (app/db/models/ai_request.py): только метрики.
_ai = AiRequest.__table__
_register(
    Collection(
        path="aiRequests",
        attr="ai_requests",
        table=_ai,  # type: ignore[arg-type]
        fields=[
            Field("kind", ("kind",), (ID,)),
            Field("userId", ("user_id",), (ID,)),
            Field("durationMs", ("duration_ms",), (INT,)),
            Field("ok", ("success",), (BOOL,)),
            Field("fallback", ("fallback_used",), (BOOL,)),
            Field("at", ("created_at",), (ISO,)),
            Field("id", (), (), load=lambda: None, dump=lambda _: ()),
        ],
        key=None,
        write_only=True,
        insert_defaults={"provider": "rules"},
    )
)

define(
    "venues",
    "venues",
    Col("id", ID),
    Col("orgId", ID, null=False, fk="organizations.id", index=True),
    Col("name", STR, null=False),
    Col("kind", ID),
    Col("description", STR),
    Col("address", STR),
    Col("landmark", STR),
    Col("districtId", ID, fk="districts.id"),
    Col("lat", NUM),
    Col("lng", NUM),
    Col("sportIds", IDS),
    Col("indoor", BOOL),
    Col("pricePerHour", NUM),
    Col("peakPricePerHour", NUM),
    Col("features", STRS),
    Col("photoUrl", STR),
    Col("contacts", JSON),
    Col("hours", JSON),
    Col("timeZone", STR),
    Col("slots", JSON),
    Col("status", ID),
    Col("ownerUpdatedAt", ISO),
    Col("createdAt", ISO),
)

define(
    "idempotency",
    "idempotency_keys",
    Col("key", STR, null=False),
    Col("userId", ID, null=False),
    Col("resource", ID, null=False),
    Col("id", ID, name="entity_id"),
    Col("at", ISO),
    key=None,
)

# ---------- С1, С2, С3, Н2: встречающий, новички, срочный добор, спрос, программы ----------

define(
    "greeters",
    "event_greeters",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("userId", ID, fk="users.id"),
    Col("note", STR),
    Col("updatedAt", ISO),
    key=None,
)

define(
    "firstVisits",
    "first_visits",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("userId", ID, null=False, fk="users.id"),
    Col("withCompanion", BOOL),
    Col("at", ISO),
    key=None,
)

define(
    "urgentCalls",
    "urgent_calls",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("need", INT),
    Col("baseline", INT),
    Col("createdBy", ID),
    Col("createdAt", ISO),
    Col("notified", IDS),
    Col("closedAt", ISO),
    key=None,
)

define(
    "demandSignals",
    "demand_signals",
    Col("id", ID),
    Col("userId", ID),
    Col("sportId", ID),
    Col("districtId", ID),
    Col("slot", ID),
    Col("level", ID),
    Col("at", ISO),
)

define(
    "demandOffers",
    "demand_offers",
    Col("id", ID),
    Col("key", STR),
    Col("orgId", ID),
    Col("eventId", ID),
    Col("invited", IDS),
    Col("at", ISO),
)

define(
    "eventPrograms",
    "event_programs",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("kind", ID),
    Col("withCompanion", BOOL),
    Col("by", ID, name="by_user_id"),
    Col("at", ISO),
    key=None,
)

define_scalar("reminders", "sent_reminders")

# ---------- В3 + С7: инвентарь, общая полка, помощь партнёров ----------

define(
    "inventory.lines",
    "gear_lines",
    Col("id", ID),
    Col("eventId", ID, null=False, fk="events.id", index=True),
    Col("name", STR),
    Col("kind", ID),
    Col("quantity", INT),
    Col("createdAt", ISO),
)

define(
    "inventory.pledges",
    "gear_pledges",
    Col("id", ID),
    Col("eventId", ID, fk="events.id"),
    Col("lineId", ID),
    Col("userId", ID, fk="users.id"),
    Col("quantity", INT),
    Col("at", ISO),
)

_owner, _owner_cols = ref_composite("owner", "owner")
define(
    "inventory.shelf",
    "shelf_items",
    Col("id", ID),
    Col("createdBy", ID),
    Col("name", STR),
    Col("kind", ID),
    Col("sportId", ID),
    Col("quantity", INT),
    Col("condition", ID),
    Col("districtId", ID),
    Col("terms", STRS),
    Col("note", STR),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    # Оплата на сайте: «Продаю» — цена за штуку
    Col("sale", JSON),
    Col("photoUrl", STR),
    composites=(_owner,),
    extra_columns=_owner_cols,
)

define(
    "inventory.loans",
    "gear_loans",
    Col("id", ID),
    # Без внешнего ключа: вещь можно убрать с полки, а история просьб остаётся.
    Col("itemId", ID, index=True),
    Col("eventId", ID),
    Col("lineId", ID),
    Col("requesterId", ID),
    Col("quantity", INT),
    Col("comment", STR),
    Col("status", ID),
    Col("reason", STR),
    Col("createdAt", ISO),
    Col("decidedAt", ISO),
    Col("returnedAt", ISO),
)

define(
    "inventory.support",
    "support_needs",
    Col("id", ID),
    Col("orgId", ID, fk="organizations.id"),
    Col("eventId", ID),
    Col("title", STR),
    Col("details", STR),
    Col("deadline", ISO),
    Col("status", ID),
    Col("offers", JSON),
    Col("closedByOrgId", ID),
    Col("closedAt", ISO),
    Col("createdBy", ID),
    Col("createdAt", ISO),
)

# ---------- В8, В6, С16: сообщества, журнал спроса, жалобы ----------

define(
    "communitySources",
    "community_sources",
    Col("id", ID),
    Col("name", STR),
    Col("url", STR),
    Col("orgId", ID),
    Col("transferredTo", ID),
    Col("transferredAt", ISO),
    Col("createdAt", ISO),
)

define(
    "importedPosts",
    "imported_posts",
    Col("id", ID),
    Col("sourceId", ID, fk="community_sources.id"),
    Col("externalId", STR),
    Col("postUrl", STR),
    Col("text", STR),
    Col("postedAt", ISO),
    Col("importedAt", ISO),
    Col("status", ID),
    Col("meeting", BOOL),
    Col("draft", JSON),
    Col("assisted", JSON),
    Col("eventId", ID),
    Col("rejectReason", STR),
    Col("decidedBy", ID),
    Col("decidedAt", ISO),
)

define(
    "demandLog",
    "demand_log",
    Col("id", ID),
    Col("at", ISO, index=True),
    Col("kind", ID),
    Col("sportId", ID),
    Col("districtId", ID),
    Col("phrase", STR),
    Col("audience", STRS),
    Col("free", BOOL),
    Col("results", INT),
    Col("demo", BOOL),
)

define(
    "reports",
    "reports",
    Col("id", ID),
    Col("targetType", ID),
    Col("targetId", ID),
    Col("eventId", ID),
    Col("reporterId", ID),
    Col("reason", ID),
    Col("comment", STR),
    Col("status", ID),
    Col("createdAt", ISO),
    Col("decidedAt", ISO),
    Col("decidedBy", ID),
)

# ---------- С13, Н3: приглашения по ссылке, команды ----------

define(
    "inviteGrants",
    "invite_grants",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("userId", ID, null=False, fk="users.id"),
    Col("code", ID),
    Col("at", ISO),
    key=None,
)

define(
    "eventTeams",
    "event_teams",
    Col("id", ID),
    Col("eventId", ID, fk="events.id", index=True),
    Col("captainId", ID),
    Col("members", JSON),
    Col("until", ISO),
    Col("needsApproval", BOOL),
    Col("accepted", BOOL),
    Col("status", ID),
    Col("createdAt", ISO),
)

# ---------- С8, С14, С15: избранное, управляющие, «Встреча состоялась?»; ссылки близким ----------

define(
    "engagement.favorites",
    "favorites",
    Col("userId", ID, null=False, fk="users.id"),
    Col("eventId", ID, null=False, fk="events.id"),
    Col("at", ISO),
    key=None,
    unique=("user_id", "event_id"),
)

define(
    "engagement.follows",
    "follows",
    Col("userId", ID, null=False, fk="users.id"),
    Col("kind", ID),
    Col("targetId", ID),
    Col("at", ISO),
    key=None,
)

define(
    "engagement.savedSearches",
    "saved_searches",
    Col("id", ID),
    Col("userId", ID, fk="users.id"),
    Col("name", STR),
    Col("query", STR),
    Col("criteria", JSON),
    Col("summary", STR),
    Col("createdAt", ISO),
)

define_scalar("engagement.matchNotified", "match_notified")

define(
    "engagement.managers",
    "org_managers",
    Col("orgId", ID, null=False, fk="organizations.id"),
    Col("userId", ID, null=False, fk="users.id"),
    Col("addedBy", ID),
    Col("at", ISO),
    key=None,
    unique=("org_id", "user_id"),
)

define(
    "engagement.heldVotes",
    "held_votes",
    Col("eventId", ID, null=False, fk="events.id"),
    Col("userId", ID, null=False, fk="users.id"),
    Col("answer", ID),
    Col("at", ISO),
    key=None,
)

define_scalar("engagement.heldAsked", "held_asked")

define(
    "engagement.shareLinks",
    "share_links",
    Col("token", ID),
    Col("eventId", ID, fk="events.id"),
    Col("userId", ID, fk="users.id"),
    Col("createdAt", ISO),
    Col("expiresAt", ISO),
    Col("revokedAt", ISO),
    key="token",
)

# ---------- Подборка дня: настройки и отправленные подборки ----------

define(
    "digestPrefs",
    "digest_prefs",
    Col("userId", ID, fk="users.id"),
    Col("on", BOOL, name="is_on"),
    Col("hour", INT),
    Col("email", BOOL),
    # Местная дата последней попытки («2026-10-19»): не ISO, поэтому сдвиг демо-дат её не трогает.
    Col("lastDay", STR),
    Col("token", ID, index=True),
    Col("updatedAt", ISO),
    key="userId",
)

define(
    "digests",
    "digests",
    Col("id", ID),
    Col("userId", ID, null=False, fk="users.id", index=True),
    Col("items", JSON),
    Col("createdAt", ISO),
    Col("day", STR),
    Col("trigger", ID, name="trigger_kind"),
    Col("mail", ID, index=True),
    Col("mailAt", ISO),
    Col("intro", STR),
)

# ---------- D-16: стоп-листы организаторов ----------

_stop_entries = define(
    "stopList",
    "stop_entries",
    Col("id", ID),
    Col("ownerKind", ID, null=False),
    Col("ownerId", ID, null=False),
    Col("userId", ID, null=False, fk="users.id", index=True),
    Col("reasonCode", ID, null=False),
    Col("reasonText", STR),
    Col("note", STR),
    Col("until", ISO),
    Col("addedBy", ID, fk="users.id"),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("liftedAt", ISO),
    Col("liftedBy", ID, fk="users.id"),
    Col("liftedReason", STR),
)
# Одна запись на пару «чей список — кто в нём»: повторное добавление обновляет её.
_stop_entries.table.append_constraint(
    sa.UniqueConstraint("owner_kind", "owner_id", "user_id", name="uq_stop_entries_owner_user")
)

# ---------- Оплата на сайте: платежи, очередь операций к ЮKassa, сроки, заказы, зачисления, выплаты ----------
# Без внешних ключей на пользователей и события: история денег остаётся, даже если запись удалили.

define(
    "payments",
    "payments",
    Col("id", ID),
    Col("userId", ID, null=False, index=True),
    Col("kind", ID, null=False),
    Col("targetId", ID, null=False, index=True),
    Col("method", ID, null=False),
    Col("base", NUM),
    Col("fee", NUM),
    Col("total", NUM),
    Col("feeParts", JSON),
    Col("initialTotal", NUM),
    Col("capture", BOOL),
    Col("provider", ID),
    Col("providerPaymentId", ID, index=True),
    Col("status", ID, null=False, index=True),
    Col("capturedAmount", NUM),
    Col("refundedAmount", NUM),
    Col("confirmationUrl", STR),
    Col("forfeited", BOOL),
    Col("creditedAt", ISO),
    Col("test", BOOL),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("paidAt", ISO),
    Col("reason", STR),
)

define(
    "paymentOps",
    "payment_ops",
    Col("id", ID),
    Col("kind", ID, null=False),
    Col("paymentId", ID, index=True),
    Col("payoutId", ID),
    Col("amount", NUM),
    Col("status", ID, null=False, index=True),
    Col("attempts", INT),
    Col("idempotenceKey", STR),
    Col("providerId", ID, index=True),
    Col("error", STR),
    Col("reason", STR),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
)

define(
    "paymentDues",
    "payment_dues",
    Col("id", ID),
    Col("eventId", ID, null=False, index=True),
    Col("participationId", ID, null=False, index=True),
    Col("userId", ID, null=False),
    Col("dueAt", ISO),
    Col("opensAt", ISO),
    Col("notifiedAt", ISO),
    Col("status", ID, null=False),
    Col("createdAt", ISO),
)

_seller, _seller_cols = ref_composite("seller", "seller")
define(
    "orders",
    "item_orders",
    Col("id", ID),
    Col("itemId", ID, index=True),
    Col("itemName", STR),
    Col("buyerId", ID, null=False, index=True),
    Col("quantity", INT),
    Col("price", NUM),
    Col("amount", NUM),
    Col("paymentId", ID),
    Col("status", ID, null=False),
    Col("payDueAt", ISO),
    Col("autoCompleteAt", ISO),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("paidAt", ISO),
    Col("receivedAt", ISO),
    Col("canceledAt", ISO),
    Col("canceledBy", ID),
    Col("reason", STR),
    composites=(_seller,),
    extra_columns=_seller_cols,
)

_credit_to, _credit_cols = ref_composite("recipient", "recipient")
define(
    "credits",
    "balance_credits",
    Col("id", ID),
    Col("amount", NUM),
    Col("source", ID),
    Col("targetId", ID),
    Col("title", STR),
    Col("at", ISO),
    composites=(_credit_to,),
    extra_columns=_credit_cols,
    indexes=(("recipient_kind", "recipient_id"),),
)

_payout_to, _payout_cols = ref_composite("recipient", "recipient")
define(
    "payouts",
    "payouts",
    Col("id", ID),
    Col("amount", NUM),
    Col("status", ID, null=False, index=True),
    Col("method", ID),
    Col("phone", STR),
    Col("bankId", ID),
    Col("bankName", STR),
    Col("providerPayoutId", ID),
    Col("requestedBy", ID),
    Col("createdAt", ISO),
    Col("updatedAt", ISO),
    Col("doneAt", ISO),
    Col("doneBy", ID),
    Col("reason", STR),
    composites=(_payout_to,),
    extra_columns=_payout_cols,
    indexes=(("recipient_kind", "recipient_id"),),
)

# ---------- В1: токены внешнего ассистента ----------

define(
    "mcpTokens",
    "mcp_tokens",
    Col("id", ID),
    Col("userId", ID, fk="users.id"),
    Col("name", STR),
    Col("scopes", STRS),
    Col("hash", ID, index=True),
    Col("last4", ID),
    Col("createdAt", ISO),
    Col("expiresAt", ISO),
    Col("lastUsedAt", ISO),
    Col("revokedAt", ISO),
)

define(
    "mcpCalls",
    "mcp_calls",
    Col("id", ID),
    Col("tokenId", ID),
    Col("userId", ID),
    Col("at", ISO),
    Col("method", STR),
    Col("tool", STR),
    Col("ok", BOOL),
    Col("preview", BOOL),
    Col("error", STR),
)

# ---------- Состояние демо: версия данных, счётчик номеров, настройки ----------

demo_state = sa.Table(
    "demo_state",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("seeded_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("seq", sa.BigInteger, nullable=False),
    sa.Column("settings", JSONB, nullable=False),
)

NAMESPACES = ("inventory", "engagement")
