"""Цена участия и правило отмены."""

import math
from datetime import datetime, timedelta
from typing import Any, TypedDict

from app.domain import clock
from app.domain.lib.dates import day_month, start_of_day
from app.domain.lib.numbers import NBSP, format_number, parse_number
from app.domain.lib.plural import WORDS, count


def format_rub(amount: float) -> str:
    return f"{format_number(round(amount))}{NBSP}₽"


class PriceSummary(TypedDict):
    main: str
    details: list[str]
    free: bool
    perPerson: float | None


def price_summary(price: dict[str, Any], confirmed: int, min_participants: int | None) -> PriceSummary:
    """При «скидываемся» доля считается от текущего числа участников, но не выше доли при пороге.

    Сумма может прийти строкой («1500»); если суммы нет, доля неизвестна (`perPerson` — None).
    """
    if price["kind"] == "free":
        return {"main": "Бесплатно", "details": [], "free": True, "perPerson": 0}
    if price["kind"] == "fixed":
        amount = parse_number(price.get("amount"))
        if amount is None:
            return _unknown_price()
        return {
            "main": format_rub(amount),
            "details": ["С человека, оплата на месте"],
            "free": False,
            "perPerson": amount,
        }
    total = parse_number(price.get("total"))
    if total is None:
        return _unknown_price()
    cap = math.ceil(total / min_participants) if min_participants else None
    now = math.ceil(total / max(confirmed, 1))
    per_person = min(now, cap) if cap is not None else now
    note = price.get("note")
    details = [f"Скидываемся{f' {note}' if note else ''}: {format_rub(total)} на{NBSP}всех"]
    if confirmed > 1:
        details.append(
            f"Сейчас {count(confirmed, WORDS['participant'])}, это ≈{NBSP}{format_rub(now)} с человека"
        )
    if cap is not None:
        details.append(f"Не больше {format_rub(cap)} с человека, если наберётся {min_participants}")
    return {
        "main": f"≈{NBSP}{format_rub(per_person)} с человека",
        "details": details,
        "free": False,
        "perPerson": per_person,
    }


def _unknown_price() -> PriceSummary:
    return {"main": "Цена не указана", "details": [], "free": False, "perPerson": None}


def free_cancel_deadline(policy: dict[str, Any], starts_at: str) -> datetime | None:
    """До какого момента запись отменяется бесплатно (в поясе отображения); None — неверная дата встречи.

    «Накануне до HH:MM» — по местному времени дня перед встречей; время не указано — 18:00.
    """
    start = clock.parse(starts_at)
    if start is None:
        return None
    start = clock.local(start)
    if policy["kind"] == "anytime":
        return start
    if policy["kind"] == "hoursBefore":
        return start - timedelta(hours=parse_number(policy.get("hours")) or 0)
    hour, _, minute = str(policy.get("time") or "").partition(":")
    hours = parse_number(hour)
    minutes = parse_number(minute) or 0
    eve = start_of_day(start - timedelta(days=1))
    return eve + (timedelta(hours=18) if hours is None else timedelta(hours=hours, minutes=minutes))


def cancel_policy_text(policy: dict[str, Any], starts_at: str) -> str:
    """Правило отмены записи, которое участник видит до записи."""
    if policy["kind"] == "anytime":
        return "Отменить запись можно в любой момент"
    deadline = free_cancel_deadline(policy, starts_at)
    if policy["kind"] == "hoursBefore":
        before = f"за {policy['hours']}{NBSP}ч до начала"
        if deadline is None:
            return f"Отменить бесплатно можно {before}"
        return f"Отменить бесплатно можно до {deadline:%H:%M}, {day_month(deadline)}, {before}"
    eve = f"до {policy['time']} накануне"
    if deadline is None:
        return f"Отменить бесплатно можно {eve}"
    return f"Отменить бесплатно можно {eve}, {day_month(deadline)}"


ORGANIZER_CANCEL_NOTE = "Если организатор отменит событие, деньги вернут полностью."
PAYMENT_NOTE_DEFAULT = "Оплата на месте, организатору"
