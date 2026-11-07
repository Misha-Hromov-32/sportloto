"""Точность помощника на правилах по набору фраз assistant_eval_cases.json (см. eval/assistant/README.md).

Разбор фразы поиска, черновики события, «Ищу компанию» и заявки организации, предмодерация и диалог подбора
на демо-данных. Кейс верен целиком, если совпали все проверяемые поля. Название, место и «что взять»
сравниваются по основам слов: засчитывается, если найдено не меньше половины значимых слов эталона
(для места — 60%). Описание и текст объявления не проверяются: они переносятся из фразы как есть.
Уровень `advanced` в наборе — наш `experienced`, «новичок» в поиске — фильтр «Рады новичкам».
«Сегодня» — понедельник 19 октября 2026, 12:00 по Красноярску.

Тест падает, если верных целиком кейсов какого-то вида стало меньше порога. Таблица и промахи печатаются
(видны с `pytest -s`) и попадают в сообщение об ошибке.
"""

import asyncio
import json
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from app.domain import assistant, clock, core, provider, seed
from app.domain.features import match
from app.domain.lib import dates
from app.domain.lib.text import normalize
from app.domain.seed.catalog import DISTRICTS, build_sports
from app.domain.text import stem_ru, words

CASES: list[dict[str, Any]] = json.loads(
    Path(__file__).with_name("assistant_eval_cases.json").read_text("utf-8")
)
NOW = datetime(
    2026, 10, 19, 12, tzinfo=clock.zone_info(clock.DEFAULT_ZONE)
)  # понедельник, 12:00 по Красноярску
SPORTS = build_sports(clock.iso(NOW))
CTX: dict[str, Any] = {"sports": SPORTS, "districts": DISTRICTS, "now": NOW}
DOW = {"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7}

KIND_LABEL = {
    "search": "Поиск фразой (AI-1)",
    "event_draft": "Черновик события (AI-2)",
    "companion_draft": "Черновик «Ищу компанию» (AI-2)",
    "org_draft": "Черновик заявки организации (AI-2)",
    "moderation": "Предмодерация, ловушки (AI-4)",
    "match": "Диалог подбора на демо-данных (В2)",
}
# Сколько кейсов каждого вида должно быть верно целиком. Порог поднимают вместе с улучшениями и не опускают.
PASS_AT_LEAST = {
    "search": 18,
    "event_draft": 20,
    "companion_draft": 4,
    "org_draft": 3,
    "moderation": 5,
    "match": 15,
}

# Проверка поля: (поле, верно ли, эталон, ответ).
Field = tuple[str, bool, Any, Any]


def cases(kind: str) -> list[dict[str, Any]]:
    return [c for c in CASES if c["kind"] == kind]


def same(a: Any, b: Any) -> bool:
    """Строгое равенство: False не равно 0, None — только None."""
    return a == b and isinstance(a, bool) == isinstance(b, bool)


def same_set(a: list[str], b: list[str]) -> bool:
    return len(a) == len(b) and all(x in b for x in a)


def sport_name(id_: str | None) -> str | None:
    return next((s["name"] for s in SPORTS if s["id"] == id_), None)


def district_name(id_: str | None) -> str | None:
    return next((d["name"] for d in DISTRICTS if d["id"] == id_), None)


def same_name(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    x, y = normalize(str(a)), normalize(str(b))
    return x == y or (min(len(x), len(y)) >= 5 and (x.startswith(y) or y.startswith(x)))


def stems(text: str) -> list[str]:
    return [stem_ru(w) for w in words(text) if len(w) >= 3 or re.search(r"\d", w)]


def overlap(expected: str, got: str) -> float:
    """Доля значимых слов эталона, найденных в ответе (с учётом окончаний)."""
    e, g = stems(expected), stems(got)
    if not e:
        return 1
    found = [
        s
        for s in e
        if any(t == s or (min(len(s), len(t)) >= 3 and (t.startswith(s) or s.startswith(t))) for t in g)
    ]
    return len(found) / len(e)


def level_out(level: str | None) -> str | None:
    if not level or level == "any":
        return None
    return "advanced" if level == "experienced" else level


def check_when(expected: str | None, starts_at: str | None, missing: list[str]) -> bool:
    """Дата встречи: сегодня, завтра, выходные, ближайший день недели или день следующей недели."""
    if expected is None:
        return not starts_at or "date" in missing
    d = dates.moment(starts_at) if starts_at else None
    if expected == "weekend":
        return "date" in missing or (d is not None and d.isoweekday() in {6, 7})
    if d is None or "date" in missing:
        return False
    now = dates.moment(NOW)
    next_monday = dates.start_of_day(now) + timedelta(days=8 - now.isoweekday())
    checks = {
        "today": lambda: d.date() == now.date(),
        "tomorrow": lambda: d.date() == now.date() + timedelta(days=1),
        **{
            f"next:weekday:{k}": lambda n=n: (
                d.isoweekday() == n and next_monday <= d < next_monday + timedelta(days=7)
            )
            for k, n in DOW.items()
        },
        **{
            f"weekday:{k}": lambda n=n: d.isoweekday() == n and d > now and (d - now).days < 7
            for k, n in DOW.items()
        },
    }
    check = checks.get(expected)
    return bool(check and check())


def short_date(value: str | None) -> str | None:
    if not value:
        return None
    local = dates.moment(value)
    return f"{dates.WEEKDAYS_SHORT[local.isoweekday()]} {local:%d.%m}"


# ---------- Разбор фраз ----------


def eval_search(c: dict[str, Any]) -> list[Field]:
    f = assistant.parse_search(c["input"], CTX)["filters"]
    e = c["expected"]
    sports = [sport_name(id_) for id_ in f.get("sportIds") or []]
    date = dates.moment(f["date"]) if f.get("date") else None
    when = f.get("when")
    if when == "date" and date is not None:
        weekday = next(k for k, n in DOW.items() if n == date.isoweekday())
        after_tomorrow = date.date() == dates.moment(NOW).date() + timedelta(days=2)
        when = "date:+2d" if after_tomorrow and e["when"] == "date:+2d" else f"weekday:{weekday}"
    level = "beginner" if f.get("beginners") else level_out(f.get("level"))
    price = "free" if f.get("free") else f"max:{f['priceMax']}" if f.get("priceMax") else None
    beginners = True if f.get("beginners") else None
    sport_ok = not sports if e["sport"] is None else len(sports) == 1 and same_name(sports[0], e["sport"])
    return [
        ("sport", sport_ok, e["sport"], ", ".join(str(s) for s in sports) or None),
        ("when", same(e.get("when"), when), e.get("when"), when),
        ("timeOfDay", same(e.get("timeOfDay"), f.get("dayPart")), e.get("timeOfDay"), f.get("dayPart")),
        ("level", same(e.get("level"), level), e.get("level"), level),
        ("price", same(e.get("price"), price), e.get("price"), price),
        (
            "nearby",
            same_name(e.get("nearby"), district_name(f.get("districtId"))),
            e.get("nearby"),
            district_name(f.get("districtId")),
        ),
        (
            "beginnersWelcome",
            same(e.get("beginnersWelcome"), beginners),
            e.get("beginnersWelcome"),
            beginners,
        ),
    ]


def bring_matches(expected: list[str], got: list[str]) -> bool:
    if not expected:
        return not got
    joined = ", ".join(got)
    return all(overlap(item, joined) >= 0.5 for item in expected) and len(got) <= len(expected) + 1


def price_matches(expected: dict[str, Any], price: dict[str, Any] | None) -> bool:
    kind = (price or {}).get("kind")
    if expected["type"] is None:
        return not price
    if expected["type"] == "free":
        return kind == "free"
    if expected["type"] == "fixed":
        return kind == "fixed" and same(price["amount"], expected["amount"])  # type: ignore[index]
    return kind == "split" and same(price["total"], expected["amount"])  # type: ignore[index]


def new_sport_fields(e: dict[str, Any], d: dict[str, Any], new_sport: dict[str, Any] | None) -> list[Field]:
    is_new = bool(not d.get("sportId") and d.get("newSportName"))
    sport = (new_sport or {}).get("name") if e.get("isNewSport") else sport_name(d.get("sportId"))
    if e["sport"] is None:
        sport_ok = not d.get("sportId") and not d.get("newSportName")
    else:
        sport_ok = same_name(sport, e["sport"])
    return [
        ("sport", sport_ok, e["sport"], sport if sport is not None else d.get("newSportName")),
        ("isNewSport", bool(e.get("isNewSport")) == is_new, e.get("isNewSport"), is_new),
    ]


def eval_event(c: dict[str, Any]) -> list[Field]:
    res = assistant.draft_event(c["input"], CTX)
    d = res["draft"]
    e = c["expected"]
    missing = ["sport" if q["field"] == "sportId" else q["field"] for q in res["missing"]]
    starts_at = d.get("startsAt")
    time = dates.format_time(starts_at) if starts_at and "time" not in missing else None
    bring_text = (d.get("firstStep") or {}).get("bring")
    bring = [x for x in re.split(r",\s*", bring_text) if x] if bring_text else []
    place = d.get("place")
    if e["place"] is None:
        place_ok = not place
    else:
        place_ok = bool(place and overlap(str(e["place"]), place["address"]) >= 0.6)
    join_ok = d.get("joinMode") != "approval" if e["joinMode"] is None else e["joinMode"] == d.get("joinMode")
    return [
        ("title", overlap(str(e["title"]), d.get("title") or "") >= 0.5, e["title"], d.get("title")),
        *new_sport_fields(e, d, res["newSport"]),
        ("date", check_when(e["date"], starts_at, missing), e["date"], short_date(starts_at)),
        ("time", same(e.get("time"), time), e.get("time"), time),
        ("place", place_ok, e["place"], (place or {}).get("address")),
        ("capacity", same(e.get("capacity"), d.get("capacity")), e.get("capacity"), d.get("capacity")),
        (
            "minParticipants",
            same(e.get("minParticipants"), d.get("minParticipants")),
            e.get("minParticipants"),
            d.get("minParticipants"),
        ),
        ("joinMode", join_ok, e["joinMode"], d.get("joinMode")),
        ("price", price_matches(e["price"], d.get("price")), e["price"], d.get("price")),
        ("level", same(e.get("level"), level_out(d.get("level"))), e.get("level"), level_out(d.get("level"))),
        (
            "beginnersWelcome",
            same(e.get("beginnersWelcome"), d.get("beginnersWelcome")),
            e.get("beginnersWelcome"),
            d.get("beginnersWelcome"),
        ),
        ("bring", bring_matches(e["bring"], bring), e["bring"], bring),
        (
            "repeatWeekly",
            bool(e.get("repeatWeekly")) == bool(d.get("repeatWeeklyUntil")),
            e.get("repeatWeekly"),
            bool(d.get("repeatWeeklyUntil")),
        ),
        ("missing", same_set(e["missing"], missing), e["missing"], missing),
    ]


COMPANION_WEEKDAYS = [
    ("mon", "понедельник"),
    ("tue", "вторник"),
    ("wed", "сред"),
    ("thu", "четверг"),
    ("fri", "пятниц"),
    ("sat", "суббот"),
    ("sun", "воскресен"),
]


def companion_when(text: str | None) -> dict[str, str | None]:
    t = normalize(text or "")
    weekday = next((f"weekday:{k}" for k, stem in COMPANION_WEEKDAYS if stem in t), None)
    when = "weekdays" if "будн" in t else weekday or ("weekend" if "выходн" in t else None)
    parts = [("morning", "утр"), ("day", "днем"), ("evening", "вечер")]
    return {"when": when, "timeOfDay": next((k for k, stem in parts if stem in t), None)}


def eval_companion(c: dict[str, Any]) -> list[Field]:
    res = assistant.draft_companion(c["input"], CTX)
    d = res["draft"]
    e = c["expected"]
    renamed = {"sportId": "sport", "districtId": "district"}
    missing = [renamed.get(q["field"], q["field"]) for q in res["missing"]]
    ct = e["convenientTime"]
    ours = companion_when(d.get("when"))
    district = district_name(d.get("districtId"))
    return [
        *new_sport_fields(e, d, res["newSport"]),
        ("district", same_name(e["district"], district), e["district"], district),
        ("when", same(ct["when"], ours["when"]), ct["when"], ours["when"]),
        ("timeOfDay", same(ct["timeOfDay"], ours["timeOfDay"]), ct["timeOfDay"], ours["timeOfDay"]),
        ("level", same(e.get("level"), level_out(d.get("level"))), e.get("level"), level_out(d.get("level"))),
        ("missing", same_set(e["missing"], missing), e["missing"], missing),
    ]


def phone_digits(value: str | None) -> str | None:
    return re.sub(r"^8", "7", re.sub(r"\D", "", value or "")) or None


def eval_org(c: dict[str, Any]) -> list[Field]:
    res = assistant.draft_organization(c["input"], CTX)
    d = res["draft"]
    e = c["expected"]
    missing = ["sports" if q["field"] == "sportIds" else q["field"] for q in res["missing"]]
    sports = [sport_name(id_) for id_ in d.get("sportIds") or []]
    expected_sports = e["sports"]
    type_ = "initiative_group" if d.get("type") == "initiative" else d.get("type")
    ec = e["contacts"]
    contacts = d.get("contacts") or {}
    social = contacts.get("social") or ""
    telegram = social if social.startswith("@") else None
    if e["name"] is None:
        name_ok = not d.get("name")
    else:
        name_ok = normalize(e["name"]) in normalize(d.get("name") or "")
    sports_ok = len(sports) <= len(expected_sports) and all(
        any(same_name(x, s) for x in sports) for s in expected_sports
    )
    phone = phone_digits(contacts.get("phone"))
    email = contacts.get("email") or None
    return [
        ("name", name_ok, e["name"], d.get("name")),
        ("type", e["type"] == type_, e["type"], type_),
        ("sports", sports_ok, expected_sports, sports),
        ("phone", phone_digits(ec["phone"]) == phone, ec["phone"], contacts.get("phone") or None),
        ("email", same(ec.get("email"), email), ec.get("email"), email),
        ("telegram", same(ec.get("telegram"), telegram), ec.get("telegram"), telegram),
        ("missing", same_set(e["missing"], missing), e["missing"], missing),
    ]


ORG_REQUEST = re.compile(r"Заявка организации\s*[«\"]([^»\"]+)[»\"]\s*:?\s*(.*)", re.DOTALL)


def eval_moderation(c: dict[str, Any]) -> list[Field]:
    org = ORG_REQUEST.fullmatch(c["input"])
    result = (
        assistant.premoderate_organization(
            {"name": org[1], "description": org[2], "contacts": {"phone": "", "email": "", "social": ""}}
        )
        if org
        else assistant.premoderate(c["input"])
    )
    got = f"{result['flag']} ({result['reason']})" if result["reason"] else result["flag"]
    return [("flag", result["flag"] == c["expected"]["flag"], c["expected"]["flag"], got)]


# ---------- Диалог подбора ----------


def run_match(c: dict[str, Any]) -> dict[str, Any]:
    """Фраза, затем по очереди варианты из ответа, которые выбирает человек."""
    actor = core.domain.user(c["actor"]) if c.get("actor") else None
    steps: list[dict[str, Any]] = []
    result = match.match_events(core.domain, actor, {"text": c["input"], "steps": steps})
    for id_ in c.get("steps", []):
        options = [o for q in result["questions"] for o in q["options"]] + result["widen"]
        option = next((o for o in options if o["id"] == id_), None)
        if option is None:
            msg = f"в ответе нет варианта {id_}"
            raise LookupError(msg)
        steps.append({"id": option["id"], "patch": option["patch"]})
        result = match.match_events(core.domain, actor, {"text": c["input"], "steps": steps})
    return result


def includes(want: list[str], got: list[str]) -> bool:
    return all(x in got for x in want)


def eval_match(c: dict[str, Any], r: dict[str, Any] | LookupError) -> list[Field]:
    """Проверяются только поля, названные в эталоне."""
    if isinstance(r, LookupError):
        return [("steps", False, c.get("steps"), str(r))]
    e = c["expected"]
    ids = [i["event"]["id"] for i in r["items"]]
    sport_ids = r["filters"].get("sportIds") or []
    sport = sport_name(sport_ids[0]) if sport_ids else None
    top = ids[0] if ids else None
    widen = [w["id"] for w in r["widen"]]
    question = r["questions"][0]["id"] if r["questions"] else None
    joined = [j["id"] for j in r["joined"]]
    why = " · ".join(r["items"][0]["why"] if r["items"] else [])
    checks: dict[str, Callable[[Any], Field]] = {
        "sport": lambda want: ("sport", same_name(sport, want), want, sport),
        "items": lambda want: ("items", includes(want, ids), want, ids),
        "top": lambda want: ("top", same(top, want), want, top),
        "noItems": lambda want: ("noItems", not ids if want else True, [], ids),
        "minTotal": lambda want: ("minTotal", r["total"] >= want, f"≥ {want}", r["total"]),
        "widen": lambda want: ("widen", includes(want, widen), want, widen),
        "question": lambda want: ("question", same(question, want), want, question),
        "companion": lambda want: ("companion", bool(r["companion"]) == want, want, bool(r["companion"])),
        "joined": lambda want: ("joined", includes(want, joined), want, joined),
        "whyIncludes": lambda want: ("why", normalize(want) in normalize(why), want, why),
    }
    return [checks[k](want) for k, want in e.items() if k in checks]


# ---------- Счёт ----------


def show(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def pct(a: int, b: int) -> str:
    return f"{round(a / b * 100)}%" if b else "—"


def score(runners: dict[str, Callable[[dict[str, Any]], list[Field]]]) -> tuple[dict[str, int], str]:
    """Прогон набора: верные целиком кейсы по видам и отчёт (таблица и промахи)."""
    passed_by_kind: dict[str, int] = {}
    rows: list[str] = []
    misses: list[str] = []
    for kind, run in runners.items():
        passed = fields = fields_ok = 0
        for c in cases(kind):
            results = run(c)
            bad = [r for r in results if not r[1]]
            fields += len(results)
            fields_ok += len(results) - len(bad)
            if not bad:
                passed += 1
                continue
            text = c["input"] if len(c["input"]) <= 90 else f"{c['input'][:90]}…"
            details = "\n".join(f"  - {f}: ждали {show(exp)}, получили {show(got)}" for f, _, exp, got in bad)
            misses.append(f"- {c['id']} «{text}»\n{details}")
        total = len(cases(kind))
        passed_by_kind[kind] = passed
        rows.append(
            f"| {KIND_LABEL[kind]} | {total} | {passed} | {pct(passed, total)} | {pct(fields_ok, fields)} |"
        )
    table = "\n".join(
        [
            "| Вид | Кейсов | Верно целиком | Точность по кейсам | Точность по полям |",
            "|---|---|---|---|---|",
            *rows,
        ]
    )
    return passed_by_kind, f"{table}\n\nПромахи:\n{chr(10).join(misses) if misses else 'нет'}\n"


def check(passed: dict[str, int], report: str) -> None:
    print(report)  # noqa: T201  отчёт виден с pytest -s
    low = {k: f"{n} < {PASS_AT_LEAST[k]}" for k, n in passed.items() if n < PASS_AT_LEAST[k]}
    assert not low, f"Точность помощника упала: {low}\n\n{report}"


def test_phrase_parsing_keeps_accuracy() -> None:
    passed, report = score(
        {
            "search": eval_search,
            "event_draft": eval_event,
            "companion_draft": eval_companion,
            "org_draft": eval_org,
            "moderation": eval_moderation,
        }
    )
    check(passed, report)


async def test_match_dialog_keeps_accuracy(app: FastAPI) -> None:
    domain_store = app.state.domain.store
    results: dict[str, dict[str, Any] | LookupError] = {}
    clock.set_frozen(NOW)
    try:
        await asyncio.to_thread(domain_store.write, lambda: provider.load_seed(seed.build_seed(NOW)))
        for c in cases("match"):
            try:
                results[c["id"]] = await asyncio.to_thread(domain_store.write, lambda c=c: run_match(c))
            except LookupError as error:
                results[c["id"]] = error
    finally:
        clock.set_frozen(None)
    passed, report = score({"match": lambda c: eval_match(c, results[c["id"]])})
    check(passed, report)
