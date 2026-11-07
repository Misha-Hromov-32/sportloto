"""Чек 54-ФЗ для «Чеков от ЮKassa»: одна позиция на всю сумму платежа."""

from typing import Any

from app.payments.yookassa import money


def _phone_digits(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return digits if len(digits) == 11 else ""  # noqa: PLR2004


def build_receipt(
    request: dict[str, Any], amount: float, *, vat_code: int, tax_system_code: int | None
) -> dict[str, Any] | None:
    """`request` — `payments.provider_request`. Без почты и телефона чек не собрать: None."""
    customer: dict[str, str] = {}
    if request.get("email"):
        customer["email"] = request["email"]
    elif _phone_digits(request.get("phone") or ""):
        customer["phone"] = _phone_digits(request["phone"])
    if not customer:
        return None
    item = {
        "description": request["description"][:128],
        "quantity": "1.00",
        "amount": money(amount),
        "vat_code": vat_code,
        "payment_mode": "full_payment" if request.get("capture") else "full_prepayment",
        "payment_subject": "commodity" if request.get("kind") == "item_order" else "service",
    }
    receipt: dict[str, Any] = {"customer": customer, "items": [item]}
    if tax_system_code:
        receipt["tax_system_code"] = tax_system_code
    return receipt
