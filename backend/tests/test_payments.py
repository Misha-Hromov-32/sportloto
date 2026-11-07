"""Оплата на сайте (docs/features/payments.md) через HTTP API на демо-данных.

Сбор сервиса, запись со сроком оплаты, неоплата, отмена с возвратом и без, отмена встречи, складчина
(холд, сбор итоговой доли, порог), продажа вещей, автозачисление, права, выплаты, проверки формы.
Ветка ЮKassa — с подменённым API (httpx.MockTransport): создание платежа, уведомления с перезапросом,
повтор уведомления, списание и возврат исполнителем, ошибка шлюза, проверка адреса.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.core.config import Settings
from app.domain import clock, provider, seed
from app.domain.lib.payments import payment_settings, quote
from app.main import create_app
from app.payments import Credentials, YooKassaClient
from tests.conftest import _truncate, make_settings

NOW = clock.parse("2026-10-19T03:00:00.000Z")
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)
DAY = timedelta(days=1)
BASKET_START = clock.parse("2026-10-22T13:00:00.000Z")  # e-pay-basket: через 3 дня, 20:00 по Красноярску
VOLLEY_START = clock.parse("2026-10-24T12:00:00.000Z")  # e-pay-volley: через 5 дней, 19:00
OFF = json.dumps({"mode": "off"})


async def _seed(app: FastAPI) -> None:
    clock.set_frozen(NOW)
    await asyncio.to_thread(app.state.domain.store.write, lambda: provider.load_seed(seed.build_seed(NOW)))


@pytest.fixture
def settings(database_url: str) -> Settings:
    # Часы двигаются на дни вперёд: даты демо-данных не сдвигаем, чтобы сроки считались от сида.
    return make_settings(database_url, demo_shift_dates=False)


@pytest.fixture
async def seeded(app: FastAPI) -> AsyncIterator[FastAPI]:
    await _seed(app)
    try:
        yield app
    finally:
        clock.set_frozen(None)


async def tick(app: FastAPI, at: datetime) -> None:
    clock.set_frozen(at)
    await asyncio.to_thread(app.state.domain.tick)


class Api:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.tokens: dict[str, dict[str, str]] = {}

    async def headers(self, user_id: str | None) -> dict[str, str]:
        if user_id is None:
            return {}
        if user_id not in self.tokens:
            response = await self.client.post("/api/auth/demo-login", json={"userId": user_id})
            if response.status_code == 404:
                response = await self.client.post(
                    "/api/auth/login", json={"email": f"{user_id[2:]}@vmeste.demo"}
                )
            assert response.status_code == 200, response.text
            self.client.cookies.clear()
            self.tokens[user_id] = {"Authorization": f"Bearer {response.json()['token']}"}
        return self.tokens[user_id]

    async def call(
        self, who: str | None, method: str, url: str, body: Any = None, **params: Any
    ) -> httpx.Response:
        return await self.client.request(
            method, f"/api{url}", headers=await self.headers(who), json=body, params=params or None
        )

    async def ok(self, who: str | None, method: str, url: str, body: Any = None, **params: Any) -> Any:
        response = await self.call(who, method, url, body, **params)
        assert response.status_code == 200, response.text
        return response.json()

    async def error(
        self, who: str | None, method: str, url: str, body: Any = None, **params: Any
    ) -> dict[str, Any]:
        response = await self.call(who, method, url, body, **params)
        assert response.status_code >= 400, response.text
        return {"status": response.status_code, **response.json()}

    async def my_payment(self, who: str, event_id: str) -> dict[str, Any]:
        return (await self.ok(who, "GET", f"/events/{event_id}"))["my"]["payment"]

    async def pay(self, who: str, target: str, method: str, kind: str = "event_share") -> dict[str, Any]:
        return await self.ok(who, "POST", "/payments", {"kind": kind, "targetId": target, "method": method})

    async def fake(self, who: str, payment_id: str, outcome: str = "succeeded") -> dict[str, Any]:
        return await self.ok(who, "POST", f"/payments/{payment_id}/fake", {"outcome": outcome})

    async def notifications(self, who: str, type_: str) -> list[dict[str, Any]]:
        rows = await self.ok(who, "GET", "/notifications", pagination=OFF)
        return [n for n in rows["data"] if n["type"] == type_]

    async def admin_payment(self, payment_id: str) -> dict[str, Any]:
        return await self.ok("u-maria", "GET", f"/admin/payments/{payment_id}")


@pytest.fixture
def api(client: httpx.AsyncClient) -> Api:
    return Api(client)


# ---------- Сбор сервиса ----------


@pytest.mark.parametrize(
    "case",
    [
        (300, "sbp", 0.038, 0, 303, 3),
        (300, "bank_card", 0.038, 0, 312, 12),
        (300, "bank_card", 0.028, 0, 309, 9),
        (1000, "sbp", 0.038, 0.05, 1058, 58),
        (1000, "bank_card", 0.038, 0.05, 1092, 92),
        (1000, "bank_card", 0.028, 0.05, 1081, 81),
        (993, "sbp", 0.038, 0, 1000, 7),
    ],
)
def test_fee_table_from_docs(case: tuple[int, str, float, float, int, int]) -> None:
    base, method, card_rate, markup, total, fee = case
    s = payment_settings({"rates": {"bank_card": card_rate}})
    q = quote(base, method, s, markup)

    assert (q["total"], q["fee"]) == (total, fee)
    parts = q["feeParts"]
    assert abs(parts["bank"] + parts["payout"] + parts["platform"] + parts["reserve"] - fee) < 0.001
    assert isinstance(q["total"], int)


@pytest.mark.usefixtures("seeded")
async def test_quote_for_event_and_item(api: Api) -> None:
    basket = await api.ok(None, "GET", "/payments/quote", kind="event_share", targetId="e-pay-basket")
    volley = await api.ok(None, "GET", "/payments/quote", kind="event_share", targetId="e-pay-volley")
    ball = await api.ok(None, "GET", "/payments/quote", kind="item_order", targetId="sh-dmitry-ball")
    banks = await api.ok(None, "GET", "/payments/sbp-banks")

    assert [(x["method"], x["total"]) for x in basket["lines"]] == [("sbp", 353), ("bank_card", 364)]
    assert volley["maxShare"] == 450
    assert {x["method"]: x["flow"] for x in volley["lines"]} == {"sbp": "refund_diff", "bank_card": "hold"}
    assert ball["markup"] == 0.05
    assert ball["lines"][0]["feeParts"]["platform"] == 125
    assert any(b["name"] == "Сбербанк" for b in banks)


# ---------- Встреча «с человека» ----------


@pytest.mark.usefixtures("seeded")
async def test_fixed_online_join_pay_paid(api: Api) -> None:
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    required = await api.my_payment("u-anna", "e-pay-basket")
    payment = await api.pay("u-anna", "e-pay-basket", "sbp")
    again = await api.pay("u-anna", "e-pay-basket", "sbp")
    paid = await api.fake("u-anna", payment["id"])
    after = await api.my_payment("u-anna", "e-pay-basket")
    twice = await api.error(
        "u-anna", "POST", "/payments", {"kind": "event_share", "targetId": "e-pay-basket", "method": "sbp"}
    )

    assert required["status"] == "required"
    assert required["canPay"]
    assert clock.parse(required["dueAt"]) == NOW + 20 * MINUTE
    assert payment["status"] == "pending"
    assert payment["total"] == 353
    assert payment["confirmationUrl"] == f"/pay/fake/{payment['id']}"
    assert again["id"] == payment["id"]
    assert paid["status"] == "paid"
    assert paid["capturedAmount"] == 353
    assert after["status"] == "paid"
    assert not after["canPay"]
    assert twice["code"] == "payment_not_required"
    assert len(await api.notifications("u-anna", "pay_due")) == 1
    assert len(await api.notifications("u-anna", "pay_received")) == 1


async def test_unpaid_participation_released_by_tick(seeded: FastAPI, api: Api) -> None:
    await api.ok("u-petr", "POST", "/events/e-pay-basket/join", {})
    await tick(seeded, NOW + 19 * MINUTE)
    still = (await api.ok("u-petr", "GET", "/events/e-pay-basket"))["my"]["status"]
    await tick(seeded, NOW + 21 * MINUTE)
    card = await api.ok("u-petr", "GET", "/events/e-pay-basket")

    assert still == "confirmed"
    assert card["my"]["status"] == "cancelled"
    assert card["my"]["payment"]["status"] == "expired"
    assert len(await api.notifications("u-petr", "pay_expired")) == 1
    assert len(await api.notifications("u-dmitry", "pay_expired")) == 1


async def test_started_payment_keeps_seat_for_grace(seeded: FastAPI, api: Api) -> None:
    await api.ok("u-petr", "POST", "/events/e-pay-basket/join", {})
    started = await api.pay("u-petr", "e-pay-basket", "bank_card")
    await tick(seeded, NOW + 30 * MINUTE)
    held = (await api.ok("u-petr", "GET", "/events/e-pay-basket"))["my"]["status"]
    await tick(seeded, NOW + 36 * MINUTE)
    dropped = await api.ok("u-petr", "GET", "/events/e-pay-basket")

    assert held == "confirmed"
    assert dropped["my"]["status"] == "cancelled"
    assert (await api.admin_payment(started["id"]))["status"] == "expired"


@pytest.mark.usefixtures("seeded")
async def test_leave_in_time_refunds_share_late_does_not(api: Api) -> None:
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    anna = await api.fake("u-anna", (await api.pay("u-anna", "e-pay-basket", "sbp"))["id"])
    await api.ok("u-anna", "POST", "/events/e-pay-basket/leave", {})
    refunded = await api.admin_payment(anna["id"])
    note = (await api.notifications("u-anna", "pay_refund"))[0]

    await api.ok("u-galina", "POST", "/events/e-pay-basket/join", {})
    galina = await api.fake("u-galina", (await api.pay("u-galina", "e-pay-basket", "sbp"))["id"])
    clock.set_frozen(BASKET_START - 3 * HOUR)
    late = await api.ok("u-galina", "POST", "/events/e-pay-basket/leave", {})
    kept = await api.admin_payment(galina["id"])

    assert refunded["refundedAmount"] == 350
    assert refunded["status"] == "partially_refunded"
    assert "сбор сервиса 3" in note["text"]
    assert late["lateCancel"] is True
    assert kept["refundedAmount"] == 0
    assert kept["forfeited"] is True


@pytest.mark.usefixtures("seeded")
async def test_organizer_cancel_refunds_everything(api: Api) -> None:
    await api.ok("u-dmitry", "POST", "/events/e-pay-basket/cancel", {"reason": "Зал закрыли"})
    rows = await api.ok("u-maria", "GET", "/admin/payments", q="баскетбол")

    assert rows
    assert all(p["status"] == "refunded" and p["refundedAmount"] == p["total"] for p in rows)
    note = (await api.notifications("u-timur", "pay_refund"))[0]
    assert note["title"] == "Деньги вернутся на карту"


# ---------- Складчина ----------


async def _futsal(api: Api, min_participants: int = 3) -> dict[str, Any]:
    start = clock.iso(NOW + 2 * DAY)
    return await api.ok(
        "u-dmitry",
        "POST",
        "/events",
        {
            "title": "Футзал: аренда на всех",
            "description": "",
            "sportId": "s-football",
            "startsAt": start,
            "durationMin": 90,
            "place": {"address": "Спортзал школы № 10, ул. Ладо Кецховели, 22"},
            "level": "any",
            "beginnersWelcome": True,
            "firstStep": {},
            "price": {"kind": "split", "total": 900, "note": "на зал"},
            "cancelPolicy": {"kind": "anytime"},
            "joinMode": "open",
            "capacity": 10,
            "minParticipants": min_participants,
            "paymentMode": "online",
        },
    )


async def test_split_collect_captures_final_share_and_refunds_sbp_difference(
    seeded: FastAPI, api: Api
) -> None:
    futsal = await _futsal(api)
    start = clock.parse(futsal["startsAt"])
    players = [
        ("u-anna", "bank_card"),
        ("u-petr", "sbp"),
        ("u-galina", "bank_card"),
        ("u-maxim", "bank_card"),
    ]
    ids = []
    for who, method in players:
        await api.ok(who, "POST", f"/events/{futsal['id']}/join", {})
        ids.append((await api.fake(who, (await api.pay(who, futsal["id"], method))["id"]))["id"])
    held = await api.admin_payment(ids[0])
    money = await api.ok("u-dmitry", "GET", f"/events/{futsal['id']}/money")

    await tick(seeded, start - 2 * HOUR + MINUTE)
    card = await api.admin_payment(ids[0])
    sbp = await api.admin_payment(ids[1])
    event = await api.ok("u-anna", "GET", f"/events/{futsal['id']}")

    assert held["status"] == "held"
    assert held["capture"] is False
    assert held["base"] == 300
    assert money["heldCount"] == 3
    assert money["paidCount"] == 1
    assert money["collected"] == 1200
    assert event["payCollect"]["outcome"] == "collected"
    assert event["payCollect"]["share"] == 225
    assert card["status"] == "paid"
    assert card["capturedAmount"] == 234 < card["initialTotal"]
    assert sbp["status"] == "partially_refunded"
    assert sbp["refundedAmount"] == 303 - 227
    assert event["my"]["payment"]["status"] == "paid"

    await tick(seeded, start + 91 * MINUTE)
    balance = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
    assert any(c["targetId"] == futsal["id"] and c["amount"] == 900 for c in balance["credits"])
    assert len(await api.notifications("u-dmitry", "money_credited")) == 1


async def test_split_threshold_not_reached_cancels_holds_and_refunds_sbp(seeded: FastAPI, api: Api) -> None:
    await tick(seeded, VOLLEY_START - 2 * HOUR)
    event = await api.ok("u-dmitry", "GET", "/events/e-pay-volley")
    rows = {p["id"]: p for p in await api.ok("u-maria", "GET", "/admin/payments", q="волейбол")}

    assert event["payCollect"]["outcome"] == "failed"
    assert event["payCollect"]["paidCount"] == 3
    assert rows["pay-demo-3"]["status"] == "canceled"  # холд по карте снят
    assert rows["pay-demo-4"]["status"] == "refunded"
    assert rows["pay-demo-4"]["refundedAmount"] == 454
    assert len(await api.notifications("u-dmitry", "pay_failed")) == 1
    natalia = await api.ok("u-natalia", "GET", "/events/e-pay-volley")
    assert natalia["my"]["status"] == "cancelled"


async def test_split_payment_opens_seven_days_before(seeded: FastAPI, api: Api) -> None:
    far = clock.iso(NOW + 10 * DAY)
    futsal = await _futsal(api)
    await api.ok("u-dmitry", "PUT", f"/events/{futsal['id']}", {"startsAt": far})
    await api.ok("u-anna", "POST", f"/events/{futsal['id']}/join", {})
    my = await api.my_payment("u-anna", futsal["id"])
    early = await api.error(
        "u-anna", "POST", "/payments", {"kind": "event_share", "targetId": futsal["id"], "method": "sbp"}
    )

    assert my["status"] == "not_yet"
    assert not my["canPay"]
    assert early["code"] == "payment_not_open"
    assert "7 дней" in early["message"]

    await tick(seeded, clock.parse(far) - 7 * DAY + MINUTE)
    assert (await api.my_payment("u-anna", futsal["id"]))["status"] == "required"
    assert len(await api.notifications("u-anna", "pay_due")) == 1


# ---------- Вещи с полки ----------


@pytest.mark.usefixtures("seeded")
async def test_item_buy_pay_received_credits_seller(api: Api) -> None:
    order = await api.ok("u-anna", "POST", "/shelf/sh-dmitry-ball/buy", {"quantity": 1})
    payment = await api.pay("u-anna", order["id"], "sbp", "item_order")
    await api.fake("u-anna", payment["id"])
    paid = await api.ok("u-anna", "GET", f"/orders/{order['id']}")
    seller_view = await api.ok("u-dmitry", "GET", f"/orders/{order['id']}")
    before = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
    received = await api.ok("u-anna", "POST", f"/orders/{order['id']}/received", {})
    after = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
    shelf = await api.ok("u-anna", "GET", "/shelf", pagination=OFF)

    assert order["status"] == "awaiting_payment"
    assert payment["total"] == quote(2500, "sbp", payment_settings(None), 0.05)["total"]
    assert paid["status"] == "paid"
    assert paid["counterpart"]["contact"] == "+7 902 940-33-44"
    assert seller_view["counterpart"]["name"] == "Анна Соколова"
    assert len(await api.notifications("u-dmitry", "order_paid")) == 1
    assert any(x["targetId"] == order["id"] for x in before["pendingItems"])
    assert received["status"] == "received"
    assert after["available"] == before["available"] + 2500
    assert not any(i["id"] == "sh-dmitry-ball" for i in shelf["data"])


async def test_item_auto_completes_after_three_days_and_cancel_refunds(seeded: FastAPI, api: Api) -> None:
    item = await api.ok(
        "u-dmitry",
        "POST",
        "/shelf",
        {
            "name": "Ракетка для бадминтона",
            "quantity": 2,
            "condition": "good",
            "terms": [],
            "sale": {"price": 600},
        },
    )
    first = await api.ok("u-petr", "POST", f"/shelf/{item['id']}/buy", {})
    await api.fake("u-petr", (await api.pay("u-petr", first["id"], "bank_card", "item_order"))["id"])
    second = await api.ok("u-galina", "POST", f"/shelf/{item['id']}/buy", {})
    second_pay = await api.fake(
        "u-galina", (await api.pay("u-galina", second["id"], "sbp", "item_order"))["id"]
    )
    canceled = await api.ok("u-dmitry", "POST", f"/orders/{second['id']}/cancel", {"reason": "Треснула"})
    refund = await api.admin_payment(second_pay["id"])

    await tick(seeded, NOW + 3 * DAY + MINUTE)
    done = await api.ok("u-petr", "GET", f"/orders/{first['id']}")
    balance = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")

    assert canceled["status"] == "refunded"
    assert refund["status"] == "refunded"
    assert refund["refundedAmount"] == refund["total"]
    assert done["status"] == "received"
    assert any(c["targetId"] == first["id"] and c["amount"] == 600 for c in balance["credits"])


@pytest.mark.usefixtures("seeded")
async def test_item_validation_and_rules(api: Api) -> None:
    cheap = await api.error(
        "u-dmitry",
        "POST",
        "/shelf",
        {"name": "Мяч", "quantity": 1, "condition": "good", "terms": [], "sale": {"price": 10}},
    )
    own = await api.error("u-dmitry", "POST", "/shelf/sh-dmitry-ball/buy", {})
    not_sale = await api.error("u-anna", "POST", "/shelf/sh-legends-balls/buy", {})
    order = await api.ok("u-anna", "POST", "/shelf/sh-dmitry-ball/buy", {})
    remove = await api.error("u-dmitry", "DELETE", "/shelf/sh-dmitry-ball")
    stranger = await api.error(
        "u-petr", "POST", "/payments", {"kind": "item_order", "targetId": order["id"], "method": "sbp"}
    )

    assert cheap["status"] == 422
    assert "sale" in cheap["errors"]
    assert own["code"] == "bad_request"
    assert not_sale["code"] == "not_for_sale"
    assert remove["code"] == "bad_state"
    assert stranger["code"] == "forbidden"


# ---------- Права, выплаты, администратор ----------


@pytest.mark.usefixtures("seeded")
async def test_rights_on_payments_money_and_balances(api: Api) -> None:
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    payment = await api.pay("u-anna", "e-pay-basket", "sbp")

    assert (await api.error("u-petr", "GET", f"/payments/{payment['id']}"))["status"] == 404
    assert (await api.error("u-petr", "POST", f"/payments/{payment['id']}/fake", {"outcome": "succeeded"}))[
        "status"
    ] == 404
    assert (
        await api.error(
            None, "POST", "/payments", {"kind": "event_share", "targetId": "e-pay-basket", "method": "sbp"}
        )
    )["status"] == 401
    assert (await api.error("u-anna", "GET", "/events/e-pay-basket/money"))["code"] == "forbidden"
    assert (await api.error("u-anna", "GET", "/me/balance", owner="user:u-dmitry"))["code"] == "forbidden"
    assert (await api.error("u-dmitry", "GET", "/admin/payments/overview"))["code"] == "forbidden"
    not_member = await api.error(
        "u-petr", "POST", "/payments", {"kind": "event_share", "targetId": "e-pay-basket", "method": "sbp"}
    )
    offline = await api.error(
        "u-anna", "POST", "/payments", {"kind": "event_share", "targetId": "e-run-tatyshev", "method": "sbp"}
    )
    assert not_member["code"] == "payment_not_required"
    assert offline["code"] == "payment_not_required"
    assert (await api.ok("u-dmitry", "GET", "/events/e-pay-basket/money"))["paidCount"] == 2


@pytest.mark.usefixtures("seeded")
async def test_live_shop_does_not_pay_out_demo_balance(api: Api) -> None:
    """Боевой магазин: деньги из демо-данных и тестового режима вывести нельзя."""
    from app.domain.features import payments  # noqa: PLC0415

    before = payments.provider_status()
    demo = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
    assert demo["available"] > 0
    payments.configure(provider="yookassa", test=False, shopConfigured=True)
    try:
        live = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
        assert live["available"] == 0
    finally:
        payments.configure(**before)


@pytest.mark.usefixtures("seeded")
async def test_manual_payout_through_admin(api: Api) -> None:
    bad = await api.error(
        "u-dmitry",
        "POST",
        "/me/payouts",
        {"owner": "user:u-dmitry", "phone": "12", "bankId": "x", "amount": 10},
    )
    payout = await api.ok(
        "u-dmitry",
        "POST",
        "/me/payouts",
        {"owner": "user:u-dmitry", "phone": "8 902 940-33-44", "bankId": "100000000111"},
    )
    busy = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")
    queue = await api.ok("u-maria", "GET", "/admin/payouts", status="requested")
    denied = await api.error("u-dmitry", "POST", f"/admin/payouts/{payout['id']}/done", {})
    done = await api.ok("u-maria", "POST", f"/admin/payouts/{payout['id']}/done", {"note": "Перевела"})
    after = await api.ok("u-dmitry", "GET", "/me/balance", owner="user:u-dmitry")

    assert set(bad["errors"]) == {"phone", "bankId", "amount"}
    assert payout["status"] == "requested"
    assert payout["amount"] == 400
    assert payout["phone"] == "+79029403344"
    assert payout["phoneMasked"] == "+7 902 ***-**-44"
    assert not busy["canPayout"]
    assert busy["inPayout"] == 400
    assert [p["id"] for p in queue] == [payout["id"]]
    assert denied["code"] == "forbidden"
    assert done["status"] == "done"
    assert after["available"] == 0
    assert after["paidOut"] == 400
    assert len(await api.notifications("u-dmitry", "payout_sent")) == 1


async def test_admin_refund_overview_and_settings(seeded: FastAPI, api: Api) -> None:
    no_reason = await api.error("u-maria", "POST", "/admin/payments/pay-demo-1/refund", {"reason": ""})
    refund = await api.ok(
        "u-maria", "POST", "/admin/payments/pay-demo-1/refund", {"amount": 100, "reason": "Проверка возврата"}
    )
    overview = await api.ok("u-maria", "GET", "/admin/payments/overview")
    bad = await api.error("u-maria", "PUT", "/admin/payments/settings", {"rates": {"sbp": 3}})
    saved = await api.ok(
        "u-maria", "PUT", "/admin/payments/settings", {"rates": {"bank_card": 0.028}, "holdMinutes": 30}
    )
    await asyncio.to_thread(seeded.state.domain.store.write, provider.reset_demo)
    kept = await api.ok("u-maria", "GET", "/admin/payments/settings")

    assert no_reason["code"] == "reason_required"
    assert refund["refundedAmount"] == 100
    assert refund["status"] == "partially_refunded"
    assert overview["provider"] == {
        "provider": "fake",
        "test": True,
        "shopConfigured": False,
        "receipts": False,
        "payouts": "manual",
        "checkIp": False,
    }
    assert overview["turnover"] > 0
    assert overview["balancesDue"] == 400
    assert bad["status"] == 422
    assert saved["rates"]["bank_card"] == 0.028
    assert saved["holdMinutes"] == 30
    assert kept["rates"]["bank_card"] == 0.028


@pytest.mark.usefixtures("seeded")
async def test_payment_mode_validation(api: Api) -> None:
    futsal_free = await api.error(
        "u-dmitry",
        "POST",
        "/events",
        {
            "title": "Бесплатная тренировка",
            "description": "",
            "sportId": "s-running",
            "startsAt": clock.iso(NOW + DAY),
            "durationMin": 60,
            "place": {"address": "Остров Татышев"},
            "level": "any",
            "beginnersWelcome": True,
            "firstStep": {},
            "price": {"kind": "free"},
            "cancelPolicy": {"kind": "anytime"},
            "joinMode": "open",
            "capacity": None,
            "minParticipants": None,
            "paymentMode": "online",
        },
    )
    no_threshold = await api.error("u-dmitry", "PUT", "/events/e-pay-volley", {"minParticipants": None})
    with_people = await api.error("u-dmitry", "PUT", "/events/e-volley-hall", {"paymentMode": "online"})
    with_money = await api.error("u-dmitry", "PUT", "/events/e-pay-basket", {"paymentMode": "offline"})
    price = await api.error(
        "u-dmitry", "PUT", "/events/e-pay-basket", {"price": {"kind": "fixed", "amount": 500}}
    )

    assert futsal_free["errors"]["paymentMode"] == "Оплата на сайте нужна только для платной встречи"
    assert no_threshold["errors"]["paymentMode"].startswith("Для складчины с оплатой на сайте")
    assert (
        with_people["errors"]["paymentMode"]
        == "Оплату на сайте можно включить, пока на встречу никто не записан"
    )
    assert with_money["errors"]["paymentMode"].startswith("Уже есть оплаты на сайте")
    assert price["errors"]["paymentMode"].startswith("Уже есть оплаты на сайте")


@pytest.mark.usefixtures("seeded")
async def test_removed_from_event_gets_full_refund(api: Api) -> None:
    rows = await api.ok(
        "u-dmitry",
        "GET",
        "/participations",
        filters=json.dumps([{"field": "eventId", "operator": "eq", "value": "e-pay-basket"}]),
    )
    timur = next(p for p in rows["data"] if p["userId"] == "u-timur")
    await api.ok("u-dmitry", "POST", f"/participations/{timur['id']}/remove", {"reason": "Ошибся составом"})

    assert (await api.admin_payment("pay-demo-1"))["status"] == "refunded"


# ---------- ЮKassa (подменённый API) ----------


class FakeYooKassa:
    """Состояние магазина: платежи, возвраты и запросы, которые к нему пришли."""

    def __init__(self) -> None:
        self.payments: dict[str, dict[str, Any]] = {}
        self.refunds: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str, str | None]] = []
        self.fail_create = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/v3")
        body = json.loads(request.content or b"{}")
        self.calls.append((request.method, path, request.headers.get("Idempotence-Key")))
        assert request.headers["Authorization"].startswith("Basic ")
        if path.startswith("/refunds"):
            return self._refunds(request.method, path, body)
        if request.method == "POST" and path == "/payments":
            return self._create(body)
        obj = self.payments.get(path.split("/")[2]) if path.startswith("/payments/") else None
        if obj is None:
            return httpx.Response(404, json={"type": "error", "description": "not found"})
        if path.endswith("/capture"):
            obj.update(status="succeeded", amount=body["amount"])
        elif path.endswith("/cancel"):
            obj.update(status="canceled", cancellation_details={"reason": "canceled_by_merchant"})
        return httpx.Response(200, json=obj)

    def _create(self, body: dict[str, Any]) -> httpx.Response:
        if self.fail_create:
            return httpx.Response(500, json={"type": "error", "description": "Internal error"})
        id_ = f"yk-{len(self.payments) + 1}"
        self.payments[id_] = {
            "id": id_,
            "status": "pending",
            "amount": body["amount"],
            "capture": body["capture"],
            "metadata": body["metadata"],
            "test": True,
            "confirmation": {"type": "redirect", "confirmation_url": f"https://yoomoney.ru/checkout/{id_}"},
            "receipt": body.get("receipt"),
        }
        return httpx.Response(200, json=self.payments[id_])

    def _refunds(self, method: str, path: str, body: dict[str, Any]) -> httpx.Response:
        if method == "POST":
            id_ = f"rf-{len(self.refunds) + 1}"
            self.refunds[id_] = {
                "id": id_,
                "status": "succeeded",
                "payment_id": body["payment_id"],
                "amount": body["amount"],
            }
            return httpx.Response(200, json=self.refunds[id_])
        return httpx.Response(200, json=self.refunds[path.split("/")[2]])


@pytest.fixture
async def yk_app(database_url: str) -> AsyncIterator[tuple[FastAPI, FakeYooKassa]]:
    settings = make_settings(
        database_url,
        payments_provider="yookassa",
        yookassa_shop_id="123456",
        yookassa_secret_key="test_secret",
        site_url="https://sport.example",
        demo_shift_dates=False,
    )
    application = create_app(settings)
    shop = FakeYooKassa()
    application.state.payments.gateway = YooKassaClient(
        Credentials("123456", "test_secret"), transport=httpx.MockTransport(shop.handler)
    )
    await _seed(application)
    try:
        yield application, shop
    finally:
        clock.set_frozen(None)
        application.state.broker.close_all()
        await _truncate(application)
        await application.state.ai.provider.aclose()
        await application.state.db.dispose()
        application.state.domain.store.dispose()
        # Следующие приложения в прогоне — с провайдером fake
        create_app(make_settings(database_url))


@pytest.fixture
async def yk(yk_app: tuple[FastAPI, FakeYooKassa]) -> AsyncIterator[tuple[FastAPI, FakeYooKassa, Api]]:
    application, shop = yk_app
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield application, shop, Api(http)


def notification(event: str, obj: dict[str, Any]) -> dict[str, Any]:
    return {"type": "notification", "event": event, "object": obj}


async def test_yookassa_payment_created_and_forged_webhook_ignored(
    yk: tuple[FastAPI, FakeYooKassa, Api],
) -> None:
    app, shop, api = yk
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    payment = await api.pay("u-anna", "e-pay-basket", "bank_card")
    created = shop.calls[0]

    forged = await api.client.post(
        "/api/payments/yookassa/webhook",
        json=notification(
            "payment.succeeded", {"id": "yk-1", "status": "succeeded", "amount": {"value": "364.00"}}
        ),
    )
    still = await api.ok("u-anna", "GET", f"/payments/{payment['id']}")

    shop.payments["yk-1"]["status"] = "succeeded"
    webhook = notification("payment.succeeded", {"id": "yk-1", "status": "succeeded"})
    first = await api.client.post("/api/payments/yookassa/webhook", json=webhook)
    repeat = await api.client.post("/api/payments/yookassa/webhook", json=webhook)
    paid = await api.ok("u-anna", "GET", f"/payments/{payment['id']}")

    assert created == ("POST", "/payments", f"{payment['id']}-create")
    assert payment["confirmationUrl"] == "https://yoomoney.ru/checkout/yk-1"
    assert payment["test"] is True
    assert shop.payments["yk-1"]["metadata"] == {"paymentId": payment["id"]}
    assert shop.payments["yk-1"]["amount"] == {"value": "364.00", "currency": "RUB"}
    assert forged.status_code == 200
    assert still["status"] == "pending"
    assert first.status_code == 200
    assert repeat.status_code == 200
    assert paid["status"] == "paid"
    assert paid["capturedAmount"] == 364
    assert len(await api.notifications("u-anna", "pay_received")) == 1
    assert app.state.payments.gateway is not None


async def test_yookassa_status_refreshed_when_webhook_lost(yk: tuple[FastAPI, FakeYooKassa, Api]) -> None:
    _app, shop, api = yk
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    payment = await api.pay("u-anna", "e-pay-basket", "sbp")
    shop.payments["yk-1"]["status"] = "succeeded"

    refreshed = await api.ok("u-anna", "GET", f"/payments/{payment['id']}")

    assert refreshed["status"] == "paid"
    assert ("GET", "/payments/yk-1", None) in shop.calls


async def test_yookassa_fake_page_disabled_and_provider_error(yk: tuple[FastAPI, FakeYooKassa, Api]) -> None:
    _app, shop, api = yk
    await api.ok("u-anna", "POST", "/events/e-pay-basket/join", {})
    payment = await api.pay("u-anna", "e-pay-basket", "sbp")
    fake = await api.error("u-anna", "POST", f"/payments/{payment['id']}/fake", {"outcome": "succeeded"})

    await api.ok("u-galina", "POST", "/events/e-pay-basket/join", {})
    shop.fail_create = True
    down = await api.error(
        "u-galina", "POST", "/payments", {"kind": "event_share", "targetId": "e-pay-basket", "method": "sbp"}
    )
    my = await api.my_payment("u-galina", "e-pay-basket")

    assert fake["code"] == "forbidden"
    assert down["status"] == 502
    assert down["code"] == "payment_provider_error"
    assert my["canPay"]
    assert my["status"] == "required"


async def test_yookassa_hold_capture_and_refund_by_worker(yk: tuple[FastAPI, FakeYooKassa, Api]) -> None:
    app, shop, api = yk
    futsal = await _futsal(api, min_participants=2)
    start = clock.parse(futsal["startsAt"])
    ids = []
    for who in ("u-anna", "u-petr", "u-galina"):
        await api.ok(who, "POST", f"/events/{futsal['id']}/join", {})
        payment = await api.pay(who, futsal["id"], "bank_card")
        yk_id = f"yk-{len(ids) + 1}"
        assert shop.payments[yk_id]["capture"] is False
        shop.payments[yk_id]["status"] = "waiting_for_capture"
        await api.client.post(
            "/api/payments/yookassa/webhook", json=notification("payment.waiting_for_capture", {"id": yk_id})
        )
        ids.append(payment["id"])
    held = await api.admin_payment(ids[0])

    await api.ok("u-galina", "POST", f"/events/{futsal['id']}/leave", {})
    queued_cancel = await api.admin_payment(ids[2])
    await tick(app, start - 2 * HOUR + MINUTE)
    queued_capture = await api.admin_payment(ids[0])
    done = await app.state.payments.run_ops()
    captured = await api.admin_payment(ids[0])
    canceled = await api.admin_payment(ids[2])

    assert held["status"] == "held"
    assert queued_cancel["processing"] is True
    assert queued_cancel["status"] == "held"
    assert queued_capture["processing"] is True
    assert queued_capture["status"] == "held"
    assert done == 3
    assert captured["status"] == "paid"
    assert captured["capturedAmount"] == quote(450, "bank_card", payment_settings(None))["total"]
    assert shop.payments["yk-1"]["amount"]["value"] == f"{captured['capturedAmount']:.2f}"
    assert canceled["status"] == "canceled"
    assert ("POST", "/payments/yk-3/cancel", canceled["ops"][0]["id"] + "-cancel") in shop.calls

    await api.ok("u-dmitry", "POST", f"/events/{futsal['id']}/cancel", {"reason": "Не будет зала"})
    await app.state.payments.run_ops()
    refunded = await api.admin_payment(ids[0])
    assert refunded["status"] == "refunded"
    assert refunded["refundedAmount"] == captured["capturedAmount"]
    assert shop.refunds["rf-1"]["amount"]["value"] == f"{captured['capturedAmount']:.2f}"


async def test_yookassa_webhook_ip_check(database_url: str) -> None:
    settings = make_settings(
        database_url,
        payments_provider="yookassa",
        yookassa_shop_id="1",
        yookassa_secret_key="test_x",
        yookassa_check_ip=True,
    )
    application = create_app(settings)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application), base_url="http://test"
        ) as http:
            body = notification("payment.succeeded", {"id": "yk-1"})
            foreign = await http.post(
                "/api/payments/yookassa/webhook", json=body, headers={"X-Real-IP": "8.8.8.8"}
            )
            # С адреса ЮKassa уведомление принимается, но неизвестный платёж ничего не меняет
            application.state.payments.gateway = YooKassaClient(
                Credentials("1", "test_x"),
                transport=httpx.MockTransport(
                    lambda _r: httpx.Response(200, json={"id": "yk-1", "status": "pending"})
                ),
            )
            own = await http.post(
                "/api/payments/yookassa/webhook", json=body, headers={"X-Real-IP": "185.71.76.5"}
            )
        assert foreign.status_code == 403
        assert own.status_code == 200
    finally:
        application.state.broker.close_all()
        await application.state.ai.provider.aclose()
        await application.state.db.dispose()
        application.state.domain.store.dispose()
        create_app(make_settings(database_url))
