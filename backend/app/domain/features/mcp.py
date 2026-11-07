"""В1. Внешний ассистент по протоколу MCP.

Личные токены (хранится только хеш), каталог инструментов в формате `tools/list` и обработчик
JSON-RPC 2.0, который действует от имени владельца токена: с проверкой прав, подтверждением
изменяющих действий, лимитом вызовов и журналом без содержимого.
"""

import hashlib
import json
import logging
import math
import re
import secrets
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any, NoReturn
from urllib.parse import urlencode

from app.core.errors import AppError
from app.domain import assistant, bus, clock, core, store
from app.domain.errors import fail
from app.domain.features import venues
from app.domain.lib.dates import day_month, format_event_date, moment
from app.domain.lib.labels import PARTICIPATION_STATUS
from app.domain.lib.money import price_summary
from app.domain.lib.numbers import parse_number
from app.domain.lib.plural import count
from app.domain.lib.text import normalize
from app.domain.lib.venues import venue_price_line, window_label
from app.domain.routing import Route, route
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.types import ID, Actor, Entity

logger = logging.getLogger(__name__)

# Записи и ответы — словари в форме контракта API (frontend/src/types/mcp.ts).
JsonSchema = dict[str, Any]
Args = dict[str, Any]
Outcome = dict[str, Any]
Dispatched = dict[str, Any]

MCP_PROTOCOL_VERSION = "2025-06-18"
MCP_ENDPOINT_PATH = "/mcp"
MCP_CALLS_PER_MINUTE = 30
MCP_MAX_ACTIVE_TOKENS = 10
MCP_EXPIRY_DAYS = [30, 90, 365]
TOKEN_PREFIX = "stp_"  # noqa: S105  начало выпускаемого токена, не секрет
TOKEN_LENGTH = 32
LOG_KEEP = 300
MINUTE = timedelta(minutes=1)
SECONDS = ("секунду", "секунды", "секунд")

RPC_ERROR = {
    "parse": -32700,
    "invalidRequest": -32600,
    "methodNotFound": -32601,
    "invalidParams": -32602,
    "internal": -32603,
    "unauthorized": -32001,
    "forbidden": -32003,
    "rateLimited": -32029,
}

MCP_SCOPES: list[dict[str, str]] = [
    {
        "value": "read",
        "label": "Смотреть события и расписание",
        "hint": "Поиск событий и площадок, карточка события, ваши записи. Есть у каждого токена.",
    },
    {
        "value": "participate",
        "label": "Записываться на события",
        "hint": "Запись, заявка, отмена записи и вопрос организатору. Каждое действие ассистент сначала показывает и выполняет только после подтверждения.",
    },
    {
        "value": "drafts",
        "label": "Готовить черновики событий",
        "hint": "Ассистент заполняет форму нового события. Опубликовать его можете только вы, в приложении.",
    },
]


# ---------- SHA-256 ----------


def sha256_hex(text: str) -> str:
    """SHA-256 строки в UTF-8, hex. Символы, которых нет в UTF-8 (одиночные суррогаты), заменяются."""
    return hashlib.sha256(text.encode(errors="replace")).hexdigest()


ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def random_token() -> str:
    out = ""
    while len(out) < TOKEN_LENGTH:
        for byte in secrets.token_bytes(48):
            # 248 = 4 × 62: без перекоса в сторону первых букв алфавита
            if byte < 248 and len(out) < TOKEN_LENGTH:
                out += ALPHABET[byte % 62]
    return TOKEN_PREFIX + out


# ---------- Хранилище ----------


def state() -> dict[str, list[Entity]]:
    # Демо-токен и журнал загружаются вместе с остальными демо-данными (seed/mcp.py).
    db = store.data()
    return {"tokens": db.mcp_tokens, "calls": db.mcp_calls}


def commit(ids: list[ID] | None = None) -> None:
    bus.publish(["mcp"], ids or [])


def require_user(actor: Actor) -> Entity:
    return actor if actor is not None else fail("auth_required", "Войдите, чтобы подключить ассистента")


def token_status(t: Entity, now: datetime | None = None) -> str:
    if t["revokedAt"]:
        return "revoked"
    expires = clock.parse(t["expiresAt"])
    if expires is not None and expires <= (now or clock.now()):
        return "expired"
    return "active"


def token_view(t: Entity) -> Entity:
    calls = state()["calls"]
    return {
        "id": t["id"],
        "name": t["name"],
        "scopes": t["scopes"],
        "last4": t["last4"],
        "createdAt": t["createdAt"],
        "expiresAt": t["expiresAt"],
        "lastUsedAt": t["lastUsedAt"],
        "revokedAt": t["revokedAt"],
        "status": token_status(t),
        "calls": sum(1 for c in calls if c["tokenId"] == t["id"]),
    }


def _at(record: Entity, key: str) -> datetime:
    """Момент из записи токена или журнала (там всегда строка ISO)."""
    return clock.parse(record[key]) or datetime.min.replace(tzinfo=UTC)


# ---------- Токены ----------


def list_tokens(actor: Actor) -> list[Entity]:
    user = require_user(actor)
    rank = {"active": 0, "expired": 1, "revoked": 2}
    views = [token_view(t) for t in state()["tokens"] if t["userId"] == user["id"]]
    # Сначала действующие, внутри — новые выше.
    views.sort(key=lambda v: _at(v, "createdAt"), reverse=True)
    return sorted(views, key=lambda v: rank[v["status"]])


def issue_token(actor: Actor, input_: dict[str, Any]) -> Entity:
    user = require_user(actor)
    tokens = state()["tokens"]
    name = " ".join(text(input_.get("name")).split())[:60]
    if not name:
        fail("validation", "Назовите токен", {"name": "Назовите токен, например «Ассистент на телефоне»"})
    allowed = ["read", "participate", "drafts"]
    asked = input_.get("scopes") if isinstance(input_.get("scopes"), list) else []
    if any(s not in allowed for s in asked):
        fail("validation", "Неизвестное право", {"scopes": "Выберите права из списка"})
    scopes = [s for s in allowed if s == "read" or s in asked]
    days = parse_number(input_.get("expiresInDays"))
    if days not in MCP_EXPIRY_DAYS:
        fail("validation", "Выберите срок действия", {"expiresInDays": "Выберите срок"})
    active = sum(1 for t in tokens if t["userId"] == user["id"] and token_status(t) == "active")
    if active >= MCP_MAX_ACTIVE_TOKENS:
        fail(
            "bad_state",
            f"У вас уже {MCP_MAX_ACTIVE_TOKENS} действующих токенов. Отзовите ненужный и выпустите новый",
        )

    secret = random_token()
    now = clock.now()
    token: Entity = {
        "id": store.next_id("mcp"),
        "userId": user["id"],
        "name": name,
        "scopes": scopes,
        "hash": sha256_hex(secret),
        "last4": secret[-4:],
        "createdAt": clock.iso(now),
        "expiresAt": clock.iso(now + timedelta(days=days)),
        "lastUsedAt": None,
        "revokedAt": None,
    }
    tokens.append(token)
    commit([token["id"]])
    return {"token": token_view(token), "secret": secret}


def revoke_token(actor: Actor, id_: ID) -> Entity:
    user = require_user(actor)
    token = next((t for t in state()["tokens"] if t["id"] == id_), None)
    if token is None:
        fail("not_found", "Токен не найден")
    if token["userId"] != user["id"]:
        fail("forbidden", "Отозвать токен может только его владелец")
    if not token["revokedAt"]:
        token["revokedAt"] = clock.iso(clock.now())
        commit([token["id"]])
    return token_view(token)


METHOD_LABEL: dict[str, str] = {
    "initialize": "Подключение",
    "ping": "Проверка связи",
    "tools/list": "Список инструментов",
    "resources/list": "Список материалов",
    "resources/read": "Чтение материала",
}


def list_calls(actor: Actor, q: dict[str, Any] | None = None) -> list[Entity]:
    q = q or {}
    user = require_user(actor)
    s = state()
    tokens, calls = s["tokens"], s["calls"]
    rows = [
        c
        for c in calls
        if c["userId"] == user["id"] and (not q.get("tokenId") or c["tokenId"] == q["tokenId"])
    ]
    out: list[Entity] = []
    for c in sorted(rows, key=lambda c: _at(c, "at"), reverse=True)[:50]:
        token = next((t for t in tokens if t["id"] == c["tokenId"]), None)
        tool_def = next((t for t in TOOLS if t["name"] == c["tool"]), None) if c["tool"] else None
        view = {
            **c,
            "tokenName": token["name"] if token is not None else "Удалённый токен",
            "label": (tool_def["title"] if tool_def is not None else None)
            or METHOD_LABEL.get(c["method"])
            or c["method"],
        }
        # `preview` есть только у предпросмотров; запись из базы приходит с None — тогда поля в ответе нет.
        if view.get("preview") is None:
            view.pop("preview", None)
        out.append(view)
    return out


# ---------- Каталог ----------


def str_(title: str, description: str, extra: JsonSchema | None = None) -> JsonSchema:
    return {"type": "string", "title": title, "description": description, **(extra or {})}


def bool_(title: str, description: str, extra: JsonSchema | None = None) -> JsonSchema:
    return {"type": "boolean", "title": title, "description": description, **(extra or {})}


def int_(
    title: str, description: str, minimum: int, maximum: int, extra: JsonSchema | None = None
) -> JsonSchema:
    return {
        "type": "integer",
        "title": title,
        "description": description,
        "minimum": minimum,
        "maximum": maximum,
        **(extra or {}),
    }


EVENT_ID = str_(
    "Событие", "Номер события из search_events или my_schedule, например «e-volley-vzlet».", {"minLength": 1}
)
CONFIRM = bool_(
    "Подтверждение",
    "true — выполнить. Без него инструмент только показывает, что произойдёт, и ничего не меняет. Ставьте true, когда человек согласился.",
    {"default": False},
)


def limit_arg(max_: int, default: int) -> JsonSchema:
    return int_(
        "Сколько показать", f"Сколько результатов вернуть, от 1 до {max_}.", 1, max_, {"default": default}
    )


WHEN: JsonSchema = {
    "type": "string",
    "title": "Когда",
    "description": "Ближайший отрезок времени.",
    "enum": ["today", "tomorrow", "weekend", "week"],
    "enumNames": ["Сегодня", "Завтра", "На выходных", "В ближайшую неделю"],
}
DAY_PART: JsonSchema = {
    "type": "string",
    "title": "Время дня",
    "description": "Утро — до 12:00, день — до 17:00, вечер — позже.",
    "enum": ["morning", "day", "evening"],
    "enumNames": ["Утром", "Днём", "Вечером"],
}
DATE = str_("День", "Конкретный день в формате ГГГГ-ММ-ДД.", {"format": "date"})
SPORT = str_("Направление", "Название направления, например «Йога». Список — list_sports.", {"maxLength": 60})
DISTRICT = str_("Район", "Название района, например «Центральный».", {"maxLength": 60})


def tool(
    name: str,
    title: str,
    description: str,
    properties: dict[str, JsonSchema],
    *,
    scope: str,
    read_only: bool,
    required: list[str] | None = None,
    destructive: bool = False,
    idempotent: bool | None = None,
    confirm: bool = False,
) -> Entity:
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
        "annotations": {
            "title": title,
            "readOnlyHint": read_only,
            "destructiveHint": destructive,
            "idempotentHint": read_only if idempotent is None else idempotent,
            "openWorldHint": False,
        },
        "_meta": {"scope": scope, "confirm": confirm},
    }


TOOLS: list[Entity] = [
    tool(
        "search_events",
        "Найти события",
        "Ищет предстоящие события на платформе. Можно написать запрос обычными словами («волейбол в субботу утром, я новичок») или задать фильтры. Возвращает название, время, место, цену, свободные места и способ записи.",
        {
            "query": str_(
                "Запрос",
                "Что ищете, обычными словами.",
                {"maxLength": 200, "examples": ["волейбол на выходных для новичков"]},
            ),
            "sport": SPORT,
            "when": WHEN,
            "date": DATE,
            "day_part": DAY_PART,
            "district": DISTRICT,
            "free": bool_("Бесплатно", "Только бесплатные события."),
            "beginners": bool_("Для новичков", "Только там, где рады новичкам."),
            "limit": limit_arg(10, 5),
        },
        scope="read",
        read_only=True,
    ),
    tool(
        "get_event",
        "Карточка события",
        "Подробности события: описание, место и ориентир, организатор, цена, свободные места, можно ли записаться и ваша запись.",
        {"event_id": EVENT_ID},
        required=["event_id"],
        scope="read",
        read_only=True,
    ),
    tool(
        "my_schedule",
        "Мои занятия",
        "События, на которые владелец токена записан или отправил заявку, со статусом записи.",
        {"include_past": bool_("Прошедшие", "Добавить прошедшие события.", {"default": False})},
        scope="read",
        read_only=True,
    ),
    tool(
        "join_event",
        "Записаться",
        "Записывает на событие со свободной записью. Если мест нет, ставит в лист ожидания. Без confirm: true только показывает, что произойдёт. Для событий с записью по заявке — apply_to_event.",
        {"event_id": EVENT_ID, "confirm": CONFIRM},
        required=["event_id"],
        scope="participate",
        read_only=False,
        idempotent=True,
        confirm=True,
    ),
    tool(
        "apply_to_event",
        "Отправить заявку",
        "Отправляет организатору заявку на событие с записью по заявке. Решение придёт в уведомления приложения. Без confirm: true только показывает, что произойдёт.",
        {
            "event_id": EVENT_ID,
            "message": str_("Сообщение организатору", "Пара слов о себе: опыт, вопросы.", {"maxLength": 300}),
            "confirm": CONFIRM,
        },
        required=["event_id"],
        scope="participate",
        read_only=False,
        idempotent=True,
        confirm=True,
    ),
    tool(
        "cancel_participation",
        "Отменить запись",
        "Отменяет запись или отзывает заявку. Место освобождается для других, организатор получает уведомление. Без confirm: true только показывает, что произойдёт.",
        {"event_id": EVENT_ID, "confirm": CONFIRM},
        required=["event_id"],
        scope="participate",
        read_only=False,
        destructive=True,
        idempotent=True,
        confirm=True,
    ),
    tool(
        "ask_organizer",
        "Задать вопрос организатору",
        "Публикует вопрос в обсуждении события от имени владельца токена. Организатор получит уведомление. Без confirm: true только показывает, что произойдёт.",
        {
            "event_id": EVENT_ID,
            "question": str_(
                "Вопрос", "Текст вопроса, от 3 до 1000 символов.", {"minLength": 3, "maxLength": 1000}
            ),
            "confirm": CONFIRM,
        },
        required=["event_id", "question"],
        scope="participate",
        read_only=False,
        confirm=True,
    ),
    tool(
        "create_event_draft",
        "Черновик события",
        "Готовит черновик нового события и возвращает ссылку на форму создания с заполненными полями. Сам ничего не публикует: проверить и опубликовать событие может только человек в приложении.",
        {
            "text": str_(
                "Описание",
                "Что, когда, где и для кого, обычными словами.",
                {
                    "maxLength": 1000,
                    "examples": ["Пробежка в субботу в 9 утра на набережной, темп спокойный, новичкам рады"],
                },
            ),
            "title": str_("Название", "Название события.", {"maxLength": 120}),
            "sport": SPORT,
            "date": DATE,
            "time": str_("Начало", "Время начала, ЧЧ:ММ.", {"pattern": r"^([01]\d|2[0-3]):[0-5]\d$"}),
            "address": str_("Место", "Адрес или место встречи.", {"maxLength": 200}),
            "capacity": int_("Мест", "Сколько человек, от 2 до 200.", 2, 200),
            "free": bool_("Бесплатно", "Участие бесплатное."),
        },
        scope="drafts",
        read_only=True,
    ),
    tool(
        "find_venues",
        "Найти площадку",
        "Ищет площадки, где можно заниматься: залы, корты, поля. Показывает цену за час и ближайшие свободные окна.",
        {
            "query": str_("Запрос", "Название, адрес или тип площадки.", {"maxLength": 100}),
            "sport": SPORT,
            "district": DISTRICT,
            "date": str_("День", "Есть свободное окно в этот день, ГГГГ-ММ-ДД.", {"format": "date"}),
            "day_part": DAY_PART,
            "price_max": int_("Цена за час до", "В рублях. 0 — только бесплатные.", 0, 100000),
            "indoor": bool_("Крытая", "true — только крытые, false — только открытые."),
            "limit": limit_arg(10, 5),
        },
        scope="read",
        read_only=True,
    ),
    tool(
        "list_sports",
        "Направления",
        "Каталог направлений: виды спорта и активностей, по которым есть события. Можно искать по названию с опечатками и синонимами.",
        {"query": str_("Название", "Название направления или его часть.", {"maxLength": 60})},
        scope="read",
        read_only=True,
    ),
]

RESOURCES: list[Entity] = [
    {
        "uri": "platform://rules",
        "name": "rules",
        "title": "Правила платформы",
        "description": "Что можно публиковать и как ведут себя участники и организаторы.",
        "mimeType": "text/markdown",
    },
    {
        "uri": "platform://sports",
        "name": "sports",
        "title": "Каталог направлений",
        "description": "Все направления по разделам.",
        "mimeType": "text/markdown",
    },
]

SERVER_INFO = {"name": "sport-i-tochka", "title": "Спорт и точка", "version": "0.1.0"}

INSTRUCTIONS = (
    "Платформа совместных занятий спортом. Все действия выполняются от имени владельца токена и в пределах его прав. "
    "Изменяющие инструменты без confirm: true только показывают, что произойдёт: перескажите это человеку и повторите вызов с confirm: true, когда он согласится. "
    "События публикует только человек в приложении: create_event_draft возвращает ссылку на заполненную форму."
)


def mcp_catalog() -> Entity:
    return {
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "serverInfo": SERVER_INFO,
        "endpointPath": MCP_ENDPOINT_PATH,
        "transport": "Streamable HTTP",
        "limits": {"callsPerMinute": MCP_CALLS_PER_MINUTE, "activeTokens": MCP_MAX_ACTIVE_TOKENS},
        "tools": TOOLS,
        "resources": RESOURCES,
        "scopes": MCP_SCOPES,
        "expiryDays": MCP_EXPIRY_DAYS,
    }


# ---------- Проверка аргументов по inputSchema ----------


def is_number(value: Any) -> bool:
    """Число JSON: int или конечный float, но не bool."""
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and math.isfinite(value))


def is_date(value: str) -> bool:
    """Существующая дата в виде ГГГГ-ММ-ДД."""
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def type_ok(schema: JsonSchema, v: Any) -> bool:
    match schema.get("type"):
        case "string":
            return isinstance(v, str)
        case "integer":
            # 2.0 в JSON — тоже целое число
            return is_number(v) and (isinstance(v, int) or v.is_integer())
        case "number":
            return is_number(v)
        case "boolean":
            return isinstance(v, bool)
        case "array":
            return isinstance(v, list)
        case "object":
            return isinstance(v, dict)
        case _:
            return True


TYPE_NAME: dict[str, str] = {
    "string": "строка",
    "integer": "целое число",
    "number": "число",
    "boolean": "true или false",
    "array": "список",
    "object": "объект",
}


def validate_args(schema: JsonSchema, args: Any) -> dict[str, str]:
    """Проверка аргументов по inputSchema: {аргумент: что не так}; пустой словарь — всё верно."""
    if not isinstance(args, dict):
        return {"arguments": "Аргументы передаются объектом"}
    errors: dict[str, str] = {}
    props: dict[str, JsonSchema] = schema.get("properties", {})
    for key in schema.get("required", []):
        if args.get(key) is None or args.get(key) == "":
            errors[key] = "Обязательный аргумент"
    for key, v in args.items():
        if key in errors or v is None:
            continue
        p = props.get(key)
        if p is None:
            if schema.get("additionalProperties") is False:
                errors[key] = "Такого аргумента нет"
            continue
        if not type_ok(p, v):
            errors[key] = f"Нужно: {TYPE_NAME[p['type']]}"
            continue
        if "enum" in p and v not in p["enum"]:
            errors[key] = f"Допустимо: {', '.join(p['enum'])}"
        elif isinstance(v, str):
            if "minLength" in p and len(v.strip()) < p["minLength"]:
                errors[key] = f"Не короче {p['minLength']} символов"
            elif "maxLength" in p and len(v) > p["maxLength"]:
                errors[key] = f"Не длиннее {p['maxLength']} символов"
            elif p.get("format") == "date" and not is_date(v):
                errors[key] = "Дата в формате ГГГГ-ММ-ДД"
            # Шаблоны JSON Schema записаны в синтаксисе ECMA-262: \d в них — только цифры ASCII.
            elif "pattern" in p and not re.search(p["pattern"], v, re.ASCII):
                errors[key] = "Неверный формат"
        elif is_number(v):
            if "minimum" in p and v < p["minimum"]:
                errors[key] = f"Не меньше {p['minimum']}"
            elif "maximum" in p and v > p["maximum"]:
                errors[key] = f"Не больше {p['maximum']}"
    return errors


# ---------- Инструменты ----------


class ToolRefusal(Exception):  # noqa: N818  отказ инструмента — обычный ответ, а не сбой
    def __init__(self, code: str, message: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra or {}


def refuse(code: str, message: str, extra: dict[str, Any] | None = None) -> NoReturn:
    raise ToolRefusal(code, message, extra)


def text(v: Any) -> str:
    """Строковый аргумент без пробелов по краям; не строка — пусто."""
    return v.strip() if isinstance(v, str) else ""


def limit_of(args: Args) -> int:
    """Сколько результатов вернуть: аргумент limit уже проверен по схеме."""
    limit = args.get("limit")
    return 5 if limit is None else int(limit)


def resolve_sport(name: str) -> ID:
    suggestions = core.domain.list_sports({"q": name})
    found = suggestions[0] if suggestions else None
    if found is None or found.get("id") is None:
        refuse(
            "unknown_sport",
            f"Направление «{name}» не нашлось. Список направлений выдаёт инструмент list_sports",
        )
    return found["id"]


def resolve_district(name: str) -> ID:
    n = normalize(name)
    districts = store.data().districts
    found = next((d for d in districts if n in normalize(d["name"]) or normalize(d["name"]) in n), None)
    if found is None or found.get("id") is None:
        refuse(
            "unknown_district", f"Район «{name}» не нашёлся. Есть: {', '.join(d['name'] for d in districts)}"
        )
    return found["id"]


def is_active(my: Entity | None) -> bool:
    """Запись действует: подтверждена, ждёт решения организатора или стоит в листе ожидания."""
    return my is not None and my["status"] in ACTIVE_PARTICIPATION


def event_brief(e: Entity) -> Entity:
    price = price_summary(e["price"], e["counts"]["confirmed"], e.get("minParticipants"))
    my = e.get("my")
    return {
        "id": e["id"],
        "title": e["title"],
        "sport": e["sport"]["name"],
        "starts_at": e["startsAt"],
        "when": format_event_date(e["startsAt"]),
        "duration_min": e["durationMin"],
        "address": e["place"]["address"],
        "district": e["districtName"],
        "price": price["main"],
        "participants": e["counts"]["confirmed"],
        "spots_left": e["counts"]["spotsLeft"],
        "join_mode": e["joinMode"],
        "beginners_welcome": e["beginnersWelcome"] or e["level"] == "beginner",
        "my_status": my["status"] if my is not None else None,
        "can_join": e["can"]["join"],
        "url": f"/events/{e['id']}",
    }


def event_line(e: Entity, i: int | None = None) -> str:
    b = event_brief(e)
    if b["spots_left"] is None:
        seats = "мест без ограничения"
    elif b["spots_left"] > 0:
        seats = f"свободно мест: {b['spots_left']}"
    else:
        seats = "мест нет"
    join = "свободная запись" if e["joinMode"] == "open" else "запись по заявке"
    my = e.get("my")
    mine = f", {PARTICIPATION_STATUS[my['status']]['label'].lower()}" if is_active(my) else ""
    number = f"{i + 1}. " if i is not None else ""
    district = f", {b['district']}" if b["district"] else ""
    return f"{number}«{b['title']}» ({b['sport']}), {b['when']}. {b['address']}{district}. {b['price']}, {seats}, {join}{mine}. id: {b['id']}"


def raw_event(id_: ID) -> Entity:
    found = store.data().record("events", id_)
    if found is None:
        refuse("not_found", "Событие не найдено. Проверьте id через search_events")
    return found


def details(owner: Entity, args: Args) -> Entity:
    id_ = text(args.get("event_id"))
    raw_event(id_)
    return core.domain.event_details(owner, id_)


def check_join(owner: Entity, e: Entity) -> None:
    """Проверка до записи: та же, что делает запись, но без изменений."""
    if is_active(e.get("my")):
        return
    check = core.domain.can_join(owner, raw_event(e["id"]))
    if not check["ok"]:
        refuse(check.get("code") or "bad_state", check["reason"])


def join_done(owner: Entity, id_: ID, note: str | None = None) -> Outcome:
    before = core.domain.event_details(owner, id_).get("my")
    was = before["status"] if is_active(before) else None
    d = core.domain.join(owner, id_, {"note": note} if note else {})
    my = d.get("my")
    status = my["status"] if my is not None else None
    position = my.get("waitlistPosition") if my is not None else None
    what = {
        "confirmed": f"Вы записаны на «{d['title']}». {format_event_date(d['startsAt'])}, {d['place']['address']}.",
        "pending": f"Заявка на «{d['title']}» отправлена организатору. Решение придёт в уведомления приложения.",
        "waitlist": f"Мест нет: вы в листе ожидания на «{d['title']}»{f', {position}-й' if position else ''}. Если место освободится, придёт уведомление.",
    }
    return {
        "text": (
            f"Вы уже были записаны: {PARTICIPATION_STATUS[was]['label'].lower()}. Ничего не изменилось."
            if was
            else what.get(status, "Готово.")
        ),
        "data": {"done": not was, "status": status, "event": event_brief(d)},
    }


def preview_of(
    action: str,
    e: Entity,
    will_be: str,
    sentence: str,
    extra: dict[str, Any] | None = None,
) -> Outcome:
    return {
        "preview": True,
        "text": f"Предпросмотр, ничего не изменено. {sentence} Чтобы выполнить, повторите вызов с confirm: true.",
        "data": {
            "preview": True,
            "action": action,
            "will_be": will_be,
            "event": event_brief(e),
            **(extra or {}),
        },
    }


def search_events(owner: Entity, args: Args) -> Outcome:
    q: dict[str, Any] = {"scope": "feed"}
    understood: list[str] = []
    phrase = text(args.get("query"))
    if phrase:
        parsed = assistant.parse_search(phrase, core.domain.assistant_context)
        if parsed["filters"]:
            q.update(parsed["filters"])
        else:
            q["q"] = phrase
        understood = [c["label"] for c in parsed["chips"]]
    if text(args.get("sport")):
        q["sportIds"] = [resolve_sport(text(args.get("sport")))]
    if args.get("when"):
        q["when"] = args["when"]
    if args.get("date"):
        q["when"] = "date"
        q["date"] = args["date"]
    if args.get("day_part"):
        q["dayPart"] = args["day_part"]
    if text(args.get("district")):
        q["districtId"] = resolve_district(text(args.get("district")))
    if args.get("free") is True:
        q["free"] = True
    if args.get("beginners") is True:
        q["beginners"] = True
    all_ = core.domain.list_events(owner, q, raw=True)
    items = core.domain.event_views(owner, [core.domain._event_for_read(e["id"]) or e for e in all_[:limit_of(args)]])
    head = f"Понял запрос так: {', '.join(understood)}. " if understood else ""
    if items:
        first = f" Первые {len(items)}:" if len(all_) > len(items) else ""
        lines = "\n".join(event_line(e, i) for i, e in enumerate(items))
        text_ = f"{head}Нашлось событий: {len(all_)}.{first}\n{lines}"
    else:
        text_ = f"{head}Ничего не нашлось. Попробуйте другой день, район или направление."
    return {
        "text": text_,
        "data": {"total": len(all_), "understood": understood, "events": [event_brief(e) for e in items]},
    }


def get_event(owner: Entity, args: Args) -> Outcome:
    e = details(owner, args)
    brief = event_brief(e)
    can = e["can"]
    data = {
        **brief,
        "description": e["description"],
        "landmark": e["place"]["landmark"],
        "organizer": e["organizerView"]["name"],
        "state": e["state"],
        "level": e["level"],
        "join_reason": "" if can["join"] else can["joinReason"],
        "can_ask": can["ask"],
        "ask_reason": "" if can["ask"] else can["askReason"],
        "private_info": e["privateInfo"] if can["seePrivate"] and e.get("privateInfo") else None,
    }
    if can["join"]:
        join_line = "Записаться можно."
    elif is_active(e.get("my")):
        join_line = ""
    else:
        join_line = f"Записаться нельзя: {can['joinReason']}."
    lines = [
        event_line(e),
        f"Ориентир: {e['place']['landmark']}." if e["place"]["landmark"] else "",
        f"Организатор: {data['organizer']}.",
        e["description"],
        join_line,
        f"Для участников: {data['private_info']}" if data["private_info"] else "",
    ]
    return {"text": "\n".join(line for line in lines if line), "data": data}


def my_schedule(owner: Entity, args: Args) -> Outcome:
    with_past = args.get("include_past") is True
    list_ = [e for e in core.domain.list_events(owner, {"scope": "participating"}) if is_active(e.get("my"))]
    list_ = [e for e in list_ if with_past or e["state"] in {"upcoming", "live"}]
    if list_:
        lines = "\n".join(event_line(e, i) for i, e in enumerate(list_))
        text_ = f"Ваши занятия ({len(list_)}):\n{lines}"
    else:
        text_ = "Записей на предстоящие события нет."
    return {
        "text": text_,
        "data": {
            "total": len(list_),
            "events": [
                {**event_brief(e), "status_label": PARTICIPATION_STATUS[e["my"]["status"]]["label"]}
                for e in list_
            ],
        },
    }


def join_event(owner: Entity, args: Args) -> Outcome:
    e = details(owner, args)
    if e["joinMode"] != "open" and not is_active(e.get("my")):
        refuse("approval_required", "На это событие записываются по заявке: используйте apply_to_event")
    check_join(owner, e)
    if args.get("confirm") is not True:
        if is_active(e.get("my")):
            return join_done(owner, e["id"])
        full = e["counts"]["spotsLeft"] == 0
        return preview_of(
            "join_event",
            e,
            "waitlist" if full else "confirmed",
            f"Мест на «{e['title']}» нет: вы встанете в лист ожидания."
            if full
            else f"Запись на «{e['title']}» ({format_event_date(e['startsAt'])}) будет подтверждена сразу, организатор получит уведомление.",
        )
    return join_done(owner, e["id"])


def apply_to_event(owner: Entity, args: Args) -> Outcome:
    e = details(owner, args)
    if e["joinMode"] == "open" and not is_active(e.get("my")):
        refuse("open_join", "Запись на это событие свободная: используйте join_event")
    check_join(owner, e)
    note = text(args.get("message"))
    if args.get("confirm") is not True:
        if is_active(e.get("my")):
            return join_done(owner, e["id"])
        full = e["counts"]["spotsLeft"] == 0
        lead = (
            "Мест нет: заявка встанет в лист ожидания."
            if full
            else f"Организатор «{e['title']}» получит заявку."
        )
        message = f" Сообщение: «{note}»." if note else ""
        return preview_of(
            "apply_to_event",
            e,
            "waitlist" if full else "pending",
            f"{lead}{message} Решение придёт в уведомления приложения.",
            {"message": note},
        )
    return join_done(owner, e["id"], note)


def cancel_participation(owner: Entity, args: Args) -> Outcome:
    e = details(owner, args)
    my = e.get("my")
    if not is_active(my):
        if my is not None and my["status"] == "cancelled":
            return {
                "text": "Запись уже отменена. Ничего не изменилось.",
                "data": {"done": False, "status": "cancelled", "event": event_brief(e)},
            }
        refuse("no_participation", "У вас нет активной записи на это событие")
    if not e["can"]["leave"]:
        refuse("event_started", "Событие уже началось или закончилось, отменить запись нельзя")
    what = "Запись" if my["status"] == "confirmed" else "Заявка"
    if args.get("confirm") is not True:
        frees = ", место освободится для других" if my["status"] == "confirmed" else ""
        return preview_of(
            "cancel_participation",
            e,
            "cancelled",
            f"{what} на «{e['title']}» ({format_event_date(e['startsAt'])}) будет отменена{frees}. Организатор получит уведомление.",
        )
    res = core.domain.leave(owner, e["id"])
    late = " Срок бесплатной отмены уже прошёл, организатор это увидит." if res["lateCancel"] else ""
    return {
        "text": f"{what} на «{e['title']}» отменена.{late}",
        "data": {
            "done": True,
            "status": "cancelled",
            "late_cancel": res["lateCancel"],
            "event": event_brief(res),
        },
    }


def ask_organizer(owner: Entity, args: Args) -> Outcome:
    e = details(owner, args)
    if not e["can"]["ask"]:
        refuse("discussion_closed", e["can"]["askReason"] or "Задать вопрос в этом обсуждении нельзя")
    question = text(args.get("question"))
    if args.get("confirm") is not True:
        return preview_of(
            "ask_organizer",
            e,
            "posted",
            f"В обсуждении «{e['title']}» появится вопрос от имени {owner['name']}: «{question}». Его увидят организатор и все, кто открывает обсуждение.",
            {"question": question},
        )
    m = core.domain.post_message(owner, {"eventId": e["id"], "text": question})
    return {
        "text": f"Вопрос опубликован в обсуждении «{e['title']}». Ответ организатора придёт в уведомления приложения.",
        "data": {
            "done": True,
            "message_id": m["id"],
            "event": event_brief(e),
            "url": f"/events/{e['id']}#discussion",
        },
    }


def create_event_draft(owner: Entity, args: Args) -> Outcome:
    if owner["role"] == "admin":
        refuse("forbidden", "Администратор не создаёт события")
    description = text(args.get("text"))
    if not description and not text(args.get("title")) and not text(args.get("sport")):
        refuse("validation", "Опишите событие: нужен хотя бы один из аргументов text, title или sport")
    params: dict[str, str] = {}
    fields: list[dict[str, str]] = []

    def put(key: str, value: str, label: str, shown: str | None = None) -> None:
        params[key] = value
        fields.append({"field": label, "value": value if shown is None else shown})

    sports = store.data().sports
    sport_id: str | None = None
    starts_at: str | None = None
    district_id: str | None = None
    if description:
        d = assistant.draft_event(description, core.domain.assistant_context)["draft"]
        sport_id = d.get("sportId")
        starts_at = d.get("startsAt")
        district_id = (d.get("place") or {}).get("districtId")
        if d.get("level") and d["level"] != "any":
            params["level"] = d["level"]
        if d.get("beginnersWelcome"):
            put("beginners", "1", "Новичкам", "рады")
        if (d.get("price") or {}).get("kind") == "free":
            put("free", "1", "Цена", "бесплатно")
        if d.get("capacity"):
            put("capacity", str(d["capacity"]), "Мест")
        if d.get("joinMode"):
            params["joinMode"] = d["joinMode"]
    if text(args.get("sport")):
        sport_id = resolve_sport(text(args.get("sport")))
    if text(args.get("title")):
        put("title", text(args.get("title")), "Название")
    if sport_id:
        sport = next((s for s in sports if s["id"] == sport_id), None)
        put("sportId", sport_id, "Направление", sport["name"] if sport is not None else sport_id)
    starts = moment(starts_at) if starts_at else None
    day = text(args.get("date")) or (f"{starts:%Y-%m-%d}" if starts else "")
    time = text(args.get("time")) or (f"{starts:%H:%M}" if starts else "")
    if day:
        put("date", day, "Дата", day_month(day))
    if time:
        put("time", time, "Начало", time)
    if district_id:
        district = next((x for x in store.data().districts if x["id"] == district_id), None)
        put("districtId", district_id, "Район", district["name"] if district is not None else district_id)
    if text(args.get("address")):
        put("address", text(args.get("address")), "Место")
    if args.get("capacity") is not None:
        put("capacity", str(int(args["capacity"])), "Мест")
    if args.get("free") is True:
        put("free", "1", "Цена", "бесплатно")
    if description:
        params["description"] = description
    path = f"/events/new?{urlencode(params)}"
    # Поле, заполненное дважды (из описания и из аргумента), в списке показывается один раз — первым.
    first: dict[str, dict[str, str]] = {}
    for f in fields:
        first.setdefault(f["field"], f)
    shown = list(first.values())
    filled = (
        "\nЗаполнено: " + "; ".join(f"{f['field'].lower()} {f['value']}" for f in shown) + "."
        if shown
        else ""
    )
    return {
        "text": f"Черновик готов, но не опубликован. Откройте ссылку, проверьте поля и нажмите «Опубликовать»: {path}{filled}",
        "data": {
            "published": False,
            "url": path,
            "path": path,
            "fields": shown,
            "description": description,
        },
    }


def find_venues(owner: Entity, args: Args) -> Outcome:
    q: dict[str, Any] = {}
    if text(args.get("query")):
        q["q"] = text(args.get("query"))
    if text(args.get("sport")):
        q["sportIds"] = [resolve_sport(text(args.get("sport")))]
    if text(args.get("district")):
        q["districtId"] = resolve_district(text(args.get("district")))
    if args.get("date"):
        q["date"] = args["date"]
    if args.get("day_part"):
        q["dayPart"] = args["day_part"]
    if is_number(args.get("price_max")):
        q["priceMax"] = args["price_max"]
    if isinstance(args.get("indoor"), bool):
        q["indoor"] = args["indoor"]
    all_ = venues.list_venues(store.data(), owner, q)
    items = [
        {
            "id": v["id"],
            "name": v["name"],
            "kind": v["kindLabel"],
            "address": v["address"],
            "district": v["districtName"],
            "indoor": v["indoor"],
            "price": venue_price_line(v),
            "sports": [s["name"] for s in v["sports"]],
            "free_windows": [window_label(w, v["timeZone"]) for w in v["nextWindows"]],
            "url": f"/venues/{v['id']}",
        }
        for v in all_[: limit_of(args)]
    ]

    def line(v: Entity, i: int) -> str:
        windows = (
            f" Свободно: {'; '.join(v['free_windows'])}." if v["free_windows"] else " Свободных окон нет."
        )
        return f"{i + 1}. {v['name']} ({v['kind'].lower()}), {v['address']}. {v['price']}.{windows} id: {v['id']}"

    return {
        "text": (
            f"Нашлось площадок: {len(all_)}.\n" + "\n".join(line(v, i) for i, v in enumerate(items))
            if items
            else "Подходящих площадок не нашлось. Попробуйте другой район, день или цену."
        ),
        "data": {"total": len(all_), "venues": items},
    }


def list_sports(_owner: Entity, args: Args) -> Outcome:
    query = text(args.get("query"))
    list_ = (core.domain.list_sports({"q": query}) if query else core.domain.list_sports({}))[:80]
    return {
        "text": (
            f"Направления: {', '.join(s['name'] for s in list_)}."
            if list_
            else f"По запросу «{query}» направлений нет."
        ),
        "data": {
            "total": len(list_),
            "sports": [{"id": s["id"], "name": s["name"], "popular": s["popular"]} for s in list_],
        },
    }


HANDLERS: dict[str, Callable[[Entity, Args], Outcome]] = {
    "search_events": search_events,
    "get_event": get_event,
    "my_schedule": my_schedule,
    "join_event": join_event,
    "apply_to_event": apply_to_event,
    "cancel_participation": cancel_participation,
    "ask_organizer": ask_organizer,
    "create_event_draft": create_event_draft,
    "find_venues": find_venues,
    "list_sports": list_sports,
}


def read_resource(uri: str) -> str:
    if uri == "platform://rules":
        rules = sorted(store.data().rules, key=lambda r: r["number"])
        return "\n\n".join(
            ["# Правила платформы", *(f"## {r['number']}. {r['title']}\n{r['text']}" for r in rules)]
        )
    if uri == "platform://sports":
        return "\n\n".join(
            [
                "# Каталог направлений",
                *(
                    f"## {c['name']}\n{', '.join(s['name'] for s in c['sports'])}"
                    for c in core.domain.list_categories()
                    if c["sports"]
                ),
            ]
        )
    return refuse("not_found", f"Материала {uri} нет. Список — resources/list")


# ---------- JSON-RPC ----------


def rpc_error(
    http_status: int,
    code: int,
    message: str,
    data: dict[str, Any] | None = None,
    log_code: str | None = None,
    tool: str | None = None,
) -> Dispatched:
    return {
        "httpStatus": http_status,
        "error": {"code": code, "message": message, "data": data if data is not None else {}},
        "tool": tool,
        "ok": False,
        "code": log_code,
    }


def tool_result(outcome: Outcome) -> Entity:
    return {
        "content": [{"type": "text", "text": outcome["text"]}],
        "structuredContent": outcome["data"],
        "isError": False,
    }


def tool_error(code: str, message: str, extra: dict[str, Any] | None = None) -> Entity:
    return {
        "content": [{"type": "text", "text": message}],
        "structuredContent": {"error": {"code": code, "message": message, **(extra or {})}},
        "isError": True,
    }


def call_tool(token: Entity, owner: Entity, params: dict[str, Any]) -> Dispatched:
    name = params["name"] if isinstance(params.get("name"), str) else ""
    def_ = next((t for t in TOOLS if t["name"] == name), None)
    if def_ is None:
        return rpc_error(
            200,
            RPC_ERROR["invalidParams"],
            f"Инструмента «{name}» нет. Список — tools/list",
            {},
            "unknown_tool",
        )
    if def_["_meta"]["scope"] not in token["scopes"]:
        scope = next(s for s in MCP_SCOPES if s["value"] == def_["_meta"]["scope"])
        return rpc_error(
            403,
            RPC_ERROR["forbidden"],
            f"У токена нет права «{scope['label']}». Владелец может выпустить токен с этим правом в разделе «Подключить ассистента»",
            {"requiredScope": def_["_meta"]["scope"], "httpStatus": 403},
            "forbidden_scope",
            name,
        )
    args: Args = {} if params.get("arguments") is None else params["arguments"]
    problems = validate_args(def_["inputSchema"], args)
    if problems:
        list_ = "; ".join(f"{k}: {v}" for k, v in problems.items())
        return {
            "httpStatus": 200,
            "result": tool_error("validation", f"Проверьте аргументы. {list_}", {"fields": problems}),
            "tool": name,
            "ok": False,
            "code": "validation",
        }
    # Отказ может случиться посреди изменения: тогда данные возвращаются к состоянию перед вызовом.
    restore = store.data().checkpoint()
    try:
        outcome = HANDLERS[name](owner, args)
        return {
            "httpStatus": 200,
            "result": tool_result(outcome),
            "tool": name,
            "ok": True,
            "preview": outcome.get("preview"),
            "code": None,
        }
    except Exception as error:  # любой сбой инструмента — ответ протокола, а не ошибка HTTP
        restore()
        if isinstance(error, ToolRefusal):
            return {
                "httpStatus": 200,
                "result": tool_error(error.code, error.message, error.extra),
                "tool": name,
                "ok": False,
                "code": error.code,
            }
        if isinstance(error, AppError):
            return {
                "httpStatus": 200,
                "result": tool_error(error.code, error.message),
                "tool": name,
                "ok": False,
                "code": error.code,
            }
        logger.exception("Инструмент MCP %s завершился ошибкой", name)
        return rpc_error(
            500,
            RPC_ERROR["internal"],
            "Не получилось выполнить вызов. Попробуйте ещё раз",
            {},
            "internal",
            name,
        )


def dispatch(token: Entity, owner: Entity, method: str, params: dict[str, Any]) -> Dispatched:
    def ok(result: dict[str, Any]) -> Dispatched:
        return {"httpStatus": 200, "result": result, "tool": None, "ok": True, "code": None}

    match method:
        case "initialize":
            return ok(
                {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}},
                    "serverInfo": SERVER_INFO,
                    "instructions": INSTRUCTIONS,
                }
            )
        case "ping":
            return ok({})
        case "tools/list":
            return ok({"tools": TOOLS})
        case "tools/call":
            return call_tool(token, owner, params)
        case "resources/list":
            return ok({"resources": RESOURCES})
        case "resources/read":
            uri = params["uri"] if isinstance(params.get("uri"), str) else ""
            res = next((r for r in RESOURCES if r["uri"] == uri), None)
            if res is None:
                return rpc_error(
                    200,
                    RPC_ERROR["invalidParams"],
                    f"Материала «{uri}» нет. Список — resources/list",
                    {"uri": uri},
                    "unknown_resource",
                )
            return ok({"contents": [{"uri": uri, "mimeType": res["mimeType"], "text": read_resource(uri)}]})
        case _:
            return rpc_error(
                200,
                RPC_ERROR["methodNotFound"],
                f"Метод «{method}» не поддерживается",
                {},
                "method_not_found",
            )


_BEARER = re.compile(r"Bearer\s+(\S+)", re.IGNORECASE)


def authenticate(header: str | None, now: datetime) -> dict[str, Any]:
    """{ token, owner } или { failure, token? }."""

    def unauthorized(message: str, reason: str, token: Entity | None = None) -> dict[str, Any]:
        return {
            "failure": rpc_error(
                401, RPC_ERROR["unauthorized"], message, {"httpStatus": 401, "reason": reason}, reason
            ),
            "token": token,
        }

    match = _BEARER.fullmatch((header or "").strip())
    if not match:
        return unauthorized("Нужен токен доступа: заголовок Authorization: Bearer <токен>", "missing_token")
    hash_ = sha256_hex(match[1])
    token = next((t for t in state()["tokens"] if t["hash"] == hash_), None)
    if token is None:
        return unauthorized(
            "Токен не подошёл. Проверьте, что он скопирован целиком, или выпустите новый", "invalid_token"
        )
    status = token_status(token, now)
    if status == "revoked":
        revoked = moment(token["revokedAt"])
        return unauthorized(
            f"Токен «{token['name']}» отозван {day_month(revoked)} в {revoked:%H:%M}. Выпустите новый в разделе «Подключить ассистента»",
            "revoked",
            token,
        )
    if status == "expired":
        return unauthorized(
            f"Срок действия токена «{token['name']}» закончился. Выпустите новый", "expired", token
        )
    owner = core.domain.user(token["userId"])
    if owner is None:
        return unauthorized("Владелец токена не найден", "invalid_token", token)
    return {"token": token, "owner": owner}


def record(token: Entity, method: str, d: Dispatched, now: datetime) -> None:
    s = state()
    at = clock.iso(now)
    entry: Entity = {
        "id": store.next_id("mcpc"),
        "tokenId": token["id"],
        "userId": token["userId"],
        "at": at,
        "method": method,
        "tool": d["tool"],
        "ok": d["ok"],
        "error": d["code"],
    }
    if d.get("preview"):
        entry["preview"] = True
    calls = s["calls"]
    calls.append(entry)
    if len(calls) > LOG_KEEP:
        del calls[: len(calls) - LOG_KEEP]
    current = next((t for t in s["tokens"] if t["id"] == token["id"]), None)
    if current is not None and d["code"] not in {"revoked", "expired"}:
        current["lastUsedAt"] = at
    commit([token["id"]])


def respond(id_: Any, d: Dispatched) -> Entity:
    if d.get("error") is not None:
        response = {"jsonrpc": "2.0", "id": id_, "error": d["error"]}
    else:
        response = {"jsonrpc": "2.0", "id": id_, "result": d.get("result") or {}}
    return {"httpStatus": d["httpStatus"], "response": response}


def _reject_constant(name: str) -> NoReturn:
    # NaN и Infinity — не JSON, хотя json.loads их по умолчанию принимает.
    raise ValueError(name)


def rpc_id(raw: Any) -> str | int | float | None:
    """id ответа — тот же, что в запросе: строка или конечное число; иначе null."""
    return raw if isinstance(raw, str) or is_number(raw) else None


def mcp_exchange(input_: dict[str, Any], now: datetime | None = None) -> Entity:
    """Точка `/mcp`: один HTTP-запрос с заголовком Authorization и телом JSON-RPC 2.0.

    Пакеты (массивы) протокол с версии 2025-06-18 не допускает.
    `input_` — `{ authorization?, message }`: заголовок и тело (строкой или уже разобранным JSON).
    """
    now = now or clock.now()
    message = input_.get("message")
    if isinstance(message, str):
        try:
            message = json.loads(message, parse_constant=_reject_constant)
        except (ValueError, RecursionError):
            return respond(None, rpc_error(400, RPC_ERROR["parse"], "Тело запроса — не JSON"))
    req = message if isinstance(message, dict) else None
    # Без id — уведомление; id: null запрещён протоколом.
    has_id = req is not None and "id" in req
    raw_id = req.get("id") if req is not None else None
    id_ = rpc_id(raw_id)
    if (
        req is None
        or req.get("jsonrpc") != "2.0"
        or not isinstance(req.get("method"), str)
        or (has_id and not (isinstance(raw_id, str | int | float) and not isinstance(raw_id, bool)))
    ):
        return respond(
            id_,
            rpc_error(
                400,
                RPC_ERROR["invalidRequest"],
                'Нужен объект JSON-RPC 2.0: { jsonrpc: "2.0", id, method, params }',
            ),
        )
    if "params" in req and not isinstance(req["params"], dict):
        return respond(id_, rpc_error(200, RPC_ERROR["invalidParams"], "params должен быть объектом"))

    method: str = req["method"]
    params: dict[str, Any] = req.get("params") or {}
    name = params.get("name")
    tool_name = name if method == "tools/call" and isinstance(name, str) and name else None
    auth = authenticate(input_.get("authorization"), now)
    if "failure" in auth:
        if auth.get("token"):
            record(auth["token"], method, {**auth["failure"], "tool": tool_name}, now)
        return respond(id_, auth["failure"])
    # Уведомление (без id) не требует ответа: сервер отвечает 202 без тела.
    if not has_id:
        return {"httpStatus": 202, "response": None}

    recent = [
        at
        for c in state()["calls"]
        if c["tokenId"] == auth["token"]["id"]
        and c["error"] != "rate_limit"
        and (at := clock.parse(c["at"])) is not None
        and now - MINUTE < at <= now
    ]
    if len(recent) >= MCP_CALLS_PER_MINUTE:
        retry_after_sec = max(1, math.ceil((min(recent) + MINUTE - now).total_seconds()))
        limited = rpc_error(
            429,
            RPC_ERROR["rateLimited"],
            f"Слишком много вызовов: не больше {MCP_CALLS_PER_MINUTE} в минуту. Повторите через {count(retry_after_sec, SECONDS)}",
            {"httpStatus": 429, "retryAfterSec": retry_after_sec},
            "rate_limit",
            tool_name,
        )
        record(auth["token"], method, limited, now)
        return respond(id_, limited)

    d = dispatch(auth["token"], auth["owner"], method, params)
    record(auth["token"], method, d, now)
    return respond(id_, d)


# ---------- Маршруты API ----------


def mcp_routes(actor: Callable[[], Actor]) -> list[Route]:
    """Действия (custom). Формат совпадает с маршрутами dataProvider."""
    return [
        route("get", r"^/mcp/catalog$", lambda _p, _b, _q: mcp_catalog()),
        route("get", r"^/mcp/tokens$", lambda _p, _b, _q: list_tokens(actor())),
        route("post", r"^/mcp/tokens$", lambda _p, b, _q: issue_token(actor(), b)),
        route("post", r"^/mcp/tokens/([^/]+)/revoke$", lambda p, _b, _q: revoke_token(actor(), p[0])),
        route(
            "get",
            r"^/mcp/calls$",
            lambda _p, _b, q: list_calls(
                actor(), {"tokenId": q["tokenId"] if isinstance(q.get("tokenId"), str) else None}
            ),
        ),
        # Точка протокола: личность берётся только из токена, а не из сессии приложения.
        route("post", r"^/mcp$", lambda _p, b, _q: mcp_exchange(b)),
    ]
