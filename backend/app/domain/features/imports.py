"""В8 «Наполнение из сообществ».

Администратор загружает выгрузку публичных постов сообщества (JSON стены VK или текст, посты
через пустую строку). Каждый пост разбирается тем же помощником, что и «Создать с помощником»,
и попадает в очередь черновиков. Опубликованная встреча выходит от служебной организации
«Сообщество «…» (импорт)» со ссылкой на источник; сообщество может забрать страницу через обычную
заявку организации. Автора поста не храним: только текст (телефоны и почта скрываются), дату,
ссылку и сообщество.
"""

import json
import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.domain import assistant, clock, store
from app.domain.errors import fail
from app.domain.features import reports
from app.domain.features.kit import commit, db, notify
from app.domain.lib.cities import city_of_place
from app.domain.lib.event_rules import valid_event_image, valid_org_logo
from app.domain.lib.numbers import parse_number
from app.domain.lib.text import normalize
from app.domain.types import ID, Actor, Entity
from app.domain.schema import COLLECTIONS

if TYPE_CHECKING:
    from app.domain.core import Domain

SERVICE_USER_ID = "u-import"
MAX_POSTS = 100
MAX_FILE = 1_000_000
MAX_TEXT = 2000
STALE_DAYS = 7
# Относительные даты («завтра», «в субботу») считаются от даты поста, если он свежий.
RELATIVE_DAYS = 14
# Регулярные занятия из поста: не дольше, чем серия при обычном создании встречи (core.MAX_SERIES).
MAX_SERIES_WEEKS = 12
# Расписание вида «вт и чт в 19:00»: первая встреча и ещё до шести дней недели.
MAX_EXTRA_STARTS = 6
MAX_ABOUT = 600


def _sources() -> list[Entity]:
    return db().community_sources


def _posts() -> list[Entity]:
    return db().imported_posts


def _text(value: Any) -> str:
    """Текстовое поле из выгрузки или запроса без пробелов по краям; не строка — пусто."""
    return value.strip() if isinstance(value, str) else ""


# ---------- Разбор выгрузки ----------

_SCHEME = re.compile(r"^https?://")
_WWW = re.compile(r"^(?:www|m)\.")
_URL_TAIL = re.compile(r"[?#].*", re.DOTALL)
_VALID_SOURCE = re.compile(r"(?:vk\.com|t\.me|ok\.ru)/[a-z0-9_.-]{2,64}")


def source_key(url: str) -> str:
    """«https://vk.com/club123?w=wall» → «vk.com/club123»."""
    clean = _SCHEME.sub("", url.strip().lower(), count=1)
    clean = _WWW.sub("", clean, count=1)
    return _URL_TAIL.sub("", clean, count=1).rstrip("/")


def _valid_source_url(url: str) -> bool:
    return bool(_VALID_SOURCE.fullmatch(source_key(url)))


_EMAIL = re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9_-]+\.[A-Za-z0-9_.]+")
_PHONE = re.compile(r"(?:\+7|8)[\s(-]*[0-9]{3}[\s)-]*[0-9]{3}[\s-]*[0-9]{2}[\s-]*[0-9]{2}")
_ID_MENTION = re.compile(r"\[id[0-9]+\|([^\]]+)\]")
_GROUP_MENTION = re.compile(r"\[(?:club|public)[0-9]+\|([^\]]+)\]")
_INLINE_SPACES = re.compile(r"[ \t]+")
_MANY_NEWLINES = re.compile(r"\n{3,}")


def scrub_text(text: str) -> str:
    """Персональные данные из текста поста: телефоны, почта, упоминания людей."""
    text = text.replace("\r", "")
    text = _EMAIL.sub("[почта скрыта]", text)
    text = _PHONE.sub("[телефон скрыт]", text)
    text = _ID_MENTION.sub(r"\1", text)
    text = _GROUP_MENTION.sub(r"\1", text)
    text = _INLINE_SPACES.sub(" ", text)
    text = _MANY_NEWLINES.sub("\n\n", text)
    return text.strip()[:MAX_TEXT]


def _unix_to_iso(value: Any) -> str | None:
    """Дата поста: секунды Unix (как у VK) или миллисекунды; None, если даты нет."""
    n = parse_number(value)
    if n is None or n <= 0:
        return None
    try:
        return clock.iso(datetime.fromtimestamp(n if n < 1e12 else n / 1000, UTC))
    except (OverflowError, OSError, ValueError):
        return None


def _number_text(value: Any) -> str | None:
    """Номер из выгрузки строкой («412»; 412.0 — тоже «412»); None, если номера нет."""
    if isinstance(value, str):
        return value.strip() or None
    number = parse_number(value)
    return None if number is None else str(number)


def _first_copy_text(history: Any) -> Any:
    """Текст первого репоста: `copy_history[0].text`."""
    first = history[0] if isinstance(history, list) and history else None
    return first.get("text") if isinstance(first, dict) else None


def _no_constants(name: str) -> Any:
    # NaN и Infinity — не JSON, хотя json.loads их по умолчанию принимает.
    raise ValueError(name)


def _parse_json(content: str) -> dict[str, list[dict[str, Any]]]:
    try:
        data = json.loads(content, parse_constant=_no_constants)
    except (ValueError, RecursionError):
        return fail(
            "validation",
            "Файл похож на JSON, но прочитать его не удалось. Проверьте, что выгрузка не обрезана",
            {"file": "Файл повреждён"},
        )
    root = data.get("response") if isinstance(data, dict) else None
    if root is None:
        root = data
    if isinstance(root, list):
        items: list[Any] = root
    elif isinstance(root, dict) and isinstance(root.get("items"), list):
        items = root["items"]
    else:
        items = []
    groups = root["groups"] if isinstance(root, dict) and isinstance(root.get("groups"), list) else []
    out: list[dict[str, Any]] = []
    # Сообщества по owner_id постов: у сообщества VK он отрицательный.
    by_owner: dict[int | float, dict[str, Any]] = {}
    for g in groups:
        group_id = parse_number(g.get("id")) if isinstance(g, dict) else None
        if not group_id:
            continue
        screen = g.get("screen_name")
        url = "vk.com/" + (screen if isinstance(screen, str) and screen else f"club{group_id}")
        s = {"key": source_key(url), "name": _text(g.get("name")) or url, "url": f"https://{url}"}
        by_owner[-abs(group_id)] = s
        out.append(s)
    community = root.get("community") if isinstance(root, dict) else None
    community_url = _text(community.get("url")) if isinstance(community, dict) else ""
    if community_url:
        out.append(
            {
                "key": source_key(community_url),
                "name": _text(community.get("name")) or source_key(community_url),
                "url": community_url,
            }
        )
    result: list[dict[str, Any]] = []
    for i, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        text = _text(raw.get("text")) or _text(_first_copy_text(raw.get("copy_history")))
        if not text:
            continue
        owner = parse_number(raw.get("owner_id"))
        post_id = _number_text(raw.get("id"))
        id_ = post_id or f"n{i + 1}"
        src = by_owner.get(owner) if owner is not None else None
        result.append(
            {
                "externalId": f"{owner}_{id_}" if owner is not None else id_,
                "text": text,
                "postedAt": _unix_to_iso(raw.get("date")),
                "postUrl": f"https://vk.com/wall{owner}_{post_id}"
                if owner is not None and post_id is not None
                else None,
                "sourceKey": src["key"] if src is not None else None,
            }
        )
    return {"posts": result, "sources": out}


_BLOCKS = re.compile(r"\n\s*\n")
_HEAD = re.compile(r"^(?:сообщество|группа|канал)\s*[:—-]\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_TEXT_URL = re.compile(r"(?:https?://)?(?:vk\.com|t\.me|ok\.ru)/[a-z0-9_.-]+", re.IGNORECASE)


def _parse_text(content: str) -> dict[str, list[dict[str, Any]]]:
    blocks = [b for b in (b.strip() for b in _BLOCKS.split(content.replace("\r", ""))) if b]
    out: list[dict[str, Any]] = []
    first = blocks[0] if blocks else ""
    head = _HEAD.search(first)
    found = _TEXT_URL.search(first)
    url = found.group(0) if found else None
    # Первый короткий блок с названием или адресом сообщества — заголовок, а не пост.
    if (head or url) and first.count("\n") <= 1 and len(first) < 200:
        blocks.pop(0)
        name = head.group(1) if head else ""
        if url:
            name = name.replace(url, "", 1)
        name = name.strip() or (source_key(url) if url else "")
        if url:
            out.append(
                {
                    "key": source_key(url),
                    "name": name,
                    "url": url if url.startswith("http") else f"https://{url}",
                }
            )
        else:
            out.append({"key": "", "name": name, "url": ""})
    return {
        "posts": [
            {
                "externalId": f"t{normalize(text)[:60]}#{i}",
                "text": text,
                "postedAt": None,
                "postUrl": None,
                "sourceKey": None,
            }
            for i, text in enumerate(blocks)
        ],
        "sources": out,
    }


# ---------- Черновик из поста ----------


def _context_at(
    sports: list[Entity], districts: list[Entity], now: datetime, posted_at: str | None
) -> dict[str, Any]:
    """Контекст помощника: свежий пост разбирается так, будто сейчас — момент публикации."""
    at = clock.parse(posted_at)
    if at is None or at >= now or (now - at).days > RELATIVE_DAYS:
        at = now
    return {"sports": sports, "districts": districts, "now": at}


def draft_from_post(text: str, ctx: dict[str, Any]) -> Entity:
    """Разбор поста тем же помощником, что и «Создать с помощником»."""
    res = assistant.draft_event(text, ctx)
    d = res["draft"]
    assisted: dict[str, str] = {}

    def why(field: str) -> str | None:
        return next((f.get("why") for f in res["filled"] if f["field"] == field), None)

    def mark(field: str, from_: list[str]) -> None:
        reason = next((w for f in from_ if (w := why(f))), None)
        if reason:
            assisted[field] = reason

    mark("title", ["title"])
    mark("sportId", ["sportId", "newSportName"])
    mark("startsAt", ["startsAt"])
    mark("place", ["place"])
    mark("price", ["price"])
    mark("capacity", ["capacity", "minParticipants"])
    mark("level", ["level", "beginnersWelcome"])
    has_sport = bool(d.get("sportId") or d.get("newSportName"))
    missing = {m["field"] for m in res["missing"]}
    has_time = bool(d.get("startsAt")) or "time" not in missing

    # Поля, которых помощник не нашёл, в черновик не попадают.
    draft: Entity = {}
    if d.get("title") is not None:
        draft["title"] = d["title"]
    draft["description"] = text
    if d.get("sportId"):
        draft["sportId"] = d["sportId"]
    elif d.get("newSportName") is not None:
        draft["newSportName"] = d["newSportName"]
    if d.get("startsAt") is not None:
        draft["startsAt"] = d["startsAt"]
    draft["durationMin"] = 90
    place = d.get("place")
    if place is not None and place.get("address"):
        draft["place"] = {"address": place["address"], "districtId": place.get("districtId")}
        for key in ("lat", "lng"):
            if place.get(key) is not None:
                draft["place"][key] = place[key]
    draft["price"] = {"kind": "free"} if d.get("price") is None else d["price"]
    draft["capacity"] = d.get("capacity")
    draft["level"] = "any" if d.get("level") is None else d["level"]
    draft["beginnersWelcome"] = (
        d.get("level") in (None, "", "any", "beginner")
        if d.get("beginnersWelcome") is None
        else d["beginnersWelcome"]
    )
    return {"draft": draft, "assisted": assisted, "meeting": has_sport and has_time}


def _place_address(place: Any) -> Any:
    return place.get("address") if isinstance(place, dict) else None


def _problems_of(p: Entity, now: datetime) -> list[Entity]:
    d = p["draft"]
    out: list[Entity] = []
    if len(_text(d.get("title"))) < 5:
        out.append({"field": "title", "text": "Напишите название, хотя бы 5 букв"})
    if not d.get("sportId") and not _text(d.get("newSportName")):
        out.append({"field": "sportId", "text": "Выберите направление"})
    if not d.get("startsAt"):
        out.append({"field": "startsAt", "text": "Укажите дату и время"})
    elif (starts := clock.parse(d["startsAt"])) is not None and starts < now + timedelta(minutes=10):
        out.append({"field": "startsAt", "text": "Дата уже прошла: проверьте по посту, когда встреча"})
    if len(_text(_place_address(d.get("place")))) < 3:
        out.append({"field": "place", "text": "Укажите место"})
    if d.get("coverUrl") and not valid_event_image(d["coverUrl"]):
        out.append(
            {"field": "coverUrl", "text": "Обложка не подошла: нужен HTTPS-адрес или фото JPEG, PNG, WebP"}
        )
    out.extend(_series_problems(d, now))
    return out


def _series_problems(d: Entity, now: datetime) -> list[Entity]:
    """Повтор каждую неделю (`repeatWeeklyUntil`) и другие дни недели того же расписания (`extraStarts`)."""
    out: list[Entity] = []
    starts = clock.parse(d.get("startsAt"))
    extra = d.get("extraStarts") or []
    if not isinstance(extra, list) or len(extra) > MAX_EXTRA_STARTS:
        return [{"field": "series", "text": f"Других дней недели может быть до {MAX_EXTRA_STARTS}"}]
    moments = [clock.parse(x) for x in extra]
    if any(m is None or m < now + timedelta(minutes=10) for m in moments):
        out.append({"field": "series", "text": "Другие дни расписания должны быть в будущем"})
    if not d.get("repeatWeeklyUntil"):
        return out
    until = clock.parse(d["repeatWeeklyUntil"])
    first = [m for m in [starts, *moments] if m is not None]
    if until is None:
        out.append({"field": "series", "text": "Укажите, до какого дня повторять встречу"})
    elif any(until <= m for m in first):
        out.append({"field": "series", "text": "Повторы должны заканчиваться позже первой встречи"})
    elif any(until - m > timedelta(weeks=MAX_SERIES_WEEKS) for m in first):
        out.append({"field": "series", "text": f"Повторять можно не дольше {MAX_SERIES_WEEKS} недель"})
    return out


# ---------- Представления ----------


def _post_view(d: "Domain", p: Entity) -> Entity:
    src = next((s for s in _sources() if s["id"] == p["sourceId"]), None)
    now = clock.now()
    event = db().record("events", p["eventId"]) if p.get("eventId") else None
    place = p["draft"].get("place")
    district_id = place.get("districtId") if isinstance(place, dict) else None
    district = (
        next((x for x in db().districts if x["id"] == district_id), None) if district_id is not None else None
    )
    posted = clock.parse(p.get("postedAt"))
    return {
        **p,
        "source": {
            "id": p["sourceId"],
            "name": src["name"] if src is not None else "Сообщество",
            "url": src["url"] if src is not None else "",
        },
        "sport": d.sport_view(p["draft"]["sportId"]) if p["draft"].get("sportId") else None,
        "districtName": district["name"] if district is not None else None,
        "problems": _problems_of(p, now),
        "stale": posted is not None and (now - posted).days > STALE_DAYS,
        "event": {"id": event["id"], "title": event["title"]} if event is not None else None,
    }


def _flag(value: Any) -> bool | None:
    """Фильтр «да/нет» из запроса: true/false или строка «true»/«false»; иначе фильтра нет."""
    if isinstance(value, bool):
        return value
    return {"true": True, "false": False}.get(value) if isinstance(value, str) else None


def list_imports(d: "Domain", actor: Actor, q: dict[str, Any]) -> list[Entity]:
    reports.require_admin(actor)
    status = "draft" if q.get("status") is None else q["status"]
    meeting = _flag(q.get("meeting"))
    rows = [
        p
        for p in _posts()
        if (status == "all" or p["status"] == status)
        and (not q.get("sourceId") or p["sourceId"] == q["sourceId"])
        and (meeting is None or bool(p["meeting"]) == meeting)
    ]
    # Сначала встречи, внутри — свежие посты выше.
    rows.sort(key=lambda p: clock.parse(p.get("postedAt") or p["importedAt"]), reverse=True)
    rows.sort(key=lambda p: not p["meeting"])
    return [_post_view(d, p) for p in rows]


def import_details(d: "Domain", actor: Actor, id_: ID) -> Entity:
    reports.require_admin(actor)
    return _post_view(d, _get_post(id_))


def _get_post(id_: ID) -> Entity:
    found = next((p for p in _posts() if p["id"] == id_), None)
    return (
        found if found is not None else fail("not_found", "Черновик не найден. Возможно, его уже разобрали")
    )


def _claims_of(s: Entity) -> list[Entity]:
    key = source_key(s["url"])
    return [
        {
            "orgId": o["id"],
            "name": o["name"],
            "status": o["status"],
            "approved": o["status"] == "approved" and o.get("suspension") is None,
        }
        for o in db().organizations
        if o["id"] != s.get("orgId") and key and key in source_key(o["contacts"].get("social") or "")
    ]


def list_sources(actor: Actor) -> list[Entity]:
    reports.require_admin(actor)

    def view(s: Entity) -> Entity:
        mine = [p for p in _posts() if p["sourceId"] == s["id"]]
        target = next((o for o in db().organizations if o["id"] == s.get("transferredTo")), None)
        return {
            **s,
            "posts": len(mine),
            "published": sum(1 for p in mine if p["status"] == "published"),
            "drafts": sum(1 for p in mine if p["status"] == "draft"),
            "claims": _claims_of(s),
            "transferredName": target["name"] if target is not None else None,
        }

    return [view(s) for s in _sources()]


# ---------- Загрузка ----------


def _ensure_source(raw: dict[str, Any]) -> Entity:
    key = source_key(raw["url"])
    found = next(
        (
            s
            for s in _sources()
            if (key and source_key(s["url"]) == key) or (not key and s["name"] == raw["name"])
        ),
        None,
    )
    if found is not None:
        if raw["name"] and found["name"].startswith("vk.com/"):
            found["name"] = raw["name"]
        return found
    s = {
        "id": store.next_id("src"),
        "name": raw["name"] or key,
        "url": raw["url"],
        "orgId": None,
        "transferredTo": None,
        "transferredAt": None,
        "createdAt": clock.iso(clock.now()),
    }
    _sources().append(s)
    return s


def _shift_to_now(posts: list[dict[str, Any]], now: datetime) -> None:
    """Даты примера сдвигаются так, чтобы последний пост был сегодня: иначе все посты — «старые»."""
    dated = [(p, at) for p in posts if (at := clock.parse(p["postedAt"])) is not None]
    if not dated:
        return
    shift = now - timedelta(hours=2) - max(at for _, at in dated)
    for p, at in dated:
        p["postedAt"] = clock.iso(at + shift)


def upload_import(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:  # noqa: ARG001  d — общий вид обработчиков модуля
    reports.require_admin(actor)
    content = input_.get("content")
    # Выгрузка может начинаться с метки порядка байтов (BOM).
    content = content.removeprefix("﻿") if isinstance(content, str) else ""
    if not content.strip():
        fail("validation", "Файл пустой. Выберите выгрузку с постами", {"file": "Файл пустой"})
    if len(content) > MAX_FILE:
        fail("validation", "Файл больше 1 МБ. Разделите выгрузку на части", {"file": "Слишком большой файл"})
    user_url = _text(input_.get("sourceUrl"))
    if user_url and not _valid_source_url(user_url):
        fail(
            "validation",
            "Адрес сообщества должен быть вида vk.com/название",
            {"sourceUrl": "Пример: vk.com/club242415813"},
        )

    is_json = content.lstrip().startswith(("[", "{"))
    parsed = _parse_json(content) if is_json else _parse_text(content)
    if not parsed["posts"]:
        fail(
            "validation",
            "В файле не нашлось постов с текстом. Нужна выгрузка стены: список постов с полями text и date"
            if is_json
            else "В файле не нашлось постов. Разделяйте посты пустой строкой",
            {"file": "Постов не найдено"},
        )
    if len(parsed["posts"]) > MAX_POSTS:
        fail(
            "validation",
            f"В одном файле можно загрузить до {MAX_POSTS} постов",
            {"file": "Слишком много постов"},
        )

    now = clock.now()
    if input_.get("example"):
        _shift_to_now(parsed["posts"], now)

    fallback = (
        {
            "key": source_key(user_url),
            "name": _text(input_.get("sourceName")) or source_key(user_url),
            "url": f"https://{source_key(user_url)}",
        }
        if user_url
        else (parsed["sources"][0] if parsed["sources"] else None)
    )
    if fallback is None and any(not p["sourceKey"] for p in parsed["posts"]):
        fail(
            "validation",
            "Укажите адрес сообщества: в файле его нет",
            {"sourceUrl": "Например, vk.com/club242415813"},
        )

    result: Entity = {"added": 0, "duplicates": 0, "notMeeting": 0, "skipped": 0, "ids": []}
    for raw in parsed["posts"]:
        rs = (
            next((s for s in parsed["sources"] if s["key"] == raw["sourceKey"]), None)
            if raw["sourceKey"]
            else None
        ) or fallback
        source = _ensure_source(rs)
        text = scrub_text(raw["text"])
        if len(text) < 10:
            result["skipped"] += 1
            continue
        external_id = raw["externalId"] if raw["postUrl"] else f"{source['id']}:{normalize(text)[:80]}"
        if any(p["sourceId"] == source["id"] and p["externalId"] == external_id for p in _posts()):
            result["duplicates"] += 1
            continue
        parsed_draft = draft_from_post(text, _context_at(db().sports, db().districts, now, raw["postedAt"]))
        post = {
            "id": store.next_id("imp"),
            "sourceId": source["id"],
            "externalId": external_id,
            "postUrl": raw["postUrl"] or source["url"],
            "text": text,
            "postedAt": raw["postedAt"],
            "importedAt": clock.iso(now),
            "status": "draft",
            **parsed_draft,
            "eventId": None,
            "rejectReason": "",
            "decidedBy": None,
            "decidedAt": None,
        }
        _posts().append(post)
        result["added"] += 1
        result["ids"].append(post["id"])
        if not post["meeting"]:
            result["notMeeting"] += 1
    commit(["imports", "admin"])
    return result


# ---------- Правка, публикация, отклонение ----------

FIELD_KEYS: dict[str, list[str]] = {
    "title": ["title"],
    "description": ["description"],
    "sportId": ["sportId", "newSportName"],
    "startsAt": ["startsAt", "durationMin"],
    "place": ["place"],
    "price": ["price"],
    "capacity": ["capacity"],
    "level": ["level", "beginnersWelcome"],
    "coverUrl": ["coverUrl"],
    "series": ["repeatWeeklyUntil", "extraStarts"],
}
TEXT_LIMITS = {"title": 90, "description": MAX_TEXT}


def _apply_patch(p: Entity, patch: dict[str, Any]) -> None:
    draft = p["draft"]
    nxt = {**draft}
    for field, keys in FIELD_KEYS.items():
        touched = [k for k in keys if k in patch]
        if not touched:
            continue
        # Поле, которое администратор изменил, больше не помечается как заполненное помощником.
        if any(k not in draft or patch[k] != draft[k] for k in touched):
            p["assisted"].pop(field, None)
        for k in touched:
            nxt[k] = patch[k]
    if patch.get("sportId"):
        nxt.pop("newSportName", None)
    for key, limit in TEXT_LIMITS.items():
        if key in nxt:
            nxt[key] = (nxt[key] if isinstance(nxt[key], str) else "")[:limit]
    p["draft"] = nxt


def save_import(d: "Domain", actor: Actor, id_: ID, patch: dict[str, Any] | None) -> Entity:
    reports.require_admin(actor)
    p = _get_post(id_)
    if p["status"] != "draft":
        fail("already_decided", "Этот пост уже разобран")
    _apply_patch(p, patch or {})
    commit(["imports"])
    return _post_view(d, p)


def _service_user() -> Entity:
    users = db().users
    u = next((x for x in users if x["id"] == SERVICE_USER_ID), None)
    if u is None:
        u = {
            "id": SERVICE_USER_ID,
            "name": "Служба импорта",
            "avatarUrl": None,
            "age": None,
            "role": "user",
            "city": "Красноярск",
            "districtId": None,
            "about": "Публикует встречи из открытых постов сообществ. Пишет администратор платформы.",
            "interests": [],
            "levels": {},
            "readiness": None,
            "home": None,
            "radiusKm": 5,
            "email": "",
            "phone": "",
            "demo": None,
            "createdAt": clock.iso(clock.now()),
        }
        users.append(u)
    return u


_COMMUNITY_PREFIX = re.compile(r"^сообщество\s+", re.IGNORECASE)
_IN_QUOTES = re.compile(r"«(.*)»")


def _bare_name(name: str) -> str:
    """«Сообщество «Бегуны»» → «Бегуны»."""
    name = _COMMUNITY_PREFIX.sub("", name, count=1)
    quoted = _IN_QUOTES.fullmatch(name)
    return quoted.group(1) if quoted else name


def _source_org(
    s: Entity, sport_id: ID | None, district_id: ID | None, place: dict[str, Any] | None = None
) -> Entity:
    existing = (
        next((o for o in db().organizations if o["id"] == s["orgId"]), None) if s.get("orgId") else None
    )
    owner = _service_user()
    if existing is not None:
        if sport_id and sport_id not in existing["sportIds"]:
            existing["sportIds"].append(sport_id)
        return existing
    at = clock.iso(clock.now())
    bare = _bare_name(s["name"])
    o = {
        "id": store.next_id("o"),
        "name": f"Сообщество «{bare}» (импорт)",
        "type": "initiative",
        "description": f"Встречи из открытых постов сообщества «{bare}». Страницу ведёт администратор платформы, пока сообщество не заберёт её себе. Источник: {s['url']}",
        "sportIds": [sport_id] if sport_id else [],
        "city": city_of_place(place)["name"],
        "districtId": district_id,
        "address": "",
        "contacts": {"phone": "", "email": "", "social": s["url"]},
        "logoUrl": None,
        "ownerId": owner["id"],
        "status": "approved",
        "reviews": [
            {"id": store.next_id("rv"), "decision": "approved", "reason": "", "adminId": None, "at": at}
        ],
        "createdWithAssistant": True,
        "aiFlag": "none",
        "aiReason": "",
        "createdAt": at,
        "updatedAt": at,
    }
    db().organizations.append(o)
    s["orgId"] = o["id"]
    return o


def publish_import(d: "Domain", actor: Actor, id_: ID, patch: dict[str, Any] | None = None) -> Entity:
    admin = reports.require_admin(actor)
    p = _get_post(id_)
    if p["status"] == "published" and p.get("eventId"):
        return {"eventId": p["eventId"], "post": _post_view(d, p)}
    if p["status"] != "draft":
        fail("already_decided", "Этот пост уже отклонён. Верните его в очередь, чтобы опубликовать")
    _apply_patch(p, patch or {})
    problems = _problems_of(p, clock.now())
    if problems:
        fail(
            "validation", "Заполните недостающее перед публикацией", {x["field"]: x["text"] for x in problems}
        )
    s = next((x for x in _sources() if x["id"] == p["sourceId"]), None)
    if s is None:
        fail("not_found", "Сообщество не найдено")
    if s.get("transferredTo"):
        fail("bad_state", "Сообщество уже забрало страницу: встречи публикует оно само")
    dr = p["draft"]
    org = _source_org(s, dr.get("sportId"), dr["place"].get("districtId"), dr["place"])
    owner = _service_user()
    event: Entity = {
        "title": dr["title"],
        "description": f"{dr['description']}\n\nИсточник: пост сообщества «{s['name']}», {p['postUrl']}",
    }
    if dr.get("sportId"):
        event["sportId"] = dr["sportId"]
    elif dr.get("newSportName") is not None:
        event["newSportName"] = dr["newSportName"]
    event.update(
        {
            "confirmNew": True,
            "orgId": org["id"],
            "startsAt": dr["startsAt"],
            "durationMin": dr.get("durationMin") or 90,
            "place": dr["place"],
            "level": "any" if dr.get("level") is None else dr["level"],
            "beginnersWelcome": True if dr.get("beginnersWelcome") is None else dr["beginnersWelcome"],
            "firstStep": {},
            "price": {"kind": "free"} if dr.get("price") is None else dr["price"],
            "cancelPolicy": {"kind": "anytime"},
            # Заявки разбирать некому, пока сообщество не заберёт страницу
            "joinMode": "open",
            "capacity": dr.get("capacity"),
            "minParticipants": None,
            "createdWithAssistant": True,
            "idempotencyKey": f"import-{p['id']}",
        }
    )
    if dr.get("coverUrl"):
        event["coverUrl"] = dr["coverUrl"]
    if dr.get("repeatWeeklyUntil"):
        event["repeatWeeklyUntil"] = dr["repeatWeeklyUntil"]
    created = d.create_event(owner, event)
    ids = _series_ids(created)
    # Расписание на несколько дней недели: у каждого дня своя серия «каждую неделю».
    for i, starts_at in enumerate(dr.get("extraStarts") or []):
        more = d.create_event(
            owner, {**event, "startsAt": starts_at, "idempotencyKey": f"import-{p['id']}-{i + 1}"}
        )
        ids.extend(x for x in _series_ids(more) if x not in ids)
    p["status"] = "published"
    p["eventId"] = created["id"]
    if len(ids) > 1:
        # Все встречи из поста: плашка «из сообщества» на каждой, а не только на первой.
        p["draft"] = {**dr, "eventIds": ids}
    p["decidedBy"] = admin["id"]
    p["decidedAt"] = clock.iso(clock.now())
    if dr.get("sportId") and created["sportId"] not in org["sportIds"]:
        org["sportIds"].append(created["sportId"])
    reports.audit_log(
        d,
        admin,
        "import.publish",
        "event",
        created["id"],
        created["title"],
        f"Из сообщества «{s['name']}»: {p['postUrl']}",
    )
    commit(["imports", "events", "organizations", "audit", "admin"], ids)
    return {"eventId": created["id"], "eventIds": ids, "post": _post_view(d, p)}


def _series_ids(created: Entity) -> list[ID]:
    """Все встречи, созданные одним запросом: первая и её повторы."""
    series = created.get("series")
    if not series:
        return [created["id"]]
    return [
        e["id"]
        for e in sorted(db().records("events", COLLECTIONS["events"].table.c.series["id"].astext == series["id"],
                                    predicate=lambda e: (e.get("series") or {}).get("id") == series["id"]), key=lambda x: x["startsAt"])
        if (e.get("series") or {}).get("id") == series["id"]
    ]


def _post_of_event(event_id: ID) -> Entity | None:
    return next(
        (
            x
            for x in _posts()
            if x.get("eventId") == event_id or event_id in (x["draft"].get("eventIds") or [])
        ),
        None,
    )


def reject_import(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = reports.require_admin(actor)
    p = _get_post(id_)
    if p["status"] == "rejected":
        return _post_view(d, p)
    if p["status"] != "draft":
        fail("already_decided", "Этот пост уже опубликован")
    p["status"] = "rejected"
    p["rejectReason"] = _text(input_.get("reason"))[:300] or (
        "Не подходит для платформы" if p["meeting"] else "Не похоже на встречу"
    )
    p["decidedBy"] = admin["id"]
    p["decidedAt"] = clock.iso(clock.now())
    src = next((s for s in _sources() if s["id"] == p["sourceId"]), None)
    reports.audit_log(
        d,
        admin,
        "import.reject",
        "import",
        p["id"],
        f"Пост сообщества «{src['name'] if src is not None else ''}»",
        p["rejectReason"],
    )
    commit(["imports", "audit", "admin"])
    return _post_view(d, p)


def restore_import(d: "Domain", actor: Actor, id_: ID) -> Entity:
    reports.require_admin(actor)
    p = _get_post(id_)
    if p["status"] != "rejected":
        fail("bad_state", "Вернуть в очередь можно только отклонённый пост")
    p["status"] = "draft"
    p["rejectReason"] = ""
    p["decidedAt"] = None
    p["decidedBy"] = None
    commit(["imports", "admin"])
    return _post_view(d, p)


def update_source(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    """Логотип и описание страницы сообщества (служебной организации), пока её не забрали."""
    admin = reports.require_admin(actor)
    s = next((x for x in _sources() if x["id"] == id_), None)
    if s is None:
        fail("not_found", "Сообщество не найдено")
    if s.get("transferredTo"):
        fail("bad_state", "Сообщество уже забрало страницу и оформляет её само")
    o = next((x for x in db().organizations if x["id"] == s.get("orgId")), None)
    if o is None:
        fail("bad_state", "Страница сообщества появится после первой опубликованной встречи")
    errors: dict[str, str] = {}
    logo = input_.get("logoUrl")
    if "logoUrl" in input_ and logo not in (None, "") and not valid_org_logo(logo):
        errors["logoUrl"] = "Логотип не подошёл: нужен HTTPS-адрес или картинка JPEG, PNG, WebP"
    about = _text(input_.get("about"))
    if "about" in input_ and len(about) < 30:
        errors["about"] = "Расскажите о сообществе хотя бы в 30 знаках"
    if errors:
        fail("validation", "Проверьте поля", errors)
    if "logoUrl" in input_:
        o["logoUrl"] = logo or None
    if "about" in input_:
        o["description"] = (
            f"{about[:MAX_ABOUT]}\n\nВстречи взяты из открытых постов сообщества. Страницу ведёт "
            f"администратор платформы, пока сообщество не заберёт её себе. Источник: {s['url']}"
        )
    o["updatedAt"] = clock.iso(clock.now())
    reports.audit_log(d, admin, "import.source", "org", o["id"], o["name"], f"Сообщество {s['url']}")
    commit(["imports", "organizations", "audit", "admin"])
    return {"orgId": o["id"], "logoUrl": o["logoUrl"], "description": o["description"]}


def transfer_source(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    """Сообщество забрало страницу: встречи переходят его допущенной организации."""
    admin = reports.require_admin(actor)
    s = next((x for x in _sources() if x["id"] == id_), None)
    if s is None:
        fail("not_found", "Сообщество не найдено")
    if s.get("transferredTo"):
        fail("already_decided", "Страница уже передана")
    claim = next((c for c in _claims_of(s) if c["orgId"] == input_.get("orgId")), None)
    if claim is None:
        fail(
            "forbidden", "Передать можно только организации, которая указала адрес этого сообщества в заявке"
        )
    if not claim["approved"]:
        fail("org_not_approved", "Сначала рассмотрите заявку организации: передать можно только допущенной")
    target = next(o for o in db().organizations if o["id"] == claim["orgId"])
    moved = d._organizer_events_for_read({"kind": "org", "id": s["orgId"]}) if s.get("orgId") else []
    at = clock.iso(clock.now())
    for e in moved:
        e["organizer"] = {"kind": "org", "id": target["id"]}
        e["createdBy"] = target["ownerId"]
        e["updatedAt"] = at
    s["transferredTo"] = target["id"]
    s["transferredAt"] = at
    service = next((o for o in db().organizations if o["id"] == s.get("orgId")), None)
    if service is not None:
        service["description"] = f"Сообщество забрало страницу. Встречи теперь публикует «{target['name']}»."
    notify(
        d,
        [target["ownerId"]],
        "import_transferred",
        "Встречи сообщества теперь ваши",
        f"Администратор передал «{target['name']}» встречи, собранные из постов сообщества: {len(moved)}. Записавшиеся остаются, заявки и вопросы приходят вам.",
        f"/org/{target['id']}",
    )
    reports.audit_log(
        d,
        admin,
        "import.transfer",
        "org",
        target["id"],
        target["name"],
        f"Сообщество {s['url']}, встреч: {len(moved)}",
    )
    commit(
        ["imports", "events", "organizations", "notifications", "audit", "admin"], [e["id"] for e in moved]
    )
    return {"moved": len(moved)}


def event_source(event_id: ID) -> Entity | None:
    """Плашка на карточке события: из какого поста встреча. Публично, без данных автора."""
    p = _post_of_event(event_id)
    if p is None:
        return None
    s = next((x for x in _sources() if x["id"] == p["sourceId"]), None)
    if s is None:
        return None
    e = db().record("events", event_id)
    bare = _COMMUNITY_PREFIX.sub("", s["name"], count=1)
    example = f"проводим встречи, например «{e['title']}». " if e is not None and e.get("title") else ""
    return {
        "sourceId": s["id"],
        "name": s["name"],
        "url": s["url"],
        "postUrl": p["postUrl"],
        "orgId": s.get("transferredTo") or s.get("orgId"),
        "transferred": bool(s.get("transferredTo")),
        "claim": {
            "name": bare,
            "description": f"Сообщество «{bare}»: {example}Расскажите, чем вы занимаетесь, для кого и как часто.",
            "sportIds": [e["sportId"]] if e is not None else [],
            "social": s["url"],
            "districtId": e["place"].get("districtId") if e is not None else None,
        },
    }


# ---------- Демо-данные ----------

DEMO_GROUPS: list[Entity] = [
    {"id": 242415813, "name": "Спорт и точка — Красноярск", "screen_name": "club242415813"},
    {"id": 218400101, "name": "Дворовый футбол Взлётка", "screen_name": "futbol_vzletka"},
    {"id": 218400102, "name": "Скандинавская ходьба Академгородок", "screen_name": "nordic_akadem"},
    {"id": 218400103, "name": "Шахматы в библиотеке им. Горького", "screen_name": "chess_gorky_lib"},
]

# Четыре поста уже в очереди после сброса демо-данных; те же посты есть в файле-примере.
SEED_POSTS: list[Entity] = [
    {
        "group": 218400101,
        "id": 412,
        "hoursAgo": 20,
        "text": "В субботу в 11:00 играем в футбол во дворе на Взлётной, 7 (коробка за школой). Нужно ещё 4 человека, уровень любой. Бесплатно, мяч есть. Пишите в комментариях, если идёте.",
    },
    {
        "group": 218400102,
        "id": 1290,
        "hoursAgo": 30,
        "text": "Скандинавская ходьба для всех возрастов: в четверг в 10:00 у входа в парк в Академгородке, Академгородок, 50. Палки дадим, если своих нет. Новичкам рады, темп спокойный.",
    },
    {
        "group": 218400103,
        "id": 77,
        "hoursAgo": 8,
        "text": "Шахматы в библиотеке им. Горького: в среду в 17:00 быстрые партии для всех желающих, ул. Карла Маркса, 114. Доски и часы есть. Вход свободный, приходите с друзьями.",
    },
    {
        "group": 218400101,
        "id": 409,
        "hoursAgo": 50,
        "text": "Ребята, спасибо всем за сезон! Фото с прошлой игры уже в альбоме группы. Отдельное спасибо Сергею за новые ворота.",
    },
]


def seed_imports(input_: dict[str, Any]) -> dict[str, list[Entity]]:
    """Очередь постов после сброса демо-данных. `input_`: sports, districts, now (мс эпохи)."""
    now = input_["now"]
    at = clock.iso(now)
    community_sources = [
        {
            "id": f"src-{i + 1}",
            "name": g["name"],
            "url": f"https://vk.com/{g['screen_name']}",
            "orgId": None,
            "transferredTo": None,
            "transferredAt": None,
            "createdAt": at,
        }
        for i, g in enumerate(DEMO_GROUPS[1:])
    ]

    def post(i: int, s: Entity) -> Entity:
        gi = next((j for j, g in enumerate(DEMO_GROUPS) if g["id"] == s["group"]), -1)
        posted_at = clock.iso(now - timedelta(hours=s["hoursAgo"]))
        text = scrub_text(s["text"])
        return {
            "id": f"imp-{i + 1}",
            "sourceId": f"src-{gi}",
            "externalId": f"-{s['group']}_{s['id']}",
            "postUrl": f"https://vk.com/wall-{s['group']}_{s['id']}",
            "text": text,
            "postedAt": posted_at,
            "importedAt": clock.iso(now - timedelta(hours=3)),
            "status": "draft",
            **draft_from_post(text, _context_at(input_["sports"], input_["districts"], now, posted_at)),
            "eventId": None,
            "rejectReason": "",
            "decidedBy": None,
            "decidedAt": None,
        }

    return {
        "communitySources": community_sources,
        "importedPosts": [post(i, s) for i, s in enumerate(SEED_POSTS)],
    }
