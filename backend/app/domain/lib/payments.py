"""Сбор сервиса и настройки оплаты; экран считает так же (frontend/src/lib/payments.ts).

`T = ceil_руб((B·(1 + p) + f + m·B) / (1 − r))`, сбор = T − B. Перед округлением до рубля сумма
приводится к копейкам (половина — вверх), чтобы ошибка двоичной дроби не добавила рубль.
"""

import copy
import math
from typing import Any

DEFAULT_PAYMENT_SETTINGS: dict[str, Any] = {
    "rates": {"sbp": 0.007, "bank_card": 0.038},
    "methods": ["sbp", "bank_card"],
    "payoutPercent": 0,
    "payoutFixed": 0,
    "goodsMarkup": 0.05,
    "holdMinutes": 20,
    "approvalHours": 24,
    "splitOpenDays": 7,
    "collectHoursBefore": 2,
    "autoCompleteDays": 3,
    "pendingMinutes": 60,
    "minPayout": 100,
}


def payment_settings(stored: dict[str, Any] | None) -> dict[str, Any]:
    """Настройки администратора поверх значений по умолчанию."""
    stored = stored or {}
    out = {**copy.deepcopy(DEFAULT_PAYMENT_SETTINGS), **copy.deepcopy(stored)}
    out["rates"] = {**DEFAULT_PAYMENT_SETTINGS["rates"], **(stored.get("rates") or {})}
    return out


def num(value: float) -> float | int:
    """Целое значение — int: в JSON 300, а не 300.0."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def kop(value: float) -> float | int:
    """До копеек: половина копейки — вверх, а не к чётному, как у round() (так же считает экран)."""
    return num(math.floor(value * 100 + 0.5) / 100)


def add(values: list[float]) -> float | int:
    """Сумма слева направо, как на экране (sum() в Python 3.12 складывает с компенсацией)."""
    total: float = 0
    for v in values:
        total += v
    return kop(total)


def quote(base: float, method: str, settings: dict[str, Any], markup: float = 0) -> dict[str, Any]:
    r = settings["rates"][method]
    p = settings["payoutPercent"]
    f = settings["payoutFixed"]
    raw = (base * (1 + p) + f + markup * base) / (1 - r)
    total = math.ceil(kop(raw))
    fee_parts = {
        "bank": kop(total * r),
        "payout": kop(base * p + f),
        "platform": kop(markup * base),
        "reserve": 0,
    }
    fee_parts["reserve"] = kop(total - base - fee_parts["bank"] - fee_parts["payout"] - fee_parts["platform"])
    return {
        "method": method,
        "base": num(base),
        "fee": num(total - base),
        "total": total,
        "feeParts": fee_parts,
    }


def split_max_share(total: float, min_participants: int) -> int:
    """Наибольшая доля складчины: при пороге сбора."""
    return math.ceil(total / max(min_participants, 1))


def split_final_share(total: float, paid_count: int) -> int:
    """Итоговая доля: сумма делится на всех, кто оплатил."""
    return math.ceil(total / max(paid_count, 1))
