"""Сценарий «обход»: все чтения под каждой демо-ролью и гостем — списки, карточки, GET-действия.

Ловит расхождения в представлениях и правах: кто что видит, какие поля приходят.
Идентификаторы берутся из демо-данных: из снимка JSON или из сида бэкенда (в его контейнере).

    python -I scripts/scenarios/make_crawl.py <снимок.json> > crawl.json
    docker compose -f deploy/docker-compose.yml --profile test run --rm -T \
      -v "$PWD/scripts/scenarios:/scenarios" backend-test python /scenarios/make_crawl.py > /tmp/crawl.json
"""

import json
import sys
from typing import Any

EVENT_ROUTES = [
    "/events/{id}/greeter",
    "/events/{id}/urgent",
    "/events/{id}/alternatives",
    "/events/{id}/series",
    "/events/{id}/gear",
    "/events/{id}/source",
    "/events/{id}/my-report",
    "/events/{id}/my-message-reports",
    "/events/{id}/share",
    "/events/{id}/again",
    "/events/{id}/invite-link",
    "/events/{id}/team",
    "/events/{id}/teams",
    "/events/{id}/participants-export",
]
GLOBAL_ROUTES = [
    "/me",
    "/demo/accounts",
    "/demo/state",
    "/demo/short-reserve",
    "/admin/stats",
    "/admin/analytics",
    "/admin/community-stats",
    "/me/favorites",
    "/me/offline-cards",
    "/event-templates",
    "/inventory/me",
    "/mcp/catalog",
    "/mcp/tokens",
    "/mcp/calls",
]
SPORT_QUERIES = ["йогу", "валейбол", "скандинавка", "футик", "шахм", "лапта", "бег", "падел"]
PEOPLE_QUERIES = ["анна", "dmitry", "Ольга", "maria@vmeste.demo", "ив"]
EVENT_LISTS: list[list[dict[str, Any]]] = [
    [],
    [{"field": "scope", "operator": "eq", "value": "participating"}],
    [{"field": "scope", "operator": "eq", "value": "organizing"}],
    [{"field": "scope", "operator": "eq", "value": "admin"}],
    [{"field": "forYou", "operator": "eq", "value": True}],
    [{"field": "q", "operator": "contains", "value": "йога"}],
    [{"field": "q", "operator": "contains", "value": "хочу поиграть в шахматы"}],
    [{"field": "when", "operator": "eq", "value": "today"}],
    [{"field": "when", "operator": "eq", "value": "tomorrow"}],
    [{"field": "when", "operator": "eq", "value": "weekend"}],
    [{"field": "when", "operator": "eq", "value": "week"}],
    [{"field": "dayPart", "operator": "eq", "value": "evening"}],
    [{"field": "beginners", "operator": "eq", "value": True}],
    [{"field": "free", "operator": "eq", "value": True}],
    [{"field": "priceMax", "operator": "eq", "value": 300}],
    [{"field": "joinMode", "operator": "eq", "value": "approval"}],
    [{"field": "near", "operator": "eq", "value": True}, {"field": "radiusKm", "operator": "eq", "value": 3}],
    [{"field": "access", "operator": "eq", "value": ["ramp"]}],
    [{"field": "composition", "operator": "eq", "value": "women"}],
    [{"field": "family", "operator": "eq", "value": "kids"}],
    [{"field": "urgent", "operator": "nnull", "value": None}],
    [{"field": "program.kind", "operator": "eq", "value": "veterans"}],
    [{"field": "aiFlagged", "operator": "eq", "value": True}, {"field": "scope", "operator": "eq", "value": "admin"}],
    [
        {"field": "place.lat", "operator": "gte", "value": 55.3606},
        {"field": "place.lat", "operator": "lte", "value": 56.6606},
        {"field": "place.lng", "operator": "gte", "value": 92.0026},
        {"field": "place.lng", "operator": "lte", "value": 93.7026},
    ],
]
OTHER_LISTS: list[tuple[str, list[dict[str, Any]]]] = [
    ("participations", []),
    ("messages", [{"field": "scope", "operator": "eq", "value": "flagged"}]),
    ("messages", [{"field": "scope", "operator": "eq", "value": "hidden"}]),
    ("messages", [{"field": "scope", "operator": "eq", "value": "all"}]),
    ("sports", []),
    ("sports", [{"field": "q", "operator": "eq", "value": "йога"}]),
    ("sports", [{"field": "kind", "operator": "eq", "value": "custom"}]),
    ("categories", []),
    ("districts", []),
    ("rules", []),
    ("organizations", []),
    ("organizations", [{"field": "scope", "operator": "eq", "value": "mine"}]),
    ("organizations", [{"field": "scope", "operator": "eq", "value": "admin"}]),
    ("companions", []),
    ("companions", [{"field": "mine", "operator": "eq", "value": True}]),
    ("notifications", []),
    ("notifications", [{"field": "unread", "operator": "eq", "value": True}]),
    ("users", []),
    ("audit", []),
    ("invites", []),
    ("venues", []),
    ("venues", [{"field": "scope", "operator": "eq", "value": "mine"}]),
    ("venues", [{"field": "features", "operator": "eq", "value": ["ramp"]}]),
    ("shelf", []),
    ("gear-loans", [{"field": "role", "operator": "eq", "value": "incoming"}]),
    ("gear-loans", [{"field": "role", "operator": "eq", "value": "outgoing"}]),
    ("support-needs", []),
    ("support-needs", [{"field": "status", "operator": "eq", "value": "all"}]),
    ("community-imports", []),
    ("community-sources", []),
    ("reports", []),
]


def load_seed() -> dict[str, Any]:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:  # noqa: PTH123
            return json.load(f)
    from app.domain import clock, seed  # noqa: PLC0415  только в контейнере бэкенда

    return seed.build_seed(clock.parse("2026-10-19T03:00:00.000Z"))


def main() -> None:
    db = load_seed()
    demo = sorted((u for u in db["users"] if u.get("demo")), key=lambda u: u["demo"]["order"])
    actors: list[str | None] = [None, *(u["id"] for u in demo)]
    steps: list[dict[str, Any]] = []
    for actor in actors:
        for filters in EVENT_LISTS:
            steps.append({"as": actor, "op": "list", "resource": "events", "filters": filters})
        for resource, filters in OTHER_LISTS:
            steps.append({"as": actor, "op": "list", "resource": resource, "filters": filters})
        steps.extend({"as": actor, "op": "one", "resource": "events", "id": e["id"]} for e in db["events"])
        steps.extend({"as": actor, "op": "one", "resource": "organizations", "id": o["id"]} for o in db["organizations"])
        steps.extend({"as": actor, "op": "one", "resource": "companions", "id": c["id"]} for c in db["companions"])
        steps.extend({"as": actor, "op": "one", "resource": "venues", "id": v["id"]} for v in db["venues"])
        steps.extend({"as": actor, "op": "custom", "method": "get", "url": url} for url in GLOBAL_ROUTES)
        # GET-действия события — на каждом четвёртом событии: этого хватает, чтобы задеть все модули.
        for e in db["events"][::4]:
            steps.extend(
                {"as": actor, "op": "custom", "method": "get", "url": url.format(id=e["id"])} for url in EVENT_ROUTES
            )
        for o in db["organizations"]:
            steps.append({"as": actor, "op": "custom", "method": "get", "url": f"/organizations/{o['id']}/demand"})
            steps.append({"as": actor, "op": "custom", "method": "get", "url": f"/organizations/{o['id']}/managers"})
            steps.append({"as": actor, "op": "custom", "method": "get", "url": f"/follows/org/{o['id']}"})
        steps.extend(
            {"as": actor, "op": "custom", "method": "get", "url": "/people/suggest", "query": {"q": q}}
            for q in PEOPLE_QUERIES
        )
    # Публичное, не зависящее от зрителя, — один раз.
    steps.extend({"as": None, "op": "one", "resource": "users", "id": u["id"]} for u in db["users"])
    steps.extend({"as": None, "op": "one", "resource": "sports", "id": s["id"]} for s in db["sports"])
    steps.extend({"as": None, "op": "one", "resource": "rules", "id": r["id"]} for r in db["rules"])
    steps.extend({"as": None, "op": "one", "resource": "districts", "id": d["id"]} for d in db["districts"])
    steps.extend(
        {"as": None, "op": "custom", "method": "get", "url": "/sports/suggest", "query": {"q": q}}
        for q in SPORT_QUERIES
    )
    steps.extend(
        {"as": None, "op": "custom", "method": "get", "url": f"/follows/user/{u['id']}"} for u in db["users"]
    )
    json.dump(steps, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
