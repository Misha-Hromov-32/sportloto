"""Оплата на сайте (схема — docs/features/payments.md).

Платежи за участие во встречах и за вещи с полки, сбор сервиса, сроки оплаты, складчина с холдом,
возвраты, зачисления получателям и выплаты.

Правила синхронные: операции к ЮKassa (списание, снятие холда, возврат, выплата) ставятся в очередь
`paymentOps`, исполнитель (app/services/payments.py) выполняет их и докладывает результат
(`complete_op`). С провайдером fake операции выполняются сразу.
"""

import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import TYPE_CHECKING, Any

from app.core.errors import AppError, ErrorCode
from app.domain import clock
from app.domain.errors import fail
from app.domain.features.kit import commit, date_token, db, get_event, notify, require_user
from app.domain.features.participation_host import input_text
from app.domain.features.reports import audit_log, require_admin
from app.domain.lib.money import format_rub
from app.domain.lib.numbers import format_number, parse_number
from app.domain.lib.payments import (
    add,
    kop,
    num,
    payment_settings,
    quote,
    split_final_share,
    split_max_share,
)
from app.domain.lib.plural import WORDS, plural
from app.domain.lib.text import normalize
from app.domain.routing import Route, route
from app.domain.schema import COLLECTIONS
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

# Начатая оплата (человек на странице банка) держит место ещё столько после срока.
GRACE = timedelta(minutes=15)
MAX_ATTEMPTS = 5
SALE_MIN = 50
SALE_MAX = 300_000
COVER_STATUSES = ("held", "paid", "partially_refunded")
OPEN_ORDER = ("awaiting_payment", "paid")

# ---------- Провайдер ----------

_config: dict[str, Any] = {
    "provider": "fake",
    "test": True,
    "shopConfigured": False,
    "receipts": False,
    "payouts": "manual",
    "checkIp": False,
}


def configure(**values: Any) -> None:
    """Провайдер и режим выплат задаёт сервер при запуске (app/services/payments.py)."""
    _config.update(values)


def provider_name() -> str:
    return _config["provider"]


def require_enabled() -> None:
    if provider_name() == "disabled":
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Оплата на сайте отключена")


def _enabled_action(action: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(action)
    def checked(*args: Any, **kwargs: Any) -> Any:
        require_enabled()
        return action(*args, **kwargs)

    return checked


def _enabled_hook(action: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(action)
    def checked(*args: Any, **kwargs: Any) -> Any:
        if provider_name() == "disabled":
            return False
        return action(*args, **kwargs)

    return checked


SBP_BANKS = [
    {"id": "100000000111", "name": "Сбербанк"},
    {"id": "100000000004", "name": "Т-Банк"},
    {"id": "100000000005", "name": "ВТБ"},
    {"id": "100000000008", "name": "Альфа-Банк"},
    {"id": "100000000001", "name": "Газпромбанк"},
    {"id": "100000000007", "name": "Райффайзенбанк"},
    {"id": "100000000013", "name": "Совкомбанк"},
    {"id": "100000000016", "name": "Почта Банк"},
    {"id": "100000000020", "name": "Россельхозбанк"},
    {"id": "100000000017", "name": "МТС Банк"},
    {"id": "100000000273", "name": "Ozon Банк"},
    {"id": "100000000022", "name": "ЮMoney"},
]

# ---------- Данные ----------


def _payments() -> list[Entity]:
    return db().payments


def _ops() -> list[Entity]:
    return db().payment_ops


def _dues() -> list[Entity]:
    return db().payment_dues


def _orders() -> list[Entity]:
    return db().orders


def _credits() -> list[Entity]:
    return db().credits


def _payouts() -> list[Entity]:
    return db().payouts


def settings_of() -> dict[str, Any]:
    return payment_settings(db().settings.get("payments"))


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _now_iso() -> str:
    return clock.iso(clock.now())


def _at(iso: Any) -> datetime:
    """Момент из записи; неразборчивая дата — давнее прошлое: срок по ней уже вышел."""
    moment = clock.parse(iso)
    return moment if moment is not None else _EPOCH


def _newest(items: list[Entity]) -> list[Entity]:
    return sorted(items, key=lambda x: (x["createdAt"], x["id"]), reverse=True)


def _clean(value: Any, max_: int) -> str:
    return " ".join(input_text(value).split())[:max_]


def _mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"+7 {digits[1:4]} ***-**-{digits[9:]}" if len(digits) == 11 else phone


# ---------- Встреча с оплатой на сайте ----------


def is_online(e: Entity) -> bool:
    return provider_name() != "disabled" and e.get("paymentMode") == "online" and e["price"]["kind"] != "free"


def _online_events() -> list[Entity]:
    return db().records("events", COLLECTIONS["events"].table.c.payment_mode == "online", predicate=is_online)


def _price_kind(e: Entity) -> str:
    return "split" if e["price"]["kind"] == "split" else "fixed"


def _start(e: Entity) -> datetime:
    return _at(e["startsAt"])


def _end(e: Entity) -> datetime:
    return _start(e) + timedelta(minutes=e["durationMin"])


def _collect_at(e: Entity, s: dict[str, Any]) -> datetime:
    return _start(e) - timedelta(hours=s["collectHoursBefore"])


def _opens_at(e: Entity, s: dict[str, Any]) -> datetime:
    return _start(e) - timedelta(days=s["splitOpenDays"])


def _collected(e: Entity) -> bool:
    return (e.get("payCollect") or {}).get("outcome") == "collected"


def _collect_failed(e: Entity) -> bool:
    return (e.get("payCollect") or {}).get("outcome") == "failed"


def _min_participants(e: Entity) -> int:
    """Порог складчины; без порога — двое."""
    value = e.get("minParticipants")
    return value if value is not None else 2


def _max_share_of(e: Entity) -> int | None:
    if e["price"]["kind"] != "split":
        return None
    return split_max_share(e["price"]["total"], _min_participants(e))


def _current_base(e: Entity) -> Any:
    """Сколько получит организатор с человека сейчас: цена, наибольшая доля или итоговая после сбора."""
    kind = e["price"]["kind"]
    if kind == "fixed":
        return e["price"]["amount"]
    if kind == "split":
        return e["payCollect"]["share"] if _collected(e) else _max_share_of(e)
    return 0


def _default_due(e: Entity, s: dict[str, Any]) -> datetime:
    """Срок оплаты от момента, когда запись попала в состав; складчина — до сбора; не позже начала."""
    start = _start(e)
    if e["price"]["kind"] == "split" and not _collected(e):
        return min(_collect_at(e, s), start)
    if e["joinMode"] == "approval":
        window = timedelta(hours=s["approvalHours"])
    else:
        window = timedelta(minutes=s["holdMinutes"])
    return min(clock.now() + window, start)


def _event_payments(event_id: ID, user_id: ID | None = None) -> list[Entity]:
    return [
        p
        for p in _payments()
        if p["kind"] == "event_share"
        and p["targetId"] == event_id
        and (user_id is None or p["userId"] == user_id)
    ]


def _open_ops(p: Entity) -> list[Entity]:
    return [o for o in _ops() if o.get("paymentId") == p["id"] and o["status"] in ("queued", "sending")]


def _refundable(p: Entity) -> Any:
    """Сколько ещё можно вернуть с учётом возвратов, которые уже в очереди."""
    if p["status"] in ("held", "pending"):
        return 0
    queued: float = 0
    for o in _open_ops(p):
        if o["kind"] == "refund":
            queued += o.get("amount") or 0
    return max(0, kop(p["capturedAmount"] - p["refundedAmount"] - queued))


def _covers(p: Entity) -> bool:
    """Платёж оплачивает участие или заказ: деньги заморожены или списаны и не возвращаются."""
    if p["status"] not in COVER_STATUSES:
        return False
    pending = _open_ops(p)
    if any(o["kind"] == "cancel" for o in pending):
        return False
    if p["status"] == "held":
        return True
    return _refundable(p) >= p["total"] or any(o["kind"] == "capture" for o in pending)


def _recipient_part(p: Entity) -> Any:
    """Что с этого платежа получит организатор или продавец."""
    return max(0, kop(_refundable(p) - p["fee"]))


def _covering_payment(event_id: ID, user_id: ID) -> Entity | None:
    return next((p for p in _event_payments(event_id, user_id) if _covers(p)), None)


def _pending_payment(kind: str, target_id: ID, user_id: ID) -> Entity | None:
    return next(
        (
            p
            for p in _payments()
            if p["kind"] == kind
            and p["targetId"] == target_id
            and p["userId"] == user_id
            and p["status"] == "pending"
        ),
        None,
    )


def _due_of(participation_id: ID) -> Entity | None:
    items = [x for x in _dues() if x["participationId"] == participation_id]
    found = next((x for x in items if x["status"] in ("open", "paid")), None)
    return found if found is not None else (items[-1] if items else None)


# ---------- Ссылки и названия ----------


def _order_of(id_: ID) -> Entity | None:
    return next((o for o in _orders() if o["id"] == id_), None)


def _target_title(p: Entity) -> str:
    if p["kind"] == "event_share":
        e = db().record("events", p["targetId"])
        return e["title"] if e is not None else "Встреча удалена"
    o = _order_of(p["targetId"])
    return o["itemName"] if o is not None else "Заказ"


def _target_link(p: Entity) -> str:
    return f"/events/{p['targetId']}" if p["kind"] == "event_share" else f"/orders/{p['targetId']}"


def payment_view(p: Entity) -> Entity:
    return {
        "id": p["id"],
        "kind": p["kind"],
        "targetId": p["targetId"],
        "title": _target_title(p),
        "link": _target_link(p),
        "method": p["method"],
        "base": p["base"],
        "fee": p["fee"],
        "total": p["total"],
        "initialTotal": p["initialTotal"],
        "feeParts": p["feeParts"],
        "capture": p["capture"],
        "provider": p["provider"],
        "status": p["status"],
        "capturedAmount": p["capturedAmount"],
        "refundedAmount": p["refundedAmount"],
        "confirmationUrl": p.get("confirmationUrl") if p["status"] == "pending" else None,
        "forfeited": p["forfeited"],
        "test": p["test"],
        "createdAt": p["createdAt"],
        "updatedAt": p["updatedAt"],
        "paidAt": p.get("paidAt"),
        "reason": p["reason"],
        "processing": len(_open_ops(p)) > 0,
    }


def _op_view(o: Entity) -> Entity:
    return {
        k: o.get(k)
        for k in ("id", "kind", "amount", "status", "attempts", "error", "reason", "createdAt", "updatedAt")
    }


def _admin_payment_view(d: "Domain", p: Entity) -> Entity:
    return {
        **payment_view(p),
        "user": d.person(d.user(p["userId"]), True),
        "providerPaymentId": p.get("providerPaymentId"),
        "creditedAt": p.get("creditedAt"),
        "ops": [_op_view(o) for o in _ops() if o.get("paymentId") == p["id"]],
        "refundable": p["total"] if p["status"] == "held" else _refundable(p),
    }


# ---------- Получатели денег ----------


def _owner_key_of(ref: Entity) -> str:
    return f"{ref['kind']}:{ref['id']}"


def _owner_name(ref: Entity) -> str:
    if ref["kind"] == "org":
        o = next((x for x in db().organizations if x["id"] == ref["id"]), None)
        return o["name"] if o is not None else "Организация"
    u = next((x for x in db().users if x["id"] == ref["id"]), None)
    return u["name"] if u is not None else "Пользователь"


def _balance_owner(ref: Entity) -> Entity:
    return {"key": _owner_key_of(ref), "kind": ref["kind"], "id": ref["id"], "name": _owner_name(ref)}


def _money_user_ids(ref: Entity) -> list[ID]:
    """Кому приходят уведомления о деньгах: сам человек или владелец организации."""
    if ref["kind"] == "user":
        return [ref["id"]]
    o = next((x for x in db().organizations if x["id"] == ref["id"]), None)
    return [o["ownerId"]] if o is not None else []


def _manages_money(user: Entity, ref: Entity) -> bool:
    return user["id"] in _money_user_ids(ref)


def _parse_owner(value: Any) -> Entity:
    kind, _, id_ = input_text(value).partition(":")
    if kind == "user" and any(u["id"] == id_ for u in db().users):
        return {"kind": kind, "id": id_}
    if kind != "org" or not any(o["id"] == id_ for o in db().organizations):
        fail("not_found", "Не нашли, чей это баланс")
    return {"kind": kind, "id": id_}


def _contact_of(ref: Entity) -> str | None:
    if ref["kind"] == "org":
        o = next((x for x in db().organizations if x["id"] == ref["id"]), None)
        contacts = (o or {}).get("contacts") or {}
        return contacts.get("phone") or contacts.get("email") or None
    u = next((x for x in db().users if x["id"] == ref["id"]), None)
    return (u or {}).get("phone") or None


def _seller_link(ref: Entity) -> str:
    return f"/orgs/{ref['id']}" if ref["kind"] == "org" else f"/profile/{ref['id']}"


# ---------- Очередь операций ----------


def _enqueue(
    d: "Domain",
    kind: str,
    payment: Entity | None,
    payout: Entity | None,
    amount: Any,
    reason: str,
) -> Entity:
    at = _now_iso()
    id_ = d.participation_host.next_id("pop")
    op = {
        "id": id_,
        "kind": kind,
        "paymentId": payment["id"] if payment is not None else None,
        "payoutId": payout["id"] if payout is not None else None,
        "amount": amount,
        "status": "queued",
        "attempts": 0,
        "idempotenceKey": f"{id_}-{kind}",
        "providerId": None,
        "error": "",
        "reason": reason,
        "createdAt": at,
        "updatedAt": at,
    }
    _ops().append(op)
    # Провайдер fake (стенд без ключей ЮKassa) отвечает сразу.
    if _config["provider"] == "fake" and kind != "payout":
        complete_op(d, op, {"ok": True})
    return op


def complete_op(d: "Domain", op: Entity, result: dict[str, Any]) -> Entity:
    """Итог операции от исполнителя (или сразу у fake). Повторный доклад ничего не меняет.

    `result`: `ok`, `error`, `providerId`, `final` (ЮKassa отказала окончательно — не повторять).
    """
    if op["status"] in ("done", "failed"):
        return op
    op["updatedAt"] = _now_iso()
    if result.get("providerId"):
        op["providerId"] = result["providerId"]
    if not result.get("ok"):
        op["error"] = _clean(result.get("error"), 300) or "ЮKassa не ответила"
        op["status"] = "failed" if result.get("final") or op["attempts"] >= MAX_ATTEMPTS else "queued"
        if op["status"] == "failed" and op["kind"] == "payout" and op.get("payoutId"):
            _payout_failed(d, op["payoutId"], op["error"])
        return op
    op["status"] = "done"
    op["error"] = ""
    p = (
        next((x for x in _payments() if x["id"] == op.get("paymentId")), None)
        if op.get("paymentId")
        else None
    )
    if op["kind"] == "capture" and p is not None:
        p["status"] = "paid"
        p["capturedAmount"] = op["amount"] if op.get("amount") is not None else p["total"]
        if p.get("paidAt") is None:
            p["paidAt"] = op["updatedAt"]
    elif op["kind"] == "cancel" and p is not None:
        if p["status"] == "held":
            p["status"] = "canceled"
    elif op["kind"] == "refund" and p is not None:
        p["refundedAmount"] = kop(p["refundedAmount"] + (op.get("amount") or 0))
        p["status"] = "refunded" if p["refundedAmount"] >= p["capturedAmount"] else "partially_refunded"
    elif op["kind"] == "payout":
        po = next((x for x in _payouts() if x["id"] == op.get("payoutId")), None)
        if po is not None and po["status"] != "done":
            po["status"] = "done"
            po["doneAt"] = op["updatedAt"]
            po["updatedAt"] = op["updatedAt"]
            po["providerPayoutId"] = result.get("providerId") or po.get("providerPayoutId")
            _notify_payout_sent(d, po)
    if p is not None:
        p["updatedAt"] = op["updatedAt"]
    return op


# ---------- Возвраты ----------


def _release_full(d: "Domain", p: Entity, reason: str) -> Any:
    """Вернуть всё (холд — снять). Сбор сервиса тоже возвращается."""
    p["reason"] = reason
    p["updatedAt"] = _now_iso()
    if p["status"] == "pending":
        p["status"] = "canceled"
        return 0
    if p["status"] == "held":
        if not any(o["kind"] == "cancel" for o in _open_ops(p)):
            _enqueue(d, "cancel", p, None, None, reason)
        return p["total"]
    amount = _refundable(p)
    if amount > 0:
        _enqueue(d, "refund", p, None, amount, reason)
    return amount


def _release_base(d: "Domain", p: Entity, reason: str) -> Any:
    """Вернуть долю без сбора сервиса (отмена участником по правилам)."""
    p["reason"] = reason
    p["updatedAt"] = _now_iso()
    amount = min(p["base"], _refundable(p))
    if amount > 0:
        _enqueue(d, "refund", p, None, amount, reason)
    return amount


def _refund_fully(d: "Domain", p: Entity, lead: str, reason: str) -> None:
    """Вернуть всё (холд — снять) и сообщить человеку. `lead` — первое предложение: «Встречу отменили»."""
    was_held = p["status"] == "held"
    amount = _release_full(d, p, reason)
    title = _target_title(p)
    if was_held:
        notify(
            d,
            [p["userId"]],
            "pay_refund",
            "Списания не будет",
            f"{lead}. За «{title}» деньги не спишем: банк снимет заморозку {format_rub(p['total'])} на карте. Обычно это занимает до трёх дней.",
            _target_link(p),
        )
    elif amount > 0:
        notify(
            d,
            [p["userId"]],
            "pay_refund",
            "Деньги вернутся на карту",
            f"{lead}. За «{title}» вернём {format_rub(amount)}. Деньги придут на карту или счёт в течение нескольких дней.",
            _target_link(p),
        )


# ---------- Требование оплаты участия ----------


def ensure_due(d: "Domain", e: Entity, p: Entity) -> Entity | None:
    """Запись попала в состав встречи с оплатой на сайте: появляется срок оплаты (один раз)."""
    if not is_online(e) or _collect_failed(e) or p["status"] != "confirmed":
        return None
    if d.event_state(e) != "upcoming":
        return None
    existing = next(
        (x for x in _dues() if x["participationId"] == p["id"] and x["status"] in ("open", "paid")), None
    )
    if existing is not None:
        return existing
    s = settings_of()
    now = clock.now()
    split = e["price"]["kind"] == "split" and not _collected(e)
    due = {
        "id": d.participation_host.next_id("pdue"),
        "eventId": e["id"],
        "participationId": p["id"],
        "userId": p["userId"],
        "dueAt": clock.iso(_default_due(e, s)),
        "opensAt": clock.iso(_opens_at(e, s)) if split else None,
        "notifiedAt": None,
        "status": "paid" if _covering_payment(e["id"], p["userId"]) is not None else "open",
        "createdAt": clock.iso(now),
    }
    _dues().append(due)
    if due["status"] == "open" and (not split or _opens_at(e, s) <= now):
        _notify_due(d, e, due)
    return due


def _notify_due(d: "Domain", e: Entity, due: Entity) -> None:
    due["notifiedAt"] = _now_iso()
    split = e["price"]["kind"] == "split" and not _collected(e)
    notify(
        d,
        [due["userId"]],
        "pay_due",
        "Открыта оплата складчины" if split else "Оплатите участие",
        f"Оплатите долю за «{e['title']}» до {date_token(due['dueAt'])}. По карте деньги заморозятся, спишем итоговую долю за {settings_of()['collectHoursBefore']} ч до начала."
        if split
        else f"Оплатите участие в «{e['title']}» до {date_token(due['dueAt'])}, иначе место перейдёт другому.",
        f"/events/{e['id']}#pay",
    )


def _close_dues(participation_id: ID) -> None:
    for x in _dues():
        if x["participationId"] == participation_id and x["status"] == "open":
            x["status"] = "closed"


def _drop_participation(d: "Domain", e: Entity, p: Entity) -> None:
    """Снять запись, как отмену: место переходит листу ожидания."""
    host = d.participation_host
    before = host.confirmed_count(e)
    was_confirmed = p["status"] == "confirmed"
    p["status"] = "cancelled"
    p["decidedAt"] = _now_iso()
    p["offer"] = None
    if was_confirmed:
        host.promote_waitlist(e)
    host.after_count_change(e, before)


# ---------- Вид для участника ----------


def _status_from_payment(p: Entity) -> str:
    status = p["status"]
    if status in ("held", "pending", "expired", "canceled"):
        return status
    return "paid" if _covers(p) else "refunded"


HINTS = {
    "not_yet": "Оплата откроется ближе к встрече. Место за вами, мы напомним",
    "required": "Оплатите, чтобы место осталось за вами",
    "pending": "Оплата начата. Если окно банка закрылось, нажмите «Оплатить» ещё раз",
    "held": "Деньги заморожены на карте. Перед встречей спишем итоговую долю, остальное разморозится",
    "paid": "Оплачено",
    "refunded": "Деньги вернули. Они придут на карту или счёт в течение нескольких дней",
    "canceled": "Списания не было",
    "expired": "Оплата не пришла вовремя, запись отменили",
}


def _pay_status_of(e: Entity, mine: Entity) -> str | None:
    pays = _event_payments(e["id"], mine["userId"])
    cover = next((p for p in pays if _covers(p)), None)
    if cover is not None:
        return "held" if cover["status"] == "held" else "paid"
    newest = _newest(pays)
    last = newest[0] if newest else None
    if mine["status"] == "confirmed" and not _collect_failed(e):
        if last is not None and last["status"] == "pending":
            return "pending"
        s = settings_of()
        if e["price"]["kind"] == "split" and not _collected(e) and clock.now() < _opens_at(e, s):
            return "not_yet"
        return "required"
    due = _due_of(mine["id"])
    if (
        due is not None
        and due["status"] == "expired"
        and (last is None or _at(last["createdAt"]) <= _at(due["dueAt"]) + GRACE)
    ):
        return "expired"
    if last is not None:
        return _status_from_payment(last)
    return "canceled" if _collect_failed(e) and mine["status"] == "confirmed" else None


def my_payment_of(d: "Domain", e: Entity, mine: Entity | None) -> Entity | None:
    """`my.payment` в карточке встречи."""
    if mine is None or not is_online(e):
        return None
    status = _pay_status_of(e, mine)
    if status is None:
        return None
    s = settings_of()
    kind = _price_kind(e)
    pays = _event_payments(e["id"], mine["userId"])
    shown = next((p for p in pays if _covers(p)), None)
    if shown is None:
        newest = _newest(pays)
        shown = newest[0] if newest else None
    due = _due_of(mine["id"])
    upcoming = d.event_state(e) == "upcoming"
    can_pay = mine["status"] == "confirmed" and upcoming and status in ("required", "pending")
    hint = HINTS[status]
    if status == "paid" and kind == "fixed":
        hint = "Оплачено. Если отмените запись вовремя, вернём цену участия"
    if status == "paid" and kind == "split" and not _collected(e):
        hint = "Оплачено. Если оплатят больше человек, после сбора вернём разницу"
    if status == "required" and kind == "split" and not _collected(e):
        hint = "Оплатите долю. По карте деньги заморозятся, перед встречей спишем итоговую долю"
    if _collect_failed(e):
        hint = "Порог не набрался, оплату на сайте закрыли. Уточните у организатора, состоится ли встреча"
    if mine["status"] == "confirmed":
        due_at = due["dueAt"] if due is not None else clock.iso(_default_due(e, s))
    else:
        due_at = due["dueAt"] if due is not None else None
    return {
        "status": status,
        "priceKind": kind,
        "base": shown["base"] if shown is not None and _covers(shown) else _current_base(e),
        "maxShare": _max_share_of(e) if kind == "split" else None,
        "finalShare": e["payCollect"].get("share") if _collected(e) else None,
        "opensAt": clock.iso(_opens_at(e, s)) if kind == "split" and not _collected(e) else None,
        "dueAt": due_at,
        "collectAt": clock.iso(_collect_at(e, s)) if kind == "split" else None,
        "payment": payment_view(shown) if shown is not None else None,
        "canPay": can_pay and not _collect_failed(e),
        "hint": hint,
    }


# ---------- Правка события ----------


def _same_amount(a: Any, b: Any) -> bool:
    """Одна и та же сумма; без суммы — не та же."""
    x = parse_number(a)
    return x is not None and x == parse_number(b)


def _same_price(a: Entity, b: Entity) -> bool:
    """Та же сумма: цена с человека или сумма складчины (пояснение не важно)."""
    if not isinstance(a, dict) or a.get("kind") != b.get("kind"):
        return False
    if a.get("kind") == "fixed":
        return _same_amount(a.get("amount"), b.get("amount"))
    if a.get("kind") == "split":
        return _same_amount(a.get("total"), b.get("total"))
    return True


def _has_money(e: Entity) -> bool:
    """Есть ли у встречи деньги на сайте: оплаты, холды или начатые платежи."""
    return any(p["status"] == "pending" or _covers(p) for p in _event_payments(e["id"]))


def payment_mode_errors(d: "Domain", e: Entity | None, next_: dict[str, Any]) -> dict[str, str]:
    """Проверка поля `paymentMode` при создании (`e` = None) и правке. `next_` — поля запроса."""
    errors: dict[str, str] = {}
    if "paymentMode" in next_ and next_["paymentMode"] not in ("offline", "online"):
        errors["paymentMode"] = "Выберите, как платить: на месте или на сайте"
        return errors
    mode = next_.get("paymentMode") or (e.get("paymentMode") if e is not None else None) or "offline"
    if provider_name() == "disabled" and mode == "online":
        return {"paymentMode": "Оплата на сайте отключена. Выберите оплату на месте"}
    price = next_.get("price") if next_.get("price") is not None else (e["price"] if e is not None else None)
    if "minParticipants" in next_:
        min_ = next_["minParticipants"]
    else:
        min_ = e.get("minParticipants") if e is not None else None
    if mode == "online" and isinstance(price, dict):
        if price.get("kind") == "free":
            errors["paymentMode"] = "Оплата на сайте нужна только для платной встречи"
        elif price.get("kind") == "split" and not min_:
            errors["paymentMode"] = (
                "Для складчины с оплатой на сайте укажите, от скольких человек встреча состоится: "
                "по этому числу считается наибольшая доля"
            )
    if e is None or errors.get("paymentMode"):
        return errors
    was = e.get("paymentMode") or "offline"
    confirmed = d.participation_host.confirmed_count(e)
    if was == "offline" and mode == "online" and confirmed > 0:
        errors["paymentMode"] = "Оплату на сайте можно включить, пока на встречу никто не записан"
    price_changed = next_.get("price") is not None and not _same_price(next_["price"], e["price"])
    min_changed = (
        e["price"]["kind"] == "split"
        and "minParticipants" in next_
        and next_["minParticipants"] != e.get("minParticipants")
    )
    if was == "online" and (mode != "online" or price_changed or min_changed) and _has_money(e):
        errors["paymentMode"] = (
            "Уже есть оплаты на сайте, поэтому цену и способ оплаты менять нельзя. "
            "Если нужно, отмените встречу: деньги вернутся"
        )
    return errors


def payment_mode_of(input_: dict[str, Any]) -> str:
    return "online" if input_.get("paymentMode") == "online" else "offline"


# ---------- Точки в правилах записи ----------


@_enabled_hook
def on_confirmed(d: "Domain", e: Entity, p: Entity) -> None:
    """Запись или одобрение заявки: появляется срок оплаты."""
    ensure_due(d, e, p)


@_enabled_hook
def on_left(d: "Domain", e: Entity, p: Entity, *, late: bool, rescheduled: bool) -> None:
    """Участник отменил запись. `late` — позже срока бесплатной отмены, `rescheduled` — после переноса."""
    if not is_online(e):
        return
    _close_dues(p["id"])
    for pay in _event_payments(e["id"], p["userId"]):
        if pay["status"] == "pending":
            pay["status"] = "canceled"
            pay["reason"] = "Запись отменена"
            pay["updatedAt"] = _now_iso()
            continue
        if not _covers(pay):
            continue
        if rescheduled:
            _refund_fully(d, pay, "Встречу перенесли, и вы отменили запись", "Встречу перенесли")
        elif late:
            pay["forfeited"] = True
            pay["updatedAt"] = _now_iso()
        elif pay["status"] == "held":
            _refund_fully(d, pay, "Вы отменили запись", "Участник отменил запись")
        else:
            amount = _release_base(d, pay, "Участник отменил запись")
            if amount > 0:
                fee = (
                    f", сбор сервиса {format_rub(pay['fee'])} не возвращается: он ушёл на комиссию банка"
                    if pay["fee"] > 0
                    else ""
                )
                notify(
                    d,
                    [pay["userId"]],
                    "pay_refund",
                    "Деньги вернутся на карту",
                    f"Вы отменили запись на «{e['title']}». Вернём {format_rub(amount)}{fee}. Деньги придут в течение нескольких дней.",
                    f"/events/{e['id']}",
                )


@_enabled_hook
def on_event_canceled(d: "Domain", e: Entity, lead: str = "Встречу отменили") -> None:
    """Встречу отменили (организатор) или удалили (администратор): все деньги возвращаются полностью."""
    for pay in _event_payments(e["id"]):
        if pay["status"] == "pending":
            pay["status"] = "canceled"
            pay["reason"] = "Встреча отменена"
            pay["updatedAt"] = _now_iso()
        elif _covers(pay):
            _refund_fully(d, pay, lead, "Встреча отменена")
    for x in _dues():
        if x["eventId"] == e["id"] and x["status"] == "open":
            x["status"] = "closed"


@_enabled_hook
def on_removed(d: "Domain", e: Entity, p: Entity) -> None:
    """Организатор убрал человека из участников: деньги возвращаются полностью."""
    if not is_online(e):
        return
    _close_dues(p["id"])
    for pay in _event_payments(e["id"], p["userId"]):
        if pay["status"] == "pending":
            pay["status"] = "canceled"
            pay["reason"] = "Организатор убрал из участников"
            pay["updatedAt"] = _now_iso()
        elif _covers(pay):
            _refund_fully(d, pay, "Организатор убрал вас из участников", "Организатор убрал из участников")


# ---------- Платёж ----------


def _require_method(value: Any) -> str:
    s = settings_of()
    if value not in ("sbp", "bank_card"):
        fail("validation", "Выберите способ оплаты", {"method": "Выберите СБП или карту"})
    if value not in s["methods"]:
        fail("validation", "Этот способ сейчас недоступен", {"method": "Выберите другой способ"})
    return value


def _event_charge(d: "Domain", user: Entity, event_id: ID, method: str) -> Entity:
    """Что и сколько платит человек за встречу: проверки до создания платежа."""
    e = get_event(event_id)
    if not is_online(e):
        fail("payment_not_required", "За эту встречу платят на месте или переводом организатору")
    mine = next(
        (p for p in db().participations if p["eventId"] == e["id"] and p["userId"] == user["id"]), None
    )
    if mine is None or mine["status"] != "confirmed":
        fail(
            "payment_not_required",
            "Оплатить можно, когда организатор примет заявку"
            if mine is not None and mine["status"] == "pending"
            else "Оплатить можно после записи на встречу",
        )
    if d.event_state(e) != "upcoming":
        fail("payment_closed", "Встреча уже началась, оплатить на сайте нельзя")
    if _collect_failed(e):
        fail("payment_closed", "Порог не набрался, оплату на сайте закрыли")
    if _covering_payment(e["id"], user["id"]) is not None:
        fail("payment_not_required", "Участие уже оплачено")
    s = settings_of()
    split = e["price"]["kind"] == "split" and not _collected(e)
    if split and clock.now() < _opens_at(e, s):
        days = s["splitOpenDays"]
        fail(
            "payment_not_open",
            f"Оплата откроется за {days} {plural(days, WORDS['day'])} до встречи. Место за вами",
        )
    return {"base": _current_base(e), "markup": 0, "capture": not (split and method == "bank_card")}


def _order_charge(user: Entity, order_id: ID) -> Entity:
    order = _order_of(order_id)
    if order is None:
        fail("not_found", "Заказ не найден")
    if order["buyerId"] != user["id"]:
        fail("forbidden", "Оплатить заказ может только покупатель")
    if order["status"] in ("paid", "received"):
        fail("payment_not_required", "Заказ уже оплачен")
    if order["status"] != "awaiting_payment":
        fail("payment_closed", "Заказ отменён")
    if _at(order["payDueAt"]) <= clock.now():
        fail("payment_closed", "Время на оплату вышло. Купите вещь заново")
    return {"base": order["amount"], "markup": settings_of()["goodsMarkup"], "capture": True}


@_enabled_action
def start_payment(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    """POST /payments: создать платёж (или вернуть начатый тем же способом)."""
    user = require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "Администратор не платит за участие")
    kind = input_.get("kind")
    if kind not in ("event_share", "item_order"):
        fail("bad_request", "Неизвестно, за что платёж")
    target_id = input_text(input_.get("targetId"))
    method = _require_method(input_.get("method"))
    charge = (
        _event_charge(d, user, target_id, method) if kind == "event_share" else _order_charge(user, target_id)
    )
    s = settings_of()
    now = clock.now()
    started = _pending_payment(kind, target_id, user["id"])
    if started is not None:
        fresh = now - _at(started["createdAt"]) < timedelta(minutes=s["pendingMinutes"])
        if fresh and started["method"] == method and started["base"] == charge["base"]:
            return payment_view(started)
        started["status"] = "canceled"
        started["reason"] = "Начат новый платёж"
        started["updatedAt"] = clock.iso(now)
    q = quote(charge["base"], method, s, charge["markup"])
    id_ = d.participation_host.next_id("pay")
    at = clock.iso(now)
    p = {
        "id": id_,
        "userId": user["id"],
        "kind": kind,
        "targetId": target_id,
        "method": method,
        "base": q["base"],
        "fee": q["fee"],
        "total": q["total"],
        "feeParts": q["feeParts"],
        "initialTotal": q["total"],
        "capture": charge["capture"],
        "provider": _config["provider"],
        "providerPaymentId": None,
        "status": "pending",
        "capturedAmount": 0,
        "refundedAmount": 0,
        "confirmationUrl": f"/pay/fake/{id_}" if _config["provider"] == "fake" else None,
        "forfeited": False,
        "creditedAt": None,
        "test": _config["test"],
        "createdAt": at,
        "updatedAt": at,
        "paidAt": None,
        "reason": "",
    }
    _payments().append(p)
    if kind == "item_order":
        _order_of(target_id)["paymentId"] = id_  # type: ignore[index]
    commit(["payments", "events"])
    return payment_view(p)


def find_payment(id_: ID) -> Entity | None:
    return next((x for x in _payments() if x["id"] == id_), None)


def _own_payment(actor: Actor, id_: ID) -> tuple[Entity, Entity]:
    user = require_user(actor)
    p = find_payment(id_)
    # Чужой платёж не отличить от несуществующего
    if p is None or (p["userId"] != user["id"] and user["role"] != "admin"):
        fail("not_found", "Платёж не найден")
    return user, p


def get_payment(actor: Actor, id_: ID) -> Entity:
    return payment_view(_own_payment(actor, id_)[1])


def my_payments(actor: Actor) -> list[Entity]:
    user = require_user(actor)
    return [payment_view(p) for p in _newest([p for p in _payments() if p["userId"] == user["id"]])]


CANCEL_REASONS = {
    "expired_on_confirmation": "Оплату не завершили вовремя",
    "expired_on_capture": "Заморозка истекла, банк вернул деньги",
    "insufficient_funds": "Не хватило денег на карте",
    "card_expired": "Срок действия карты истёк",
    "payment_method_restricted": "Банк не пропустил оплату",
    "rejected_by_payee": "Платёж отменён",
    "canceled_by_merchant": "Платёж отменён",
    "general_decline": "Банк отклонил оплату",
}


def sync_payment(d: "Domain", p: Entity, remote: dict[str, Any]) -> Entity:
    """Статус от провайдера (уведомление, перезапрос, тестовая страница). Только вперёд, повтор безопасен.

    `remote`: `status` (`pending | waiting_for_capture | succeeded | canceled`), `amount`, `reason`,
    `providerPaymentId`.
    """
    at = _now_iso()
    if remote.get("providerPaymentId") and not p.get("providerPaymentId"):
        p["providerPaymentId"] = remote["providerPaymentId"]
    status = remote.get("status")
    from_waiting = p["status"] in ("pending", "expired", "canceled")
    if status == "waiting_for_capture" and from_waiting and not p["capturedAmount"]:
        # Отменённый у нас платёж (человек передумал) всё же заморозил деньги — снимем заморозку в _on_paid
        p["status"] = "held"
        p["updatedAt"] = at
        _on_paid(d, p)
    elif status == "succeeded" and (from_waiting or p["status"] == "held"):
        was_held = p["status"] == "held"
        p["status"] = "paid"
        p["capturedAmount"] = remote["amount"] if remote.get("amount") is not None else p["total"]
        if p.get("paidAt") is None:
            p["paidAt"] = at
        p["updatedAt"] = at
        for op in _open_ops(p):
            if op["kind"] == "capture":
                complete_op(d, op, {"ok": True})
        if not was_held:
            _on_paid(d, p)
    elif status == "canceled" and p["status"] in ("pending", "held", "expired"):
        p["status"] = "canceled"
        p["reason"] = CANCEL_REASONS.get(remote.get("reason") or "") or p["reason"] or "Оплата не прошла"
        p["updatedAt"] = at
        for op in _open_ops(p):
            if op["kind"] in ("cancel", "capture"):
                complete_op(d, op, {"ok": op["kind"] == "cancel", "final": True, "error": p["reason"]})
    commit(["payments", "events", "participations", "notifications", "inventory"])
    return payment_view(p)


def _on_paid(d: "Domain", p: Entity) -> None:
    """Деньги пришли (или заморожены): отметить срок, заказ, уведомить. Опоздавшая оплата возвращается."""
    if p["kind"] == "item_order":
        _on_order_paid(d, p)
        return
    e = db().record("events", p["targetId"])
    mine = (
        next((x for x in db().participations if x["eventId"] == e["id"] and x["userId"] == p["userId"]), None)
        if e is not None
        else None
    )
    other = (
        next((x for x in _event_payments(e["id"], p["userId"]) if x["id"] != p["id"] and _covers(x)), None)
        if e is not None
        else None
    )
    valid = (
        e is not None
        and mine is not None
        and mine["status"] == "confirmed"
        and d.event_state(e) == "upcoming"
        and not _collect_failed(e)
        and other is None
    )
    if e is None or mine is None or not valid:
        _refund_fully(d, p, "Запись уже не действует", "Запись уже не действует")
        return
    for x in _dues():
        if x["participationId"] == mine["id"] and x["status"] == "open":
            x["status"] = "paid"
    if _collected(e):
        _settle_share(d, p, e["payCollect"]["share"])
    notify(
        d,
        [p["userId"]],
        "pay_received",
        "Оплата получена",
        f"Деньги за «{e['title']}» заморожены на карте: {format_rub(p['total'])}. Перед встречей спишем итоговую долю, остальное разморозится."
        if p["status"] == "held"
        else f"Оплата за «{e['title']}» получена: {format_rub(p['capturedAmount'] or p['total'])}. Ждём вас {date_token(e['startsAt'])}.",
        f"/events/{e['id']}",
    )


@_enabled_action
def fake_outcome(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    """POST /payments/:id/fake: тестовая страница оплаты."""
    user, p = _own_payment(actor, id_)
    if p["userId"] != user["id"]:
        fail("forbidden", "Оплатить может только тот, кто начал платёж")
    if p["provider"] != "fake" or _config["provider"] != "fake":
        fail("forbidden", "Тестовая оплата выключена")
    if p["status"] != "pending":
        return payment_view(p)
    if input_.get("outcome") == "succeeded":
        return sync_payment(
            d, p, {"status": "succeeded" if p["capture"] else "waiting_for_capture", "amount": p["total"]}
        )
    if input_.get("outcome") != "canceled":
        fail("bad_request", "Выберите: оплатить или отказаться")
    p["status"] = "canceled"
    p["reason"] = "Вы отказались от оплаты"
    p["updatedAt"] = _now_iso()
    commit(["payments", "events"])
    return payment_view(p)


# ---------- Складчина ----------


def _settle_share(d: "Domain", p: Entity, share: int) -> tuple[Any, Any]:
    """После сбора: у платежа итоговая доля; холд списывается, по СБП возвращается разница."""
    q = quote(share, p["method"], settings_of(), 0)
    p["base"] = q["base"]
    p["fee"] = q["fee"]
    p["total"] = q["total"]
    p["feeParts"] = q["feeParts"]
    p["updatedAt"] = _now_iso()
    if p["status"] == "held":
        _enqueue(d, "capture", p, None, q["total"], "Сбор складчины")
        return q["total"], kop(p["initialTotal"] - q["total"])
    extra = kop(_refundable(p) - q["total"])
    if extra > 0:
        _enqueue(d, "refund", p, None, extra, "Разница после сбора складчины")
    return q["total"], max(0, extra)


def _collect_split(d: "Domain", e: Entity) -> None:
    if e["price"]["kind"] != "split":
        return
    min_ = _min_participants(e)
    pays = [p for p in _event_payments(e["id"]) if _covers(p)]
    paid_count = len({p["userId"] for p in pays})
    at = _now_iso()
    organizers = d.participation_host.organizer_user_ids(e)
    if paid_count >= min_:
        share = split_final_share(e["price"]["total"], paid_count)
        e["payCollect"] = {"at": at, "outcome": "collected", "share": share, "paidCount": paid_count}
        for p in pays:
            charged, returned = _settle_share(d, p, share)
            rest = ""
            if returned > 0:
                rest = (
                    ", остальное разморозится"
                    if p["method"] == "bank_card"
                    else f", разницу {format_rub(returned)} вернём"
                )
            notify(
                d,
                [p["userId"]],
                "pay_collected",
                "Складчина собрана",
                f"«{e['title']}»: оплатили {paid_count} человек, ваша доля {format_rub(share)}. Списали {format_rub(charged)}{rest}.",
                f"/events/{e['id']}",
            )
        notify(
            d,
            organizers,
            "pay_collected",
            "Складчина собрана",
            f"«{e['title']}»: оплатили {paid_count} человек по {format_rub(share)}. Деньги придут на баланс после встречи.",
            f"/events/{e['id']}/manage#money",
        )
    else:
        e["payCollect"] = {"at": at, "outcome": "failed", "share": None, "paidCount": paid_count}
        for p in pays:
            _refund_fully(d, p, f"Порог не набрался: оплатили {paid_count} из {min_}", "Порог не набрался")
        notify(
            d,
            organizers,
            "pay_failed",
            "Порог не набрался",
            f"«{e['title']}»: к сбору оплатили {paid_count} из {min_}. Оплаты вернули. Решите, проводить ли встречу, и напишите участникам.",
            f"/events/{e['id']}/manage#money",
        )
    for x in _dues():
        if x["eventId"] == e["id"] and x["status"] == "open":
            x["status"] = "closed"
    e["updatedAt"] = at


# ---------- Зачисления ----------


def _add_credit(
    d: "Domain", recipient: Entity, amount: Any, source: str, target_id: ID, title: str
) -> Entity:
    c = {
        "id": d.participation_host.next_id("cr"),
        "recipient": dict(recipient),
        "amount": kop(amount),
        "source": source,
        "targetId": target_id,
        "title": title,
        "at": _now_iso(),
    }
    if not _config["test"] and _config["provider"] == "yookassa":
        c["live"] = True
    _credits().append(c)
    return c


def _credit_event(d: "Domain", e: Entity) -> bool:
    ready = [
        p
        for p in _event_payments(e["id"])
        if not p.get("creditedAt") and p["status"] in ("paid", "partially_refunded") and not _open_ops(p)
    ]
    if not ready:
        return False
    amount = add([_recipient_part(p) for p in ready])
    for p in ready:
        p["creditedAt"] = _now_iso()
    if amount > 0:
        _add_credit(d, e["organizer"], amount, "event", e["id"], e["title"])
        notify(
            d,
            _money_user_ids(e["organizer"]),
            "money_credited",
            "Деньги зачислены",
            f"За «{e['title']}» зачислено {format_rub(amount)}. Вывести их можно в разделе «Деньги».",
            "/me/money",
        )
    return True


# ---------- Вещи с полки ----------


def sale_errors(input_: dict[str, Any]) -> dict[str, str]:
    """Поле `sale` в форме вещи: цена за штуку или null."""
    sale = input_.get("sale")
    if sale is None:
        return {}
    price = parse_number(sale.get("price")) if isinstance(sale, dict) else None
    if not isinstance(price, int) or not SALE_MIN <= price <= SALE_MAX:
        return {"sale": f"Укажите цену от {SALE_MIN} до {format_number(SALE_MAX)} ₽ целым числом"}
    return {}


def clean_sale(value: Any) -> Entity | None:
    if not isinstance(value, dict):
        return None
    return {"price": parse_number(value.get("price"))}


def assert_no_open_orders(item: Entity) -> None:
    """Убрать вещь с полки нельзя, пока её покупают."""
    if any(o["itemId"] == item["id"] and o["status"] in OPEN_ORDER for o in _orders()):
        fail("bad_state", "Эту вещь сейчас покупают. Завершите или отмените заказ, потом уберите вещь")


def _shelf_item_of(id_: ID) -> Entity | None:
    return next((i for i in db().inventory.shelf if i["id"] == id_), None)


def _loans_in_use(item_id: ID) -> int:
    return sum(
        loan["quantity"]
        for loan in db().inventory.loans
        if loan["itemId"] == item_id and loan["status"] == "accepted"
    )


def _restore_item(order: Entity) -> None:
    item = _shelf_item_of(order["itemId"])
    if item is not None:
        item["quantity"] += order["quantity"]


def _order_view(d: "Domain", actor: Entity, o: Entity) -> Entity:
    is_buyer = o["buyerId"] == actor["id"]
    is_seller = _manages_money(actor, o["seller"])
    pay = find_payment(o["paymentId"]) if o.get("paymentId") else None
    open_ = o["status"] in ("paid", "received")
    buyer = d.user(o["buyerId"])
    counterpart = None
    if open_ and is_buyer:
        counterpart = {
            "name": _owner_name(o["seller"]),
            "contact": _contact_of(o["seller"]),
            "link": _seller_link(o["seller"]),
        }
    elif open_ and is_seller:
        counterpart = {
            "name": buyer["name"] if buyer is not None else "Покупатель",
            "contact": (buyer or {}).get("phone") or None,
            "link": f"/profile/{o['buyerId']}",
        }
    return {
        **o,
        "buyer": d.person(buyer, True),
        "sellerView": {
            "kind": o["seller"]["kind"],
            "id": o["seller"]["id"],
            "name": _owner_name(o["seller"]),
            "link": _seller_link(o["seller"]),
        },
        "payment": payment_view(pay) if pay is not None and (is_buyer or actor["role"] == "admin") else None,
        "isBuyer": is_buyer,
        "isSeller": is_seller,
        "counterpart": counterpart,
        "can": {
            "pay": is_buyer and o["status"] == "awaiting_payment" and _at(o["payDueAt"]) > clock.now(),
            "received": is_buyer and o["status"] == "paid",
            "cancel": (is_buyer or is_seller) and o["status"] in OPEN_ORDER,
        },
    }


@_enabled_action
def buy_item(d: "Domain", actor: Actor, item_id: ID, input_: dict[str, Any]) -> Entity:
    """POST /shelf/:id/buy: заказ резервирует штуки на полке, оплата — POST /payments."""
    user = require_user(actor)
    if user["role"] == "admin":
        fail("forbidden", "Администратор не покупает вещи")
    item = _shelf_item_of(item_id)
    if item is None:
        fail("not_found", "Этой вещи уже нет на полке")
    if item.get("sale") is None:
        fail("not_for_sale", "Эта вещь не продаётся. Её можно попросить на время")
    if _manages_money(user, item["owner"]):
        fail("bad_request", "Это ваша вещь")
    quantity = 1 if "quantity" not in input_ else parse_number(input_.get("quantity"))
    free = max(0, item["quantity"] - _loans_in_use(item["id"]))
    if not isinstance(quantity, int) or quantity < 1:
        fail("validation", "Укажите, сколько штук", {"quantity": "Хотя бы одна штука"})
    waiting = next(
        (
            o
            for o in _orders()
            if o["itemId"] == item["id"] and o["buyerId"] == user["id"] and o["status"] == "awaiting_payment"
        ),
        None,
    )
    if waiting is not None:
        return _order_view(d, user, waiting)
    if quantity > free:
        fail(
            "full",
            f"Сейчас есть только {free} шт." if free else "Все штуки уже купили",
            {"quantity": f"Не больше {free}"},
        )
    s = settings_of()
    now = clock.now()
    at = clock.iso(now)
    price = item["sale"]["price"]
    order = {
        "id": d.participation_host.next_id("ord"),
        "itemId": item["id"],
        "itemName": item["name"],
        "buyerId": user["id"],
        "seller": dict(item["owner"]),
        "quantity": quantity,
        "price": price,
        "amount": price * quantity,
        "paymentId": None,
        "status": "awaiting_payment",
        "payDueAt": clock.iso(now + timedelta(minutes=s["holdMinutes"])),
        "autoCompleteAt": None,
        "createdAt": at,
        "updatedAt": at,
        "paidAt": None,
        "receivedAt": None,
        "canceledAt": None,
        "canceledBy": None,
        "reason": "",
    }
    _orders().append(order)
    item["quantity"] -= quantity
    item["updatedAt"] = at
    commit(["payments", "inventory"])
    return _order_view(d, user, order)


def _on_order_paid(d: "Domain", p: Entity) -> None:
    order = _order_of(p["targetId"])
    if order is None or order["status"] != "awaiting_payment":
        _refund_fully(d, p, "Заказ уже отменён", "Заказ отменён")
        return
    s = settings_of()
    now = clock.now()
    order["status"] = "paid"
    order["paymentId"] = p["id"]
    order["paidAt"] = clock.iso(now)
    order["autoCompleteAt"] = clock.iso(now + timedelta(days=s["autoCompleteDays"]))
    order["updatedAt"] = order["paidAt"]
    buyer = d.user(order["buyerId"])
    notify(
        d,
        _money_user_ids(order["seller"]),
        "order_paid",
        "Покупатель оплатил вещь",
        f"{buyer['name'] if buyer is not None else 'Покупатель'} оплатил «{order['itemName']}», {order['quantity']} шт., {format_rub(order['amount'])}. Договоритесь о передаче: контакты в заказе. Деньги придут, когда покупатель нажмёт «Получил», или через {s['autoCompleteDays']} дня.",
        f"/orders/{order['id']}",
    )
    notify(
        d,
        [order["buyerId"]],
        "pay_received",
        "Оплата получена",
        f"Оплата за «{order['itemName']}» получена. Договоритесь с продавцом о передаче, контакты в заказе. Когда заберёте вещь, нажмите «Получил».",
        f"/orders/{order['id']}",
    )


def _complete_order(d: "Domain", order: Entity, auto: bool) -> None:
    at = _now_iso()
    order["status"] = "received"
    order["receivedAt"] = at
    order["updatedAt"] = at
    p = find_payment(order["paymentId"]) if order.get("paymentId") else None
    amount: Any = 0
    if p is not None and not p.get("creditedAt"):
        amount = _recipient_part(p)
        p["creditedAt"] = at
        if amount > 0:
            _add_credit(d, order["seller"], amount, "order", order["id"], order["itemName"])
    item = _shelf_item_of(order["itemId"])
    if (
        item is not None
        and item["quantity"] <= 0
        and _loans_in_use(item["id"]) == 0
        and not any(o["itemId"] == item["id"] and o["status"] in OPEN_ORDER for o in _orders())
    ):
        inv = db().inventory
        inv.shelf = [x for x in inv.shelf if x["id"] != item["id"]]
    days = settings_of()["autoCompleteDays"]
    lead = (
        f"Прошло {days} дня после оплаты «{order['itemName']}»"
        if auto
        else f"Покупатель получил «{order['itemName']}»"
    )
    notify(
        d,
        _money_user_ids(order["seller"]),
        "order_done",
        "Деньги за вещь зачислены" if auto else "Покупатель получил вещь",
        f"{lead}. На баланс зачислено {format_rub(amount)}.",
        "/me/money",
    )


def _get_order(actor: Actor, id_: ID) -> tuple[Entity, Entity]:
    user = require_user(actor)
    order = _order_of(id_)
    if order is None or (
        order["buyerId"] != user["id"]
        and not _manages_money(user, order["seller"])
        and user["role"] != "admin"
    ):
        fail("not_found", "Заказ не найден")
    return user, order


def order_details(d: "Domain", actor: Actor, id_: ID) -> Entity:
    user, order = _get_order(actor, id_)
    return _order_view(d, user, order)


def list_orders(d: "Domain", actor: Actor, q: dict[str, Any]) -> list[Entity]:
    user = require_user(actor)
    seller = q.get("role") == "seller"
    rows = [
        o for o in _orders() if (_manages_money(user, o["seller"]) if seller else o["buyerId"] == user["id"])
    ]
    return [_order_view(d, user, o) for o in _newest(rows)]


def mark_received(d: "Domain", actor: Actor, id_: ID) -> Entity:
    user, order = _get_order(actor, id_)
    if order["buyerId"] != user["id"]:
        fail("forbidden", "Отметить получение может только покупатель")
    if order["status"] == "received":
        return _order_view(d, user, order)
    if order["status"] != "paid":
        fail("bad_state", "Сначала оплатите заказ")
    _complete_order(d, order, False)
    commit(["payments", "inventory", "notifications"])
    return _order_view(d, user, order)


def cancel_order(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    user, order = _get_order(actor, id_)
    is_buyer = order["buyerId"] == user["id"]
    is_seller = _manages_money(user, order["seller"])
    if not is_buyer and not is_seller and user["role"] != "admin":
        fail("forbidden", "Отменить заказ могут покупатель и продавец")
    if order["status"] in ("canceled", "refunded"):
        return _order_view(d, user, order)
    if order["status"] == "received":
        fail("bad_state", "Вещь уже получена, отменить заказ нельзя")
    reason = _clean(input_.get("reason"), 300)
    at = _now_iso()
    pay = find_payment(order["paymentId"]) if order.get("paymentId") else None
    was_paid = order["status"] == "paid"
    order["status"] = "refunded" if was_paid else "canceled"
    order["canceledAt"] = at
    order["canceledBy"] = "buyer" if is_buyer else "seller" if is_seller else "admin"
    order["reason"] = reason
    order["updatedAt"] = at
    _restore_item(order)
    for p in [x for x in _payments() if x["kind"] == "item_order" and x["targetId"] == order["id"]]:
        if p["status"] == "pending":
            p["status"] = "canceled"
            p["reason"] = "Заказ отменён"
            p["updatedAt"] = at
        elif _covers(p):
            _refund_fully(d, p, "Заказ отменён", "Заказ отменён")
    who = "Покупатель" if is_buyer else "Продавец" if is_seller else "Администратор"
    to = _money_user_ids(order["seller"]) if is_buyer else [order["buyerId"]]
    tail = " Деньги вернутся покупателю полностью." if was_paid and pay is not None else ""
    notify(
        d,
        to,
        "order_canceled",
        "Заказ отменён",
        f"{who} отменил заказ «{order['itemName']}»{f': {reason}' if reason else '.'}{tail}",
        f"/orders/{order['id']}",
    )
    commit(["payments", "inventory", "notifications"])
    return _order_view(d, user, order)


# ---------- Балансы и выплаты ----------


def _same_ref(a: Entity, b: Entity) -> bool:
    return a["kind"] == b["kind"] and a["id"] == b["id"]


def _credits_of(ref: Entity) -> list[Entity]:
    return [c for c in _credits() if _same_ref(c["recipient"], ref)]


def _payouts_of(ref: Entity) -> list[Entity]:
    return [x for x in _payouts() if _same_ref(x["recipient"], ref)]


def _pending_of(ref: Entity) -> list[Entity]:
    out: list[Entity] = []
    table = COLLECTIONS["events"].table
    events = db().records(
        "events",
        table.c.payment_mode == "online",
        table.c.organizer_kind == ref["kind"],
        table.c.organizer_id == ref["id"],
        predicate=lambda event: is_online(event) and _same_ref(event["organizer"], ref),
    )
    for e in events:
        if not _same_ref(e["organizer"], ref) or not is_online(e):
            continue
        if e["status"] not in ("published", "removed"):
            continue
        amount = add(
            [
                p["base"] if p["status"] == "held" else _recipient_part(p)
                for p in _event_payments(e["id"])
                if not p.get("creditedAt") and _covers(p)
            ]
        )
        if amount > 0:
            out.append(
                {
                    "source": "event",
                    "targetId": e["id"],
                    "title": e["title"],
                    "amount": amount,
                    "availableAt": clock.iso(_end(e)),
                    "link": f"/events/{e['id']}/manage#money",
                }
            )
    for o in _orders():
        if not _same_ref(o["seller"], ref) or o["status"] != "paid":
            continue
        out.append(
            {
                "source": "order",
                "targetId": o["id"],
                "title": o["itemName"],
                "amount": o["amount"],
                "availableAt": o.get("autoCompleteAt"),
                "link": f"/orders/{o['id']}",
            }
        )
    return sorted(out, key=lambda x: x["availableAt"] or "")


def _available_of(ref: Entity) -> Any:
    # Боевой магазин: к выводу только деньги настоящих платежей. Зачисления из демо-данных и тестового
    # режима (без отметки live) в баланс не входят, чтобы их нельзя было вывести настоящими деньгами.
    live = not _config["test"] and _config["provider"] == "yookassa"
    credited = add([c["amount"] for c in _credits_of(ref) if not live or c.get("live")])
    out = add(
        [x["amount"] for x in _payouts_of(ref) if x["status"] != "failed" and (not live or x.get("live"))]
    )
    return max(0, kop(credited - out))


def _summary_of(ref: Entity) -> Entity:
    return {
        "owner": _balance_owner(ref),
        "available": _available_of(ref),
        "pending": add([x["amount"] for x in _pending_of(ref)]),
    }


def _payout_view(po: Entity) -> Entity:
    return {**po, "owner": _balance_owner(po["recipient"]), "phoneMasked": _mask_phone(po["phone"])}


def my_balances(_d: "Domain", actor: Actor) -> list[Entity]:
    """Чьи балансы видит человек: свой и организаций, где он владелец."""
    user = require_user(actor)
    refs = [{"kind": "user", "id": user["id"]}]
    refs.extend({"kind": "org", "id": o["id"]} for o in db().organizations if o["ownerId"] == user["id"])
    return [_summary_of(r) for r in refs]


def balance_view(_d: "Domain", actor: Actor, owner_key: Any) -> Entity:
    user = require_user(actor)
    ref = _parse_owner(owner_key)
    if not _manages_money(user, ref) and user["role"] != "admin":
        fail("forbidden", "Баланс видит только его владелец")
    s = settings_of()
    summary = _summary_of(ref)
    items = _newest(_payouts_of(ref))
    in_payout = add([x["amount"] for x in items if x["status"] in ("requested", "processing")])
    busy = in_payout > 0
    can = _manages_money(user, ref) and not busy and summary["available"] >= s["minPayout"]
    if can:
        hint = ""
    elif busy:
        hint = "Предыдущая выплата ещё в работе"
    elif summary["available"] < s["minPayout"]:
        hint = f"Вывести можно от {format_rub(s['minPayout'])}"
    else:
        hint = "Выводит деньги владелец"
    return {
        **summary,
        "credited": add([c["amount"] for c in _credits_of(ref)]),
        "paidOut": add([x["amount"] for x in items if x["status"] == "done"]),
        "inPayout": in_payout,
        "credits": sorted(_credits_of(ref), key=lambda c: (c["at"], c["id"]), reverse=True),
        "pendingItems": _pending_of(ref),
        "payouts": [_payout_view(x) for x in items],
        "canPayout": can,
        "payoutHint": hint,
        "minPayout": s["minPayout"],
        "payoutMode": _config["payouts"],
    }


def _normalize_phone(raw: Any) -> str | None:
    digits = "".join(ch for ch in input_text(raw) if "0" <= ch <= "9")
    ten = digits[1:] if len(digits) == 11 and digits[0] in ("7", "8") else digits
    return f"+7{ten}" if len(ten) == 10 and ten[0] == "9" else None


@_enabled_action
def request_payout(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    user = require_user(actor)
    ref = _parse_owner(input_.get("owner"))
    if not _manages_money(user, ref):
        fail("forbidden", "Вывести деньги может только владелец баланса")
    s = settings_of()
    available = _available_of(ref)
    errors: dict[str, str] = {}
    phone = _normalize_phone(input_.get("phone"))
    if phone is None:
        errors["phone"] = "Введите номер телефона, привязанный к СБП, например +7 912 345-67-89"
    bank = next((b for b in SBP_BANKS if b["id"] == input_.get("bankId")), None)
    if bank is None:
        errors["bankId"] = "Выберите банк, в который придут деньги"
    raw = input_.get("amount")
    amount = available if raw is None or raw == "" else parse_number(raw)
    if amount is None or amount <= 0 or kop(amount) != amount:
        errors["amount"] = "Укажите сумму в рублях"
    elif amount > available:
        errors["amount"] = f"Доступно {format_rub(available)}"
    elif amount < s["minPayout"]:
        errors["amount"] = f"Вывести можно от {format_rub(s['minPayout'])}"
    if errors:
        fail("validation", "Проверьте поля формы", errors)
    if any(x["status"] in ("requested", "processing") for x in _payouts_of(ref)):
        fail("bad_state", "Предыдущая выплата ещё в работе. Дождитесь её, потом выведите остальное")
    at = _now_iso()
    po = {
        "id": d.participation_host.next_id("po"),
        "recipient": ref,
        "amount": num(amount),
        "status": "requested",
        "method": "sbp",
        "phone": phone,
        "bankId": bank["id"],  # type: ignore[index]
        "bankName": bank["name"],  # type: ignore[index]
        "providerPayoutId": None,
        "requestedBy": user["id"],
        "createdAt": at,
        "updatedAt": at,
        "doneAt": None,
        "doneBy": None,
        "reason": "",
    }
    if not _config["test"] and _config["provider"] == "yookassa":
        po["live"] = True
    _payouts().append(po)
    if _config["payouts"] == "auto":
        po["status"] = "processing"
        _enqueue(d, "payout", None, po, po["amount"], "Выплата по СБП")
    commit(["payments", "admin"])
    return _payout_view(po)


def _notify_payout_sent(d: "Domain", po: Entity) -> None:
    notify(
        d,
        _money_user_ids(po["recipient"]),
        "payout_sent",
        "Выплата отправлена",
        f"{format_rub(po['amount'])} отправили по СБП в {po['bankName']} на номер {_mask_phone(po['phone'])}. Обычно деньги приходят в течение дня.",
        "/me/money",
    )


def _payout_failed(d: "Domain", payout_id: ID, reason: str) -> None:
    po = next((x for x in _payouts() if x["id"] == payout_id), None)
    if po is None or po["status"] in ("done", "failed"):
        return
    po["status"] = "failed"
    po["reason"] = reason
    po["updatedAt"] = _now_iso()
    notify(
        d,
        _money_user_ids(po["recipient"]),
        "payout_failed",
        "Выплата не прошла",
        f"Не получилось отправить {format_rub(po['amount'])}: {reason}. Деньги снова доступны на балансе, проверьте номер и банк.",
        "/me/money",
    )


# ---------- Деньги встречи ----------


def event_money(d: "Domain", actor: Actor, event_id: ID) -> Entity:
    user = require_user(actor)
    e = get_event(event_id)
    if not d.is_organizer(user, e) and user["role"] != "admin":
        fail("forbidden", "Деньги встречи видит организатор")
    s = settings_of()
    pays = _event_payments(e["id"])
    parts = [
        p
        for p in db().participations
        if p["eventId"] == e["id"]
        and (p["status"] == "confirmed" or any(x["userId"] == p["userId"] and _covers(x) for x in pays))
    ]
    rows: list[Entity] = []
    for p in sorted(parts, key=lambda x: x["createdAt"]):
        my = my_payment_of(d, e, p) if is_online(e) else None
        cover = next((x for x in pays if x["userId"] == p["userId"] and _covers(x)), None)
        rows.append(
            {
                "participationId": p["id"],
                "user": d.person(d.user(p["userId"]), True),
                "participationStatus": p["status"],
                "status": my["status"] if my is not None else "required",
                "method": cover["method"] if cover is not None else None,
                "base": cover["base"] if cover is not None else _current_base(e),
                "paidAt": cover.get("paidAt") if cover is not None else None,
                "dueAt": my["dueAt"] if my is not None else None,
            }
        )
    covering = [p for p in pays if _covers(p)]
    confirmed = d.participation_host.confirmed_count(e)
    kind = e["price"]["kind"]
    price = e["price"]["amount"] if kind == "fixed" else e["price"]["total"] if kind == "split" else 0
    split_online = kind == "split" and is_online(e)
    return {
        "eventId": e["id"],
        "title": e["title"],
        "paymentMode": e.get("paymentMode") or "offline",
        "priceKind": kind,
        "price": price,
        "collected": add([p["base"] for p in covering]),
        "expected": e["price"]["amount"] * confirmed if kind == "fixed" else price,
        "paidCount": sum(1 for p in covering if p["status"] != "held"),
        "heldCount": sum(1 for p in covering if p["status"] == "held"),
        "unpaidCount": sum(
            1 for r in rows if r["participationStatus"] == "confirmed" and r["status"] not in ("paid", "held")
        ),
        "toCredit": add(
            [
                p["base"] if p["status"] == "held" else _recipient_part(p)
                for p in pays
                if not p.get("creditedAt") and _covers(p)
            ]
        ),
        "credited": add(
            [c["amount"] for c in _credits() if c["source"] == "event" and c["targetId"] == e["id"]]
        ),
        "refunded": add([p["refundedAmount"] for p in pays]),
        "opensAt": clock.iso(_opens_at(e, s)) if split_online else None,
        "collectAt": clock.iso(_collect_at(e, s)) if split_online else None,
        "collect": e.get("payCollect"),
        "rows": rows,
    }


# ---------- Расчёт для экрана ----------


def quote_view(_d: "Domain", q: dict[str, Any]) -> Entity:
    s = settings_of()
    kind = "item_order" if q.get("kind") == "item_order" else "event_share"
    target_id = input_text(q.get("targetId"))
    markup: float = 0
    quantity: Any = 1
    max_share = None
    flows = {"sbp": "charge", "bank_card": "charge"}
    if kind == "event_share":
        e = get_event(target_id)
        if e["price"]["kind"] == "free":
            fail("payment_not_required", "Встреча бесплатная")
        base = _current_base(e)
        if e["price"]["kind"] == "split" and not _collected(e):
            max_share = _max_share_of(e)
            flows = {"sbp": "refund_diff", "bank_card": "hold"}
    else:
        item = _shelf_item_of(target_id)
        if item is None:
            fail("not_found", "Этой вещи уже нет на полке")
        if item.get("sale") is None:
            fail("not_for_sale", "Эта вещь не продаётся. Её можно попросить на время")
        if "quantity" in q:
            raw = parse_number(q.get("quantity"))
            quantity = max(1, math.floor(raw)) if raw is not None else 1
        base = item["sale"]["price"] * quantity
        markup = s["goodsMarkup"]
    return {
        "kind": kind,
        "targetId": target_id,
        "quantity": quantity,
        "markup": markup,
        "maxShare": max_share,
        "lines": [{**quote(base, m, s, markup), "flow": flows[m]} for m in s["methods"]],
    }


# ---------- Администратор ----------


def provider_status() -> Entity:
    return dict(_config)


def overview(_d: "Domain", actor: Actor) -> Entity:
    require_admin(actor)
    s = settings_of()
    all_ = _payments()
    taken = [p for p in all_ if p["capturedAmount"] > 0]

    def kept(p: Entity) -> Any:
        return kop(p["capturedAmount"] - p["refundedAmount"])

    owners: dict[str, Entity] = {}
    for c in _credits():
        owners[_owner_key_of(c["recipient"])] = c["recipient"]
    for e in _online_events():
        if is_online(e):
            owners[_owner_key_of(e["organizer"])] = e["organizer"]
    for o in _orders():
        owners[_owner_key_of(o["seller"])] = o["seller"]
    refs = list(owners.values())
    waiting = [x for x in _payouts() if x["status"] in ("requested", "processing")]
    turnover = add([kept(p) for p in taken])
    recipients = add([max(0, kop(kept(p) - p["fee"])) for p in taken])
    live = [p for p in taken if kept(p) >= p["total"]]
    return {
        "provider": provider_status(),
        "turnover": turnover,
        "bankFees": add([kop(p["capturedAmount"] * s["rates"][p["method"]]) for p in taken]),
        "serviceFees": kop(turnover - recipients),
        "platformIncome": add([p["feeParts"]["platform"] for p in live]),
        "reserve": add([p["feeParts"]["reserve"] for p in live]),
        "refunded": add([p["refundedAmount"] for p in all_]),
        "balancesDue": add([_available_of(r) for r in refs]),
        "pendingCredits": add([add([x["amount"] for x in _pending_of(r)]) for r in refs]),
        "payoutsWaiting": add([x["amount"] for x in waiting]),
        "payoutsWaitingCount": len(waiting),
        "counts": {
            "payments": len(all_),
            "paid": sum(1 for p in all_ if p["status"] in ("paid", "partially_refunded")),
            "held": sum(1 for p in all_ if p["status"] == "held"),
            "refunds": sum(1 for o in _ops() if o["kind"] == "refund" and o["status"] == "done"),
            "failedOps": sum(1 for o in _ops() if o["status"] == "failed"),
        },
    }


def admin_payments(d: "Domain", actor: Actor, q: dict[str, Any]) -> list[Entity]:
    require_admin(actor)
    text = normalize(input_text(q.get("q")))

    def matches(p: Entity) -> bool:
        if q.get("status") and p["status"] != q.get("status"):
            return False
        if q.get("kind") and p["kind"] != q.get("kind"):
            return False
        if not text:
            return True
        u = d.user(p["userId"])
        who = u["name"] if u is not None else ""
        return text in normalize(f"{p['id']} {_target_title(p)} {who}")

    return [_admin_payment_view(d, p) for p in _newest([p for p in _payments() if matches(p)])]


def admin_payment(d: "Domain", actor: Actor, id_: ID) -> Entity:
    require_admin(actor)
    p = find_payment(id_)
    if p is None:
        fail("not_found", "Платёж не найден")
    return _admin_payment_view(d, p)


@_enabled_action
def admin_refund(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = require_admin(actor)
    p = find_payment(id_)
    if p is None:
        fail("not_found", "Платёж не найден")
    reason = _clean(input_.get("reason"), 300)
    if len(reason) < 5:
        fail(
            "reason_required",
            "Напишите причину возврата. Её увидит плательщик",
            {"reason": "Напишите причину"},
        )
    if p["status"] == "held":
        _refund_fully(d, p, f"Администратор вернул деньги: {reason}", reason)
    else:
        max_ = _refundable(p)
        if max_ <= 0:
            fail("bad_state", "По этому платежу нечего возвращать")
        raw = input_.get("amount")
        amount = max_ if raw is None or raw == "" else parse_number(raw)
        if amount is None or amount <= 0 or amount > max_ or kop(amount) != amount:
            fail(
                "validation",
                f"Вернуть можно до {format_rub(max_)}",
                {"amount": f"От 1 до {format_rub(max_)}"},
            )
        amount = num(amount)
        p["reason"] = reason
        p["updatedAt"] = _now_iso()
        _enqueue(d, "refund", p, None, amount, reason)
        notify(
            d,
            [p["userId"]],
            "pay_refund",
            "Деньги вернутся на карту",
            f"Администратор вернул {format_rub(amount)} за «{_target_title(p)}»: {reason}. Деньги придут в течение нескольких дней.",
            _target_link(p),
        )
        # Деньги уже зачислены получателю — списываем их с его баланса
        if p.get("creditedAt"):
            if p["kind"] == "event_share":
                e = db().record("events", p["targetId"])
                ref = e["organizer"] if e is not None else None
            else:
                o = _order_of(p["targetId"])
                ref = o["seller"] if o is not None else None
            if ref is not None:
                _add_credit(
                    d,
                    ref,
                    -min(amount, p["base"]),
                    "event" if p["kind"] == "event_share" else "order",
                    p["targetId"],
                    f"Возврат: {_target_title(p)}",
                )
    audit_log(d, admin, "payment.refund", "payment", p["id"], _target_title(p), reason)
    commit(["payments", "notifications", "audit", "admin"])
    return _admin_payment_view(d, p)


def admin_payouts(_d: "Domain", actor: Actor, q: dict[str, Any]) -> list[Entity]:
    require_admin(actor)
    rows = [x for x in _payouts() if not q.get("status") or x["status"] == q.get("status")]
    return [_payout_view(x) for x in _newest(rows)]


@_enabled_action
def payout_done(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = require_admin(actor)
    po = next((x for x in _payouts() if x["id"] == id_), None)
    if po is None:
        fail("not_found", "Выплата не найдена")
    if po["status"] == "done":
        return _payout_view(po)
    if po["status"] == "failed":
        fail("bad_state", "Эта выплата отмечена как неудачная. Человек запросит новую")
    at = _now_iso()
    po["status"] = "done"
    po["doneAt"] = at
    po["doneBy"] = admin["id"]
    po["reason"] = _clean(input_.get("note"), 300)
    po["updatedAt"] = at
    _notify_payout_sent(d, po)
    audit_log(d, admin, "payout.done", "payout", po["id"], _owner_name(po["recipient"]), po["reason"])
    commit(["payments", "notifications", "audit", "admin"])
    return _payout_view(po)


@_enabled_action
def payout_fail(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = require_admin(actor)
    po = next((x for x in _payouts() if x["id"] == id_), None)
    if po is None:
        fail("not_found", "Выплата не найдена")
    if po["status"] == "failed":
        return _payout_view(po)
    if po["status"] == "done":
        fail("bad_state", "Выплата уже отмечена как переведённая")
    reason = _clean(input_.get("reason"), 300)
    if len(reason) < 5:
        fail("reason_required", "Напишите, что не так. Это увидит получатель", {"reason": "Напишите причину"})
    for op in _ops():
        if op.get("payoutId") == po["id"] and op["status"] in ("queued", "sending"):
            op["status"] = "failed"
            op["error"] = reason
            op["updatedAt"] = _now_iso()
    _payout_failed(d, po["id"], reason)
    audit_log(d, admin, "payout.fail", "payout", po["id"], _owner_name(po["recipient"]), reason)
    commit(["payments", "notifications", "audit", "admin"])
    return _payout_view(po)


def get_settings(actor: Actor) -> Entity:
    require_admin(actor)
    return settings_of()


_SETTING_LIMITS: list[tuple[str, float, float, bool]] = [
    ("payoutPercent", 0, 0.1, False),
    ("payoutFixed", 0, 500, False),
    ("goodsMarkup", 0, 0.5, False),
    ("holdMinutes", 5, 180, True),
    ("approvalHours", 1, 72, True),
    ("splitOpenDays", 1, 7, True),
    ("collectHoursBefore", 1, 48, True),
    ("autoCompleteDays", 1, 14, True),
    ("pendingMinutes", 10, 180, True),
    ("minPayout", 1, 100_000, True),
]


def _limit_text(value: float) -> str:
    return str(num(float(value)))


def update_settings(d: "Domain", actor: Actor, input_: dict[str, Any]) -> Entity:
    """PUT /admin/payments/settings: только известные поля и разумные пределы."""
    admin = require_admin(actor)
    current = settings_of()
    next_ = {**current, "rates": dict(current["rates"])}
    errors: dict[str, str] = {}

    def number(key: str, value: Any, min_: float, max_: float, integer: bool) -> Any:
        n = parse_number(value)
        if n is None or not min_ <= n <= max_ or (integer and not isinstance(n, int)):
            errors[key] = f"Укажите значение от {_limit_text(min_)} до {_limit_text(max_)}"
            return None
        return n

    rates = input_.get("rates")
    if isinstance(rates, dict):
        for m in ("sbp", "bank_card"):
            if m not in rates:
                continue
            v = number(f"rates.{m}", rates[m], 0, 0.2, False)
            if v is not None:
                next_["rates"][m] = v
    for key, min_, max_, integer in _SETTING_LIMITS:
        if key not in input_:
            continue
        v = number(key, input_[key], min_, max_, integer)
        if v is not None:
            next_[key] = v
    if "methods" in input_:
        raw = input_["methods"]
        chosen = [m for m in raw if m in ("sbp", "bank_card")] if isinstance(raw, list) else []
        if not chosen:
            errors["methods"] = "Оставьте хотя бы один способ оплаты"
        else:
            next_["methods"] = [m for m in ("sbp", "bank_card") if m in chosen]
    if errors:
        fail("validation", "Проверьте значения", errors)
    db().settings["payments"] = next_
    audit_log(d, admin, "payments.settings", "settings", "payments", "Ставки оплаты", "")
    commit(["payments", "admin", "audit"])
    return settings_of()


# ---------- Проверки по времени ----------


@_enabled_hook
def payments_tick(d: "Domain") -> bool:
    """Сроки оплаты, сбор складчины, возвраты по снятым встречам, зачисления, заказы, брошенные платежи.

    Как остальные проверки по времени — перед каждым изменяющим запросом и по таймеру. Сохраняет,
    только если что-то изменилось.
    """
    x = db()
    # Only online events can change payment state; keep these records tracked so
    # split collection / cancellation still persists through the normal store.
    events = _online_events()
    if not _payments() and not _dues() and not _orders() and not any(is_online(e) for e in events):
        return False
    s = settings_of()
    now = clock.now()
    changed = False
    touched: list[ID] = []

    for e in events:
        if not is_online(e):
            continue
        state = d.event_state(e)
        # Записи в составе без срока оплаты: принятые из листа ожидания, после смены записи на свободную
        if state == "upcoming" and not _collect_failed(e):
            for p in x.participations:
                if p["eventId"] != e["id"] or p["status"] != "confirmed":
                    continue
                before = len(_dues())
                ensure_due(d, e, p)
                if len(_dues()) != before:
                    changed = True
            # Складчина: оплата открылась — напоминание тем, кто ждал
            for due in _dues():
                if due["eventId"] != e["id"] or due["status"] != "open" or due.get("notifiedAt"):
                    continue
                if e["price"]["kind"] == "split" and not _collected(e) and _opens_at(e, s) > now:
                    continue
                _notify_due(d, e, due)
                changed = True
        # Срок оплаты вышел
        for due in _dues():
            if due["eventId"] != e["id"] or due["status"] != "open" or _at(due["dueAt"]) > now:
                continue
            p = next((y for y in x.participations if y["id"] == due["participationId"]), None)
            if p is None or p["status"] != "confirmed" or state != "upcoming":
                due["status"] = "closed"
                changed = True
                continue
            if _covering_payment(e["id"], p["userId"]) is not None:
                due["status"] = "paid"
                changed = True
                continue
            started = _pending_payment("event_share", e["id"], p["userId"])
            if (
                started is not None
                and _at(started["createdAt"]) <= _at(due["dueAt"])
                and now < _at(due["dueAt"]) + GRACE
            ):
                continue
            if started is not None:
                started["status"] = "expired"
                started["reason"] = "Срок оплаты вышел"
                started["updatedAt"] = clock.iso(now)
            due["status"] = "expired"
            _drop_participation(d, e, p)
            u = d.user(p["userId"])
            notify(
                d,
                [p["userId"]],
                "pay_expired",
                "Запись отменена",
                f"Оплата за «{e['title']}» не пришла вовремя, запись отменили. Если ещё хотите пойти, запишитесь снова.",
                f"/events/{e['id']}",
            )
            notify(
                d,
                d.participation_host.organizer_user_ids(e),
                "pay_expired",
                "Запись снята без оплаты",
                f"{u['name'] if u is not None else 'Участник'} не оплатил участие в «{e['title']}» вовремя, запись снята.",
                f"/events/{e['id']}/manage#money",
            )
            changed = True
            touched.append(e["id"])
        # Сбор складчины
        if (
            e["price"]["kind"] == "split"
            and not e.get("payCollect")
            and e["status"] == "published"
            and now >= _collect_at(e, s)
            and now < _end(e)
        ):
            _collect_split(d, e)
            changed = True
            touched.append(e["id"])
        # Снятая модератором встреча так и не вернулась к началу — деньги назад
        if (
            e["status"] == "removed"
            and now >= _start(e)
            and any(_covers(p) or p["status"] == "pending" for p in _event_payments(e["id"]))
        ):
            on_event_canceled(d, e, "Встречу сняли с публикации")
            changed = True
            touched.append(e["id"])
        # Встреча прошла — зачисление организатору
        if e["status"] == "published" and now >= _end(e) and _credit_event(d, e):
            changed = True
            touched.append(e["id"])

    for o in _orders():
        if o["status"] == "awaiting_payment" and _at(o["payDueAt"]) <= now:
            started = (
                next((p for p in _payments() if p["id"] == o["paymentId"] and p["status"] == "pending"), None)
                if o.get("paymentId")
                else None
            )
            if started is not None and now < _at(o["payDueAt"]) + GRACE:
                continue
            if started is not None:
                started["status"] = "expired"
                started["reason"] = "Срок оплаты вышел"
                started["updatedAt"] = clock.iso(now)
            o["status"] = "canceled"
            o["canceledAt"] = clock.iso(now)
            o["canceledBy"] = "system"
            o["reason"] = "Время на оплату вышло"
            o["updatedAt"] = o["canceledAt"]
            _restore_item(o)
            notify(
                d,
                [o["buyerId"]],
                "order_canceled",
                "Заказ отменён",
                f"Оплата за «{o['itemName']}» не пришла вовремя, заказ отменили. Вещь снова на полке.",
                f"/orders/{o['id']}",
            )
            changed = True
        elif o["status"] == "paid" and o.get("autoCompleteAt") and _at(o["autoCompleteAt"]) <= now:
            _complete_order(d, o, True)
            changed = True

    # Брошенная оплата: человек ушёл со страницы банка
    for p in _payments():
        if p["status"] != "pending" or now - _at(p["createdAt"]) < timedelta(minutes=s["pendingMinutes"]):
            continue
        p["status"] = "expired"
        p["reason"] = "Оплату не завершили"
        p["updatedAt"] = clock.iso(now)
        changed = True

    if changed:
        commit(["payments", "events", "participations", "notifications", "inventory", "messages"], touched)
    return changed


# ---------- Для исполнителя очереди и уведомлений ЮKassa (сервер) ----------


def claim_ops(limit: int = 20) -> list[Entity]:
    """Забрать операции из очереди: статус `sending`, попытка +1. Данные для вызова ЮKassa — рядом."""
    out: list[Entity] = []
    for op in _ops():
        if op["status"] != "queued" or len(out) >= limit:
            continue
        op["status"] = "sending"
        op["attempts"] += 1
        op["updatedAt"] = _now_iso()
        p = find_payment(op["paymentId"]) if op.get("paymentId") else None
        po = (
            next((x for x in _payouts() if x["id"] == op.get("payoutId")), None)
            if op.get("payoutId")
            else None
        )
        out.append(
            {
                "op": dict(op),
                "providerPaymentId": p.get("providerPaymentId") if p is not None else None,
                "payout": dict(po) if po is not None else None,
            }
        )
    if out:
        commit(["payments"])
    return out


def reset_sending(older_than_ms: int) -> int:
    """Операции, застрявшие в `sending` (сервер перезапустился посреди вызова), — снова в очередь."""
    count = 0
    now = clock.now()
    older_than = timedelta(milliseconds=older_than_ms)
    for op in _ops():
        if op["status"] == "sending" and now - _at(op["updatedAt"]) > older_than:
            op["status"] = "queued"
            count += 1
    return count


def finish_op(d: "Domain", op_id: ID, result: dict[str, Any]) -> Entity | None:
    op = next((o for o in _ops() if o["id"] == op_id), None)
    if op is None:
        return None
    if result.get("pending") and op["status"] == "sending":
        # ЮKassa приняла возврат или выплату, итог придёт уведомлением
        if result.get("providerId"):
            op["providerId"] = result["providerId"]
        op["updatedAt"] = _now_iso()
        commit(["payments"])
        return op
    complete_op(d, op, result)
    commit(["payments", "events", "notifications", "admin"])
    return op


def finish_by_provider_id(d: "Domain", provider_id: str, ok: bool, error: str = "") -> Entity | None:
    """Уведомление `refund.succeeded` или `payout.*`: закрыть операцию по id объекта ЮKassa."""
    op = next((o for o in _ops() if o.get("providerId") == provider_id), None)
    if op is None:
        return None
    complete_op(d, op, {"ok": ok, "final": not ok, "error": error})
    commit(["payments", "events", "notifications", "admin"])
    return op


def payment_by_provider_id(provider_payment_id: str) -> Entity | None:
    return next((p for p in _payments() if p.get("providerPaymentId") == provider_payment_id), None)


def attach_provider(d: "Domain", payment_id: ID, remote: dict[str, Any]) -> Entity:
    """Ответ ЮKassa на создание платежа: id платежа и адрес страницы оплаты."""
    p = find_payment(payment_id)
    if p is None:
        fail("not_found", "Платёж не найден")
    p["providerPaymentId"] = remote.get("providerPaymentId") or p.get("providerPaymentId")
    p["confirmationUrl"] = remote.get("confirmationUrl") or p.get("confirmationUrl")
    if remote.get("test") is not None:
        p["test"] = bool(remote["test"])
    p["updatedAt"] = _now_iso()
    if remote.get("status") and remote["status"] != "pending":
        return sync_payment(d, p, remote)
    commit(["payments"])
    return payment_view(p)


def provider_failed(_d: "Domain", payment_id: ID, reason: str) -> None:
    """ЮKassa не создала платёж: отметить, чтобы человек мог попробовать снова."""
    p = find_payment(payment_id)
    if p is None or p["status"] != "pending":
        return
    p["status"] = "canceled"
    p["reason"] = reason
    p["updatedAt"] = _now_iso()
    commit(["payments", "events"])


def provider_request(payment_id: ID) -> Entity:
    """Что отправить в ЮKassa при создании платежа: сумма, способ, описание, чек."""
    p = find_payment(payment_id)
    if p is None:
        fail("not_found", "Платёж не найден")
    user = next((u for u in db().users if u["id"] == p["userId"]), None) or {}
    title = _target_title(p)
    what = "Участие" if p["kind"] == "event_share" else "Покупка"
    return {
        "id": p["id"],
        "amount": p["total"],
        "base": p["base"],
        "fee": p["fee"],
        "capture": p["capture"],
        "method": p["method"],
        "description": f"{what}: {title}"[:128],
        "title": title,
        "kind": p["kind"],
        "email": user.get("email") or "",
        "phone": user.get("phone") or "",
        "providerPaymentId": p.get("providerPaymentId"),
        "status": p["status"],
        "confirmationUrl": p.get("confirmationUrl"),
    }


# ---------- Маршруты ----------


def payments_routes(d: "Domain", actor: Callable[[], Actor]) -> list[Route]:
    return [
        route("get", r"^/payments/quote$", lambda _p, _b, q: quote_view(d, q)),
        route("get", r"^/payments/sbp-banks$", lambda _p, _b, _q: SBP_BANKS),
        route(
            "get",
            r"^/payments/settings$",
            lambda _p, _b, _q: {
                **settings_of(),
                "enabled": provider_name() != "disabled",
                "provider": provider_name(),
            },
        ),
        route("post", r"^/payments$", lambda _p, b, _q: start_payment(d, actor(), b)),
        route("get", r"^/payments/([^/]+)$", lambda p, _b, _q: get_payment(actor(), p[0])),
        route("post", r"^/payments/([^/]+)/fake$", lambda p, b, _q: fake_outcome(d, actor(), p[0], b)),
        route("get", r"^/me/payments$", lambda _p, _b, _q: my_payments(actor())),
        route("get", r"^/events/([^/]+)/money$", lambda p, _b, _q: event_money(d, actor(), p[0])),
        route("post", r"^/shelf/([^/]+)/buy$", lambda p, b, _q: buy_item(d, actor(), p[0], b)),
        route("get", r"^/orders$", lambda _p, _b, q: list_orders(d, actor(), q)),
        route("get", r"^/orders/([^/]+)$", lambda p, _b, _q: order_details(d, actor(), p[0])),
        route("post", r"^/orders/([^/]+)/received$", lambda p, _b, _q: mark_received(d, actor(), p[0])),
        route("post", r"^/orders/([^/]+)/cancel$", lambda p, b, _q: cancel_order(d, actor(), p[0], b)),
        route("get", r"^/me/balances$", lambda _p, _b, _q: my_balances(d, actor())),
        route("get", r"^/me/balance$", lambda _p, _b, q: balance_view(d, actor(), q.get("owner"))),
        route("post", r"^/me/payouts$", lambda _p, b, _q: request_payout(d, actor(), b)),
        route("get", r"^/admin/payments/overview$", lambda _p, _b, _q: overview(d, actor())),
        route("get", r"^/admin/payments/settings$", lambda _p, _b, _q: get_settings(actor())),
        route("put", r"^/admin/payments/settings$", lambda _p, b, _q: update_settings(d, actor(), b)),
        route("get", r"^/admin/payments$", lambda _p, _b, q: admin_payments(d, actor(), q)),
        route("get", r"^/admin/payments/([^/]+)$", lambda p, _b, _q: admin_payment(d, actor(), p[0])),
        route(
            "post", r"^/admin/payments/([^/]+)/refund$", lambda p, b, _q: admin_refund(d, actor(), p[0], b)
        ),
        route("get", r"^/admin/payouts$", lambda _p, _b, q: admin_payouts(d, actor(), q)),
        route("post", r"^/admin/payouts/([^/]+)/done$", lambda p, b, _q: payout_done(d, actor(), p[0], b)),
        route("post", r"^/admin/payouts/([^/]+)/fail$", lambda p, b, _q: payout_fail(d, actor(), p[0], b)),
    ]
