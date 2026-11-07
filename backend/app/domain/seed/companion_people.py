"""Вымышленные анкеты и объявления «Ищу компанию» (companion_people.json): дополняют базу, ничего не заменяя."""

import json
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

from app.domain import clock


@cache
def _fixture() -> dict[str, Any]:
    return json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))


def seed_companion_people(data: dict[str, Any], now: datetime) -> bool:
    fixture = _fixture()
    settings = data["settings"]
    if settings.get("companionPeopleVersion", 0) >= fixture["version"]:
        return False
    users = {u["id"]: u for u in data["users"] if u["role"] != "deleted" and u["email"].endswith(".demo")}
    for id_ in fixture["portraits"]:
        user = users.get(id_)
        if not user:
            continue
        if user.get("avatarUrl") is None:
            user["avatarUrl"] = f"/demo/people/{id_}.jpg"
        if not user["about"].strip() and id_ in fixture["bios"]:
            user["about"] = fixture["bios"][id_]
        if not user["interests"] and id_ in fixture["interests"]:
            user["interests"] = [
                sport
                for sport in fixture["interests"][id_]
                if any(s["id"] == sport and not s.get("mergedInto") for s in data["sports"])
            ]
            for sport in user["interests"]:
                user["levels"].setdefault(sport, "amateur")
    ids = {c["id"] for c in data["companions"]}
    districts = {d["id"]: d for d in data["districts"]}
    sports = {s["id"] for s in data["sports"] if not s.get("mergedInto")}
    for request in fixture["requests"]:
        district = districts.get(request["districtId"])
        if (
            request["id"] in ids
            or request["authorId"] not in users
            or not district
            or request["sportId"] not in sports
        ):
            continue
        data["companions"].append(
            {
                **{
                    k: request[k]
                    for k in ("id", "authorId", "sportId", "districtId", "text", "when", "level", "readiness")
                },
                "point": {"lat": district["lat"], "lng": district["lng"]},
                "metoo": [
                    {
                        "userId": id_,
                        "at": clock.iso(now - timedelta(minutes=max(1, request["minutesAgo"] - (i + 1) * 5))),
                    }
                    for i, id_ in enumerate(request["metoo"])
                    if id_ in users
                ],
                "status": "open",
                "eventId": None,
                "createdWithAssistant": False,
                "createdAt": clock.iso(now - timedelta(minutes=request["minutesAgo"])),
            }
        )
        ids.add(request["id"])
    settings["companionPeopleVersion"] = fixture["version"]
    return True
