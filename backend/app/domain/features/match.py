"""В2. Короткий диалог подбора.

Фраза → фильтры → 2–3 реальных события с объяснением, уточнение кнопками, расширение условий,
если подходящих мало, и «Ищу компанию», если нет совсем. Ответ строится из тех же данных и прав,
что и лента: записаться можно только туда, куда пустит обычная запись. Работает на правилах;
модель заменит только разбор фразы.
"""

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING, Any


from app.domain import assistant, clock, core
from app.domain.errors import fail
from app.domain.features import demand, greeter
from app.domain.features.kit import db
from app.domain.lib import dates
from app.domain.lib.cities import city_by_id, city_by_name, default_city, point_in_city
from app.domain.lib.dates import format_event_date
from app.domain.lib.geo import format_distance
from app.domain.lib.labels import EVENT_LEVEL
from app.domain.lib.money import format_rub
from app.domain.lib.numbers import NBSP, format_number, parse_number
from app.domain.lib.plural import WORDS, count, plural
from app.domain.lib.text import capitalize
from app.domain.statuses import ACTIVE_PARTICIPATION
from app.domain.schema import COLLECTIONS
from app.domain.text import query_words, stem_ru
from app.domain.types import Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

# Шаг диалога (`MatchStep`): { id, patch: { set?, drop? } }; вход (`MatchInput`): { text, steps?, cityId? }.
MatchFilters = dict[str, Any]
MatchPatch = dict[str, Any]

SHOWN = 3
MAX_QUESTIONS = 2
DISTRICT_RADIUS = 3
RADIUS_STEPS = [3, 6, 10]


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _is_text_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(x, str) for x in value)


# Поля фильтров, которые может менять шаг диалога, и какие значения у них допустимы.
FILTER_TYPES: dict[str, Any] = {
    "q": lambda v: isinstance(v, str),
    "sportIds": _is_text_list,
    "when": lambda v: isinstance(v, str),
    "date": lambda v: isinstance(v, str),
    "dayPart": lambda v: isinstance(v, str),
    "level": lambda v: isinstance(v, str),
    "beginners": lambda v: isinstance(v, bool),
    "free": lambda v: isinstance(v, bool),
    "priceMax": _is_number,
    "joinMode": lambda v: isinstance(v, str),
    "near": lambda v: isinstance(v, bool),
    "radiusKm": _is_number,
    "districtId": lambda v: isinstance(v, str),
    "aroundDistrictId": lambda v: isinstance(v, str),
}

WHEN_LABEL = {"today": "сегодня", "tomorrow": "завтра", "weekend": "на выходных", "week": "на этой неделе"}
PART_LABEL = {"morning": "утром", "day": "днём", "evening": "вечером"}


def _clean_patch(patch: Any) -> MatchPatch:
    """Шаг приходит от клиента: берём только известные поля со значениями подходящего типа."""
    patch = patch if isinstance(patch, dict) else {}
    raw_set = patch.get("set")
    raw_drop = patch.get("drop")
    set_ = (
        {k: v for k, v in raw_set.items() if k in FILTER_TYPES and FILTER_TYPES[k](v)}
        if isinstance(raw_set, dict)
        else {}
    )
    drop = (
        [k for k in raw_drop if isinstance(k, str) and k in FILTER_TYPES]
        if isinstance(raw_drop, list)
        else []
    )
    return {"set": set_, "drop": drop}


def apply_patch(f: MatchFilters, patch: MatchPatch) -> MatchFilters:
    next_: MatchFilters = {**f, **(patch.get("set") or {})}
    for k in patch.get("drop") or []:
        next_.pop(k, None)
    if next_.get("when") != "date":
        next_.pop("date", None)
    return next_


def _district_point(id_: str | None) -> dict[str, float] | None:
    x = next((r for r in db().districts if r["id"] == id_), None) if id_ else None
    return {"lat": x["lat"], "lng": x["lng"]} if x else None


def _home_point(actor: Actor) -> dict[str, float] | None:
    if not actor:
        return None
    home = actor.get("home")
    return home if home is not None else _district_point(actor.get("districtId"))


def _radius(f: MatchFilters) -> float:
    radius = f.get("radiusKm")
    return DISTRICT_RADIUS if radius is None else radius


def filters_from_text(d: "Domain", actor: Actor, text: str) -> Entity:
    """Фильтры из фразы («filters», «nearNeedsHome»). «Недалеко от Взлётки» — это круг вокруг района,
    а не только его границы."""
    parsed = assistant.parse_search(text, d.assistant_context)["filters"]
    f: MatchFilters = {**parsed}
    if f.get("q"):
        generic = {"подбер", "подберит", "найд", "найдит", "встреч", "мероприят", "событ", "занят", "спорт", "спортивн", "тренировк"}
        meaningful = [word for word in query_words(f["q"]) if stem_ru(word) not in generic]
        if meaningful:
            f["q"] = " ".join(meaningful)
        else:
            f.pop("q", None)
    near_needs_home = False
    if f.get("districtId"):
        f["aroundDistrictId"] = f["districtId"]
        f["near"] = True
        f["radiusKm"] = _radius(parsed)
        del f["districtId"]
    elif f.get("near"):
        if _home_point(actor):
            # Радиус из фразы, иначе из профиля, иначе 5 км
            profile_radius = parse_number((actor or {}).get("radiusKm"))
            if f.get("radiusKm") is None:
                f["radiusKm"] = 5 if profile_radius is None else profile_radius
        else:
            f.pop("near", None)
            f.pop("radiusKm", None)
            near_needs_home = True
    return {"filters": f, "nearNeedsHome": near_needs_home}


def _to_query(f: MatchFilters) -> dict[str, Any]:
    q: dict[str, Any] = {**{k: v for k, v in f.items() if k != "aroundDistrictId"}, "scope": "feed"}
    point = _district_point(f.get("aroundDistrictId"))
    if point:
        q.update({"near": True, "point": point, "radiusKm": _radius(f)})
    return q


@dataclass(slots=True)
class _Ctx:
    d: "Domain"
    actor: Actor
    city_id: str | None = None
    candidates: dict[tuple[Any, ...], list[Entity]] = field(default_factory=dict)
    previews: dict[str, Entity] = field(default_factory=dict)
    match_context: Entity | None = None
    context_ready: bool = False


def _candidates(c: _Ctx, filters: MatchFilters) -> list[Entity]:
    sports = tuple(c.d._main_sport_id(s) for s in filters.get("sportIds") or [])  # noqa: SLF001
    key = (filters.get("when"), filters.get("date"), sports)
    if key not in c.candidates:
        from app.domain.event_query import _distance_predicate  # noqa: PLC0415

        collection = COLLECTIONS["events"]
        table = collection.table
        city = city_by_id(c.city_id)
        when = core._when_range(filters.get("when"), filters.get("date"))  # noqa: SLF001
        broader = c.candidates.get((None, None, sports))
        if broader is None and sports:
            broader = c.candidates.get((None, None, ()))
        if broader is not None:
            c.candidates[key] = [e for e in broader if (not sports or e["sportId"] in sports)
                and (not when or when[0] <= clock.parse(e["startsAt"]) <= when[1])]
            return c.candidates[key]
        conditions = [table.c.status == "published", table.c.visibility.is_distinct_from("invite"), table.c.starts_at > clock.now()]
        if city:
            conditions.append(_distance_predicate(table.c.place, city))
        if when:
            conditions.append(table.c.starts_at.between(*when))
        if sports:
            conditions.append(table.c.sport_id.in_(sports))
        database = db()
        from app.domain.event_reads import project
        c.candidates[key] = project(
            database, {f.key for f in collection.fields}, *conditions,
            predicate=lambda e: e["status"] == "published" and e.get("visibility") != "invite"
            and c.d.event_state(e) == "upcoming" and (not city or point_in_city(e["place"], city))
            and (not when or when[0] <= clock.parse(e["startsAt"]) <= when[1])
            and (not sports or e["sportId"] in sports),
        )
    return c.candidates[key]


def _preview(c: _Ctx, event: Entity) -> Entity:
    """Eligibility and ranking only; hydrate rich cards solely for the three displayed results."""
    if event["id"] not in c.previews:
        if not c.context_ready:
            c.match_context = c.d._match_for(c.actor)  # noqa: SLF001
            c.context_ready = True
        organizer = c.d.is_organizer(c.actor, event)
        mine = c.d._mine(c.actor, event)  # noqa: SLF001
        explained = assistant.explain_event(event, c.match_context) if c.match_context is not None and not organizer else None
        c.previews[event["id"]] = {
            **event, "state": c.d.event_state(event), "isOrganizer": organizer,
            "can": {"join": c.d.can_join(c.actor, event, mine)["ok"]},
            "counts": c.d._counts(event), "my": mine,  # noqa: SLF001
            "matchScore": explained["score"] if explained else None,
        }
    return c.previews[event["id"]]


def _starts(e: Entity) -> Any:
    return clock.parse(e["startsAt"])


def _in_city(c: _Ctx, f: MatchFilters) -> list[Entity]:
    """События, на которые человек может записаться прямо сейчас (или встать в лист ожидания).

    «Возле района» — всё внутри района плюс то, что в радиусе от его центра.
    """
    city = city_by_id(c.city_id)
    list_ = c.d.list_events(c.actor, _to_query(f), raw=True, candidates=_candidates(c, f))
    if f.get("aroundDistrictId"):
        rest = {k: v for k, v in f.items() if k not in {"aroundDistrictId", "near", "radiusKm"}}
        inside = c.d.list_events(c.actor, {**rest, "scope": "feed", "districtId": f["aroundDistrictId"]}, raw=True, candidates=_candidates(c, rest))
        ids = {e["id"] for e in list_}
        list_ = sorted([*list_, *(e for e in inside if e["id"] not in ids)], key=_starts)
    return [_preview(c, e) for e in list_ if not city or point_in_city(e["place"], city)]


def _find(c: _Ctx, f: MatchFilters) -> list[Entity]:
    """Из серии «каждую неделю» достаточно ближайшей встречи."""
    series: set[str] = set()
    out: list[Entity] = []
    for e in _in_city(c, f):
        can_see = e["can"]["join"] or (c.actor is not None and c.actor["role"] == "admin")
        if not (e["state"] == "upcoming" and not e["isOrganizer"] and can_see):
            continue
        if not e.get("series"):
            out.append(e)
            continue
        if e["series"]["id"] in series:
            continue
        series.add(e["series"]["id"])
        out.append(e)
    return out


def _already_joined(c: _Ctx, f: MatchFilters) -> list[Entity]:
    """Подходящие события, на которые человек уже записан: о них стоит напомнить, а не молчать."""
    if not c.actor:
        return []
    rows = [
        e
        for e in _in_city(c, f)
        if e["state"] == "upcoming" and e.get("my") is not None and e["my"]["status"] in ACTIVE_PARTICIPATION
    ][:3]
    return [{"id": e["id"], "title": e["title"], "startsAt": e["startsAt"]} for e in rows]


def _target(c: _Ctx, f: MatchFilters) -> Entity | None:
    if f.get("aroundDistrictId"):
        point = _district_point(f["aroundDistrictId"])
        name = next((x for x in db().districts if x["id"] == f["aroundDistrictId"]), {}).get("name")
        return {"point": point, "label": f"от центра района {name}"} if point else None
    if f.get("near"):
        point = _home_point(c.actor)
        return {"point": point, "label": "от дома"} if point else None
    return None


def _rank(c: _Ctx, f: MatchFilters, list_: list[Entity]) -> list[Entity]:
    """Сначала есть места, потом выше счёт подбора, ближе (с точностью до километра) и раньше."""
    t = _target(c, f)

    def key(e: Entity) -> tuple[int, float, float, Any]:
        full = 1 if e["capacity"] is not None and e["counts"]["spotsLeft"] == 0 else 0
        score = e["matchScore"] or 0
        km = assistant.km_between(t["point"], e["place"]) if t else 0
        return full, -score, math.inf if km is None else round(km), _starts(e)

    return sorted(list_, key=key)


def _why(c: _Ctx, f: MatchFilters, e: Entity) -> list[str]:
    out: list[str] = []
    if f.get("when") or f.get("dayPart"):
        date = format_event_date(e["startsAt"], clock.now())
        out.append(f"На выходных: {date.lower()}" if f.get("when") == "weekend" else date)
    t = _target(c, f)
    km = assistant.km_between(t["point"], e["place"]) if t else None
    if t and km is not None:
        out.append(f"{format_distance(km)} {t['label']}")
    if f.get("beginners") and (e["beginnersWelcome"] or e["level"] == "beginner"):
        out.append("Рады новичкам")
    elif f.get("level") and e["level"] != "any":
        out.append(f"Уровень: {EVENT_LEVEL[e['level']].lower()}")
    if e["price"]["kind"] == "free":
        out.append("Бесплатно")
    greeter_text = greeter.greeter_reason(e["id"])
    if greeter_text and (f.get("beginners") or len(out) < 3):
        out.append(greeter_text)
    left = e["counts"]["spotsLeft"]
    if left == 0:
        out.append("Мест нет, можно встать в лист ожидания")
    elif left is not None and left <= 3:
        out.append(f"Осталось {count(left, WORDS['place'])}")
    if len(out) < 2:
        out.extend([r for r in e["matchReasons"] if not ("новичк" in r and "Рады новичкам" in out)][:2])
    return list(dict.fromkeys(out))[:4]


def _chosen_day(f: MatchFilters) -> Any:
    """Выбранный день (when = date) в поясе отображения; None, если дня нет или он записан неверно."""
    day = clock.parse(f.get("date")) if f.get("when") == "date" else None
    return clock.local(day) if day else None


def _understood(c: _Ctx, f: MatchFilters) -> list[str]:
    """Как помощник понял запрос — подписи фильтров. Значения, которых он не знает, не показываются."""
    out: list[str | None] = [c.d.sport_view(id_)["name"].lower() for id_ in f.get("sportIds") or []]
    day = _chosen_day(f)
    if day:
        out.append(f"{dates.weekday_name(day)}, {dates.day_month(day)}")
    elif f.get("when") and f["when"] != "date":
        out.append(WHEN_LABEL.get(f["when"]))
    if f.get("dayPart"):
        out.append(PART_LABEL.get(f["dayPart"]))
    if f.get("beginners"):
        out.append("рады новичкам")
    elif f.get("level") and f["level"] != "any":
        level = EVENT_LEVEL.get(f["level"])
        out.append(level.lower() if level else None)
    if f.get("free"):
        out.append("бесплатно")
    elif f.get("priceMax"):
        out.append(f"до {format_rub(f['priceMax'])}")
    if f.get("joinMode") == "open":
        out.append("свободная запись")
    if f.get("joinMode") == "approval":
        out.append("по заявке")
    t = _target(c, f)
    if t:
        out.append(f"до {format_number(_radius(f))}{NBSP}км {t['label']}")
    if f.get("q"):
        out.append(f"«{f['q']}»")
    return [x for x in out if x]


def _events_hint(n: int) -> str:
    return f"{plural(n, ('найдётся', 'найдутся', 'найдётся'))} {count(n, WORDS['event'])}"


def _widen_options(c: _Ctx, f: MatchFilters, total: int) -> list[Entity]:
    """Как ослабить условия, чтобы нашлось больше. Показываем только варианты, которые что-то дают."""
    today = clock.local(clock.now()).date()
    raw: list[Entity] = []
    day = _chosen_day(f)
    if day and day.isoweekday() == 6:
        raw.append(
            {
                "id": "widen:sunday",
                "label": "Посмотреть воскресенье",
                "patch": {"set": {"when": "date", "date": clock.iso(day + timedelta(days=1))}},
            }
        )
    if day and day.isoweekday() == 7 and (day - timedelta(days=1)).date() > today:
        raw.append(
            {
                "id": "widen:saturday",
                "label": "Посмотреть субботу",
                "patch": {"set": {"when": "date", "date": clock.iso(day - timedelta(days=1))}},
            }
        )
    if f.get("when") and f["when"] != "week":
        raw.append(
            {
                "id": "widen:week",
                "label": "Любой день на неделе",
                "patch": {"set": {"when": "week"}, "drop": ["date"]},
            }
        )
    if f.get("dayPart"):
        raw.append({"id": "widen:anytime", "label": "В любое время дня", "patch": {"drop": ["dayPart"]}})
    if f.get("near") and f.get("radiusKm") is not None:
        # Ближайший шаг радиуса, на котором что-то находится, а не просто следующий
        next_ = next(
            (r for r in RADIUS_STEPS if r > f["radiusKm"] and len(_find(c, {**f, "radiusKm": r})) > total),
            None,
        )
        if next_:
            raw.append(
                {
                    "id": "widen:radius",
                    "label": "Дальше от района" if f.get("aroundDistrictId") else "Дальше от дома",
                    "patch": {"set": {"radiusKm": next_}},
                }
            )
    if f.get("free") or f.get("priceMax"):
        raw.append({"id": "widen:price", "label": "Платные тоже", "patch": {"drop": ["free", "priceMax"]}})
    if f.get("level") and not f.get("beginners"):
        raw.append({"id": "widen:level", "label": "Любой уровень", "patch": {"drop": ["level"]}})
    if f.get("joinMode"):
        raw.append({"id": "widen:mode", "label": "Любая запись", "patch": {"drop": ["joinMode"]}})
    if f.get("q"):
        raw.append({"id": "widen:words", "label": f"Без слов «{f['q']}»", "patch": {"drop": ["q"]}})

    out: list[Entity] = []
    for o in raw:
        next_f = apply_patch(f, o["patch"])
        n = len(_find(c, next_f))
        if n <= total:
            continue
        radius = f"до {format_number(next_f['radiusKm'])}{NBSP}км, " if o["id"] == "widen:radius" else ""
        out.append({**o, "hint": f"{radius}{_events_hint(n)}"})
    return out[:3]


def _next_question(c: _Ctx, f: MatchFilters, list_: list[Entity], steps: list[Entity]) -> Entity | None:
    """Одно уточнение за раз, не больше двух за разговор, и только если вариантов много."""
    asked = [s for s in steps if s["id"].startswith("ask:")]
    if len(asked) >= MAX_QUESTIONS or len(list_) <= SHOWN:
        return None

    def was(prefix: str) -> bool:
        return any(s["id"].startswith(prefix) for s in asked)

    def counted(options: list[Entity]) -> list[Entity]:
        out: list[Entity] = []
        for o in options:
            n = len(_find(c, apply_patch(f, o["patch"])))
            if 0 < n < len(list_):
                out.append({**o, "hint": count(n, WORDS["event"])})
        return out

    if not f.get("sportIds") and not was("ask:sport"):
        top = Counter(e["sportId"] for e in list_).most_common(4)
        options = counted(
            [
                {
                    "id": f"ask:sport:{id_}",
                    "label": c.d.sport_view(id_)["name"],
                    "patch": {"set": {"sportIds": [id_]}},
                }
                for id_, _ in top
            ]
        )
        if len(options) > 1:
            return {"id": "ask:sport", "question": "Чем хотите заняться?", "options": options}
    if not f.get("when") and not was("ask:when"):
        options = counted(
            [
                {"id": f"ask:when:{w}", "label": capitalize(WHEN_LABEL[w]), "patch": {"set": {"when": w}}}
                for w in ("today", "tomorrow", "weekend", "week")
            ]
        )
        if len(options) > 1:
            return {"id": "ask:when", "question": "Когда вам удобно?", "options": options}
    if not f.get("dayPart") and not was("ask:part"):
        options = counted(
            [
                {"id": f"ask:part:{p}", "label": capitalize(PART_LABEL[p]), "patch": {"set": {"dayPart": p}}}
                for p in ("morning", "day", "evening")
            ]
        )
        if len(options) > 1:
            return {"id": "ask:part", "question": "В какое время дня?", "options": options}
    return None


def _companion_when(f: MatchFilters) -> str:
    part = PART_LABEL.get(f.get("dayPart"), "")
    if f.get("when") == "weekend":
        return capitalize(f"выходные {part}".strip())
    if f.get("when") == "date" and f.get("date"):
        day = _chosen_day(f)
        return capitalize(f"{'выходные' if day and day.isoweekday() >= 6 else 'будни'} {part}".strip())
    return capitalize(f"будни {part}") if part else "Когда угодно"


def _user_level(actor: Actor, f: MatchFilters) -> str:
    if f.get("beginners"):
        return "beginner"
    if f.get("level") and f["level"] != "any":
        return f["level"]
    sport_ids = f.get("sportIds")
    sport = sport_ids[0] if sport_ids else None
    return (sport and actor and actor["levels"].get(sport)) or "beginner"


def _phrase(value: Any) -> str:
    """Фраза из запроса: строка как есть, число — цифрами, остальное — пусто."""
    if isinstance(value, str):
        return value
    if isinstance(value, int | float) and not isinstance(value, bool):
        return str(value)
    return ""


def match_events(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    text = _phrase(input_.get("text")).strip()[:400]
    if len(text) < 3:
        fail(
            "validation",
            "Напишите, чем и когда хотите заняться",
            {"text": "Например: волейбол в субботу, я новичок"},
        )
    raw_steps = input_.get("steps") if isinstance(input_.get("steps"), list) else []
    steps = [
        {
            "id": s["id"] if isinstance(s, dict) and isinstance(s.get("id"), str) else "",
            "patch": _clean_patch(s.get("patch") if isinstance(s, dict) else None),
        }
        for s in raw_steps[:8]
    ]
    # Без города в запросе (MCP, проверки) — город человека, у гостя — основной город сервиса
    city_id = input_.get("cityId") if isinstance(input_.get("cityId"), str) else None
    if city_id is None:
        own = city_by_name((actor or {}).get("city")) or default_city()
        city_id = own["id"]
    c = _Ctx(d, actor, city_id)

    parsed = filters_from_text(d, actor, text)
    filters: MatchFilters = parsed["filters"]
    for s in steps:
        filters = apply_patch(filters, s["patch"])
    list_ = _rank(c, filters, _find(c, filters))
    total = len(list_)
    question = _next_question(c, filters, list_, steps)
    widen = _widen_options(c, filters, total) if total < SHOWN else []
    sport_ids = filters.get("sportIds")
    sport_id = sport_ids[0] if sport_ids else None
    offer_companion = total <= 1 and (actor or {}).get("role") != "admin"

    joined = _already_joined(c, filters)
    selected = [d._event_for_read(e["id"]) or e for e in list_[:SHOWN]]  # noqa: SLF001
    shown = d.event_views(actor, selected)
    items = [{"event": event, "why": _why(c, filters, event)} for event in shown]
    if total == 0 and not joined:
        demand.record_search_demand(d, actor, filters, _user_level(actor, filters))

    parts: list[str] = []
    if total == 0 and joined:
        titles = ", ".join(f"«{j['title']}»" for j in joined)
        parts.append(f"Вы уже записаны: {titles}. Других подходящих встреч пока нет.")
    elif total == 0:
        parts.append(
            "Точно таких встреч пока нет. Можно немного расширить поиск или найти компанию."
            if widen
            else "Таких встреч пока нет. Напишите объявление «Ищу компанию»: те, кому по пути, откликнутся, а клубы увидят, что есть спрос."
        )
    elif total <= SHOWN:
        parts.append(f"Нашёл {count(total, WORDS['event'])}. Проверьте, подходит ли время и место.")
    else:
        parts.append(
            f"Подходит {count(total, WORDS['event'])}. Показываю {SHOWN} самых подходящих{', а ниже можно уточнить' if question else ''}."
        )
    if parsed["nearNeedsHome"]:
        parts.append("Чтобы искать рядом с домом, войдите или назовите район.")

    district_id = next(
        (
            x
            for x in (
                filters.get("aroundDistrictId"),
                filters.get("districtId"),
                (actor or {}).get("districtId"),
            )
            if x is not None
        ),
        None,
    )
    return {
        "filters": filters,
        "understood": _understood(c, filters),
        "reply": " ".join(parts),
        "items": items,
        "total": total,
        "questions": [question] if question else [],
        "widen": widen,
        "joined": joined,
        "companion": (
            {
                "sportId": sport_id,
                "sportName": d.sport_view(sport_id)["name"] if sport_id else None,
                "districtId": district_id,
                "when": _companion_when(filters),
                "level": _user_level(actor, filters),
                "text": capitalize(text),
            }
            if offer_companion
            else None
        ),
    }
