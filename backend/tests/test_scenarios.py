"""Шесть базовых сценариев кейса по HTTP: создание мероприятия, допуск организации, свободная запись,
участие по заявке, уточнение условий в обсуждении и снятие с публикации.

Каждый сценарий проверяется с обеих сторон: у того, кто действует, и у того, кто видит результат.
"""

from typing import Any

import httpx
import pytest

from app.domain import clock

# seeded — фикстура: часы на NOW и демо-данные
from tests.helpers import DAY, NOW, filters, login, seeded  # noqa: F401

pytestmark = pytest.mark.usefixtures("seeded")


def event_form(**overrides: Any) -> dict[str, Any]:
    """Форма события: направление, время, место, условия и режим записи."""
    return {
        "title": "Бадминтон после работы",
        "description": "Играем парами на двух кортах, ракетки есть лишние. Приходите с любым уровнем.",
        "sportId": "s-badminton",
        "startsAt": clock.iso(NOW + 3 * DAY),
        "durationMin": 90,
        "place": {"address": "Спортзал школы № 10, ул. Ленина, 5", "districtId": "d-center"},
        "level": "amateur",
        "price": {"kind": "fixed", "amount": 300},
        "cancelPolicy": {"kind": "hoursBefore", "hours": 12},
        "joinMode": "approval",
        "capacity": 8,
        "privateInfo": "Вход со двора, код домофона 15",
        **overrides,
    }


def org_form(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Клуб городков «Бита»",
        "type": "club",
        "description": "Играем в городки по выходным в Академгородке, учим новичков бросать биту.",
        "sportIds": ["s-gorodki"],
        "districtId": "d-akadem",
        "address": "Академгородок, площадка у дома 9",
        "contacts": {"phone": "+7 900 111-22-33", "email": "", "social": ""},
        **overrides,
    }


async def feed_ids(
    client: httpx.AsyncClient, *items: tuple[str, str, Any], headers: dict[str, str] | None = None
) -> list[str]:
    response = await client.get("/api/events", params=filters(*items), headers=headers)
    assert response.status_code == 200, response.text
    return [e["id"] for e in response.json()["data"]]


async def card(client: httpx.AsyncClient, event_id: str, headers: dict[str, str]) -> dict[str, Any]:
    response = await client.get(f"/api/events/{event_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def people(card_: dict[str, Any], group: str) -> list[str]:
    """Кто в группе карточки организатора: confirmed, pending, waitlist, declined."""
    return [p["user"]["id"] for p in card_["manage"][group]]


# ---------- 1. Создание мероприятия пользователем ----------


async def test_scenario_1_user_creates_event_and_another_user_finds_it(client: httpx.AsyncClient) -> None:
    petr = await login(client, "u-petr")
    anna = await login(client, "u-anna")

    created = await client.post("/api/events", json=event_form(), headers=petr)

    assert created.status_code == 200, created.text
    event = created.json()
    assert event["organizer"] == {"kind": "user", "id": "u-petr"}
    assert (event["status"], event["state"], event["isOrganizer"]) == ("published", "upcoming", True)

    found = await feed_ids(
        client, ("sportId", "eq", "s-badminton"), ("joinMode", "eq", "approval"), headers=anna
    )
    assert event["id"] in found

    seen = await card(client, event["id"], anna)
    assert seen["sport"]["id"] == "s-badminton"
    assert seen["startsAt"] == event_form()["startsAt"]
    assert seen["place"]["address"] == "Спортзал школы № 10, ул. Ленина, 5"
    assert seen["price"] == {"kind": "fixed", "amount": 300}
    assert seen["cancelPolicy"] == {"kind": "hoursBefore", "hours": 12}
    assert (seen["joinMode"], seen["capacity"]) == ("approval", 8)
    assert seen["organizerView"]["id"] == "u-petr"
    assert (seen["isOrganizer"], seen["my"], seen["can"]["join"]) == (False, None, True)
    # Приватные сведения открываются только подтверждённым участникам
    assert seen["privateInfo"] == ""


async def test_scenario_1_event_with_new_sport_direction(client: httpx.AsyncClient) -> None:
    anna = await login(client, "u-anna")
    petr = await login(client, "u-petr")
    form = event_form(sportId=None, newSportName="пляжный теннис", title="Пляжный теннис на Татышеве")

    similar = await client.post("/api/events", json=form, headers=anna)
    created = await client.post("/api/events", json={**form, "confirmNew": True}, headers=anna)

    # Похожее направление есть в каталоге — сначала предлагается выбрать его
    assert similar.status_code == 409
    assert similar.json()["code"] == "sport_similar"
    assert "s-tennis" in [s["id"] for s in similar.json()["similar"]]
    assert created.status_code == 200, created.text
    event = created.json()
    sport_id = event["sportId"]
    assert sport_id not in {"s-tennis", "s-tabletennis"}
    assert (event["sport"]["name"], event["sport"]["kind"]) == ("Пляжный теннис", "custom")

    sport = (await client.get(f"/api/sports/{sport_id}")).json()
    assert sport["createdBy"]["id"] == "u-anna"
    assert event["id"] in await feed_ids(client, ("sportId", "eq", sport_id), headers=petr)

    # Направление теперь в списке: такое же название выбирает его без вопросов
    again = await client.post(
        "/api/events",
        json=event_form(sportId=None, newSportName="Пляжный теннис", startsAt=clock.iso(NOW + 4 * DAY)),
        headers=petr,
    )
    assert again.status_code == 200, again.text
    assert again.json()["sportId"] == sport_id


# ---------- 2. Допуск организации и публикация ----------


async def test_scenario_2_approved_organization_publishes_without_moderation(
    client: httpx.AsyncClient,
) -> None:
    petr = await login(client, "u-petr")
    admin = await login(client, "u-maria")
    anna = await login(client, "u-anna")

    draft = await client.post("/api/organizations", json=org_form(), headers=petr)
    assert draft.status_code == 200, draft.text
    org_id = draft.json()["id"]
    assert draft.json()["status"] == "draft"
    submitted = await client.post(f"/api/organizations/{org_id}/submit", json={}, headers=petr)
    assert submitted.json()["status"] == "pending"
    # До допуска публичной страницы нет
    assert (await client.get(f"/api/organizations/{org_id}", headers=anna)).status_code == 404

    queue = await client.get(
        "/api/organizations",
        params=filters(("scope", "eq", "admin"), ("status", "eq", "pending")),
        headers=admin,
    )
    assert org_id in [o["id"] for o in queue.json()["data"]]
    decided = await client.post(
        f"/api/organizations/{org_id}/decide", json={"decision": "approve"}, headers=admin
    )
    assert decided.status_code == 200, decided.text

    mine = await client.get(f"/api/organizations/{org_id}", headers=petr)
    assert mine.json()["status"] == "approved"

    published = await client.post(
        "/api/events", json=event_form(sportId="s-gorodki", orgId=org_id), headers=petr
    )
    assert published.status_code == 200, published.text
    event = published.json()
    assert event["organizer"] == {"kind": "org", "id": org_id}
    assert (event["status"], event["moderation"]) == ("published", None)

    page = await client.get(f"/api/organizations/{org_id}", headers=anna)
    assert page.status_code == 200
    assert (page.json()["name"], page.json()["status"]) == ("Клуб городков «Бита»", "approved")
    assert event["id"] in await feed_ids(
        client, ("scope", "eq", "org"), ("orgId", "eq", org_id), headers=anna
    )
    assert event["id"] in await feed_ids(client, ("sportId", "eq", "s-gorodki"), headers=anna)
    seen = await card(client, event["id"], anna)
    assert seen["organizerView"]["name"] == "Клуб городков «Бита»"
    assert seen["organizerView"]["verified"] is True


async def test_scenario_2_rejected_organization_sees_reason_and_cannot_publish(
    client: httpx.AsyncClient,
) -> None:
    sergey = await login(client, "u-sergey")
    admin = await login(client, "u-maria")
    anna = await login(client, "u-anna")
    reason = "Добавьте расписание тренировок и место сбора групп."

    no_reason = await client.post(
        "/api/organizations/o-enisey/decide", json={"decision": "reject"}, headers=admin
    )
    rejected = await client.post(
        "/api/organizations/o-enisey/decide", json={"decision": "reject", "reason": reason}, headers=admin
    )

    assert no_reason.status_code == 422
    assert no_reason.json()["code"] == "reason_required"
    assert rejected.status_code == 200, rejected.text

    mine = await client.get("/api/organizations/o-enisey", headers=sergey)
    assert mine.json()["status"] == "rejected"
    notes = (await client.get("/api/notifications", params=filters(), headers=sergey)).json()["data"]
    assert any(n["type"] == "org_rejected" and reason in n["text"] for n in notes)

    refused = await client.post(
        "/api/events", json=event_form(sportId="s-running", orgId="o-enisey"), headers=sergey
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "org_not_approved"
    # Публичной страницы у недопущенной организации нет
    assert (await client.get("/api/organizations/o-enisey", headers=anna)).status_code == 404


async def test_scenario_2_demo_account_hint_follows_organization_status(client: httpx.AsyncClient) -> None:
    admin = await login(client, "u-maria")

    async def sergey() -> dict[str, Any]:
        accounts = (await client.get("/api/demo/accounts")).json()
        return next(a for a in accounts if a["id"] == "u-sergey")

    before = await sergey()
    decided = await client.post(
        "/api/organizations/o-enisey/decide", json={"decision": "approve"}, headers=admin
    )
    after = await sergey()

    assert before["orgs"][0]["status"] == "pending"
    assert "ждёт проверки" in before["hint"]
    assert decided.status_code == 200, decided.text
    assert after["orgs"] == [{"id": "o-enisey", "name": "Беговой клуб «Енисей»", "status": "approved"}]
    assert after["hint"].startswith("Клуб допущен")


# ---------- 3. Свободное присоединение ----------


async def test_scenario_3_user_joins_open_event_and_organizer_sees_participant(
    client: httpx.AsyncClient,
) -> None:
    anna = await login(client, "u-anna")
    dmitry = await login(client, "u-dmitry")
    before = (await card(client, "e-run-tatyshev", anna))["counts"]["confirmed"]

    joined = await client.post("/api/events/e-run-tatyshev/join", json={}, headers=anna)

    assert joined.status_code == 200, joined.text
    mine = joined.json()
    assert mine["joinMode"] == "open"
    assert mine["my"]["status"] == "confirmed"
    assert mine["counts"]["confirmed"] == before + 1
    assert mine["privateInfo"] != ""
    assert mine["can"]["leave"] is True

    organizer = await card(client, "e-run-tatyshev", dmitry)
    assert "u-anna" in people(organizer, "confirmed")


# ---------- 4. Участие по заявке ----------


async def test_scenario_4_application_is_accepted_and_both_see_confirmed(client: httpx.AsyncClient) -> None:
    anna = await login(client, "u-anna")
    dmitry = await login(client, "u-dmitry")

    applied = await client.post(
        "/api/events/e-volley-hall/join", json={"note": "Играла в школе"}, headers=anna
    )

    assert applied.status_code == 200, applied.text
    assert applied.json()["joinMode"] == "approval"
    assert applied.json()["my"]["status"] == "pending"
    assert applied.json()["privateInfo"] == ""

    pending = await client.get(
        "/api/participations",
        params=filters(("eventId", "eq", "e-volley-hall"), ("status", "eq", "pending")),
        headers=dmitry,
    )
    application = next(p for p in pending.json()["data"] if p["userId"] == "u-anna")
    assert application["note"] == "Играла в школе"
    accepted = await client.post(
        f"/api/participations/{application['id']}/decide", json={"decision": "accept"}, headers=dmitry
    )

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "confirmed"
    seen = await card(client, "e-volley-hall", anna)
    assert seen["my"]["status"] == "confirmed"
    assert seen["privateInfo"] != ""
    organizer = await card(client, "e-volley-hall", dmitry)
    assert "u-anna" in people(organizer, "confirmed")
    assert "u-anna" not in people(organizer, "pending")


async def test_scenario_4_application_is_rejected_and_both_see_rejected(client: httpx.AsyncClient) -> None:
    # Турнир клуба «Ладья» по заявке: заявка Петра из демо-данных ждёт решения, решает представитель Ольга
    petr = await login(client, "u-petr")
    olga = await login(client, "u-olga")
    reason = "Турнир для игроков без разряда, приходите на блиц в среду."
    assert (await card(client, "e-chess-rapid", petr))["my"]["status"] == "pending"
    organizer = await card(client, "e-chess-rapid", olga)
    application = next(p for p in organizer["manage"]["pending"] if p["user"]["id"] == "u-petr")

    rejected = await client.post(
        f"/api/participations/{application['id']}/decide",
        json={"decision": "reject", "reason": reason},
        headers=olga,
    )

    assert rejected.status_code == 200, rejected.text
    assert (rejected.json()["status"], rejected.json()["rejectReason"]) == ("rejected", reason)
    seen = await card(client, "e-chess-rapid", petr)
    assert (seen["my"]["status"], seen["my"]["rejectReason"]) == ("rejected", reason)
    assert seen["can"]["join"] is False
    organizer = await card(client, "e-chess-rapid", olga)
    assert "u-petr" in people(organizer, "declined")
    assert "u-petr" not in people(organizer, "pending")


# ---------- 5. Уточнение условий ----------


async def test_scenario_5_question_and_organizer_answer_are_visible_in_discussion(
    client: httpx.AsyncClient,
) -> None:
    anna = await login(client, "u-anna")
    dmitry = await login(client, "u-dmitry")

    question = await client.post(
        "/api/messages",
        json={"eventId": "e-run-tatyshev", "text": "Подскажите, можно ли прийти, если бегаю только 3 км?"},
        headers=anna,
    )
    assert question.status_code == 200, question.text
    answer = await client.post(
        "/api/messages",
        json={
            "eventId": "e-run-tatyshev",
            "text": "Конечно, после 3 км можно перейти на шаг, я подожду.",
            "replyTo": question.json()["id"],
        },
        headers=dmitry,
    )
    assert answer.status_code == 200, answer.text

    listed = await client.get(
        "/api/messages", params=filters(("eventId", "eq", "e-run-tatyshev")), headers=anna
    )
    assert listed.status_code == 200
    by_id = {m["id"]: m for m in listed.json()["data"]}
    asked, answered = by_id[question.json()["id"]], by_id[answer.json()["id"]]
    assert (asked["author"]["id"], asked["author"]["isOrganizer"], asked["mine"]) == ("u-anna", False, True)
    assert (answered["author"]["id"], answered["author"]["isOrganizer"]) == ("u-dmitry", True)
    assert answered["replyTo"] == asked["id"]
    assert answered["text"] == "Конечно, после 3 км можно перейти на шаг, я подожду."


# ---------- 6. Снятие с публикации ----------


async def first_rule_id(client: httpx.AsyncClient, admin: dict[str, str]) -> str:
    rules = await client.get("/api/rules", params=filters(), headers=admin)
    assert rules.status_code == 200
    return rules.json()["data"][0]["id"]


async def test_scenario_6_admin_removes_event_from_publication(client: httpx.AsyncClient) -> None:
    admin = await login(client, "u-maria")
    petr = await login(client, "u-petr")  # уже записан на блиц
    olga = await login(client, "u-olga")  # представитель клуба-организатора
    anna = await login(client, "u-anna")
    rule_id = await first_rule_id(client, admin)
    assert "e-chess-blitz" in await feed_ids(client)

    no_rule = await client.post(
        "/api/events/e-chess-blitz/moderate", json={"action": "remove"}, headers=admin
    )
    removed = await client.post(
        "/api/events/e-chess-blitz/moderate",
        json={"action": "remove", "ruleId": rule_id, "comment": "Платный вход не указан в условиях"},
        headers=admin,
    )

    assert no_rule.status_code == 422
    assert no_rule.json()["code"] == "reason_required"
    assert removed.status_code == 200, removed.text
    assert removed.json()["state"] == "removed"
    assert "e-chess-blitz" not in await feed_ids(client)
    assert "e-chess-blitz" not in await feed_ids(client, headers=anna)

    direct = await client.post("/api/events/e-chess-blitz/join", json={}, headers=anna)
    assert direct.status_code == 409
    assert direct.json()["code"] == "event_removed"

    participant = await card(client, "e-chess-blitz", petr)
    assert (participant["state"], participant["my"]["status"]) == ("removed", "event_removed")
    assert participant["moderation"]["ruleId"] == rule_id
    assert (participant["can"]["join"], participant["can"]["ask"]) == (False, False)

    organizer = await card(client, "e-chess-blitz", olga)
    assert organizer["state"] == "removed"
    assert organizer["moderation"]["ruleId"] == rule_id
    assert organizer["can"]["appeal"] is True

    # Запись не отменяется, а приостанавливается: участнику обещано восстановление, и оно происходит.
    notes = (await client.get("/api/notifications", params=filters(), headers=petr)).json()["data"]
    note = next(n for n in notes if n["link"] == "/events/e-chess-blitz" and n["type"] == "removed")
    assert "Ваша запись приостановлена" in note["text"]
    assert "восстановится сама" in note["text"]
    restored = await client.post(
        "/api/events/e-chess-blitz/moderate", json={"action": "restore"}, headers=admin
    )
    assert restored.status_code == 200, restored.text
    back = await card(client, "e-chess-blitz", petr)
    assert (back["state"], back["my"]["status"]) == ("upcoming", "confirmed")


async def test_scenario_6_admin_deletes_event_and_card_is_gone(client: httpx.AsyncClient) -> None:
    admin = await login(client, "u-maria")
    anna = await login(client, "u-anna")
    dmitry = await login(client, "u-dmitry")
    petr = await login(client, "u-petr")
    rule_id = await first_rule_id(client, admin)
    joined = await client.post("/api/events/e-run-tatyshev/join", json={}, headers=anna)
    assert joined.json()["my"]["status"] == "confirmed"

    deleted = await client.post(
        "/api/events/e-run-tatyshev/moderate", json={"action": "delete", "ruleId": rule_id}, headers=admin
    )

    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["state"] == "deleted"
    assert "e-run-tatyshev" not in await feed_ids(client)
    direct = await client.post("/api/events/e-run-tatyshev/join", json={}, headers=petr)
    assert direct.status_code == 410
    assert direct.json()["code"] == "event_deleted"

    gone = await client.get("/api/events/e-run-tatyshev", headers=anna)
    assert gone.status_code == 410
    assert gone.json()["code"] == "event_deleted"
    # В «Моих занятиях» удалённое событие остаётся с пометкой
    participating = await client.get(
        "/api/events", params=filters(("scope", "eq", "participating")), headers=anna
    )
    mine = next(e for e in participating.json()["data"] if e["id"] == "e-run-tatyshev")
    assert (mine["state"], mine["my"]["status"]) == ("deleted", "event_removed")

    organizer = await card(client, "e-run-tatyshev", dmitry)
    assert (organizer["state"], organizer["can"]["manage"]) == ("deleted", False)
    # Организатор находит удалённое событие в «Организую» вместе с причиной
    assert "e-run-tatyshev" in await feed_ids(client, ("scope", "eq", "organizing"), headers=dmitry)
    assert organizer["moderation"]["ruleId"] == rule_id
