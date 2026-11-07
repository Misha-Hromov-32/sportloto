"""Клиент ЮKassa, API v3: платежи, списание и снятие холда, возвраты, выплаты по СБП.

Авторизация — Basic «shopId : секретный ключ» (у шлюза «Выплаты» — свои agentId и ключ). Каждый
изменяющий запрос идёт с заголовком `Idempotence-Key`: повтор после обрыва связи не создаст второй
платёж или возврат. Суммы — строкой с копейками («312.00»), валюта RUB.
"""

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

API_URL = "https://api.yookassa.ru/v3"
TIMEOUT_SECONDS = 15.0


class YooKassaError(Exception):
    """ЮKassa не выполнила запрос. `retryable` — сеть, 5xx или 429: можно повторить с тем же ключом."""

    def __init__(
        self, message: str, *, status: int | None = None, code: str = "", retryable: bool = False
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.retryable = retryable


def money(amount: float) -> dict[str, str]:
    return {"value": f"{amount:.2f}", "currency": "RUB"}


def amount_of(obj: dict[str, Any]) -> float | int:
    value = float((obj.get("amount") or {}).get("value") or 0)
    return int(value) if value.is_integer() else value


@dataclass(slots=True)
class NewPayment:
    """Платёж для создания: `capture=False` — холд (только карта), `key` — ключ идемпотентности."""

    amount: float
    capture: bool
    method: str
    description: str
    return_url: str
    metadata: dict[str, str]
    key: str
    receipt: dict[str, Any] | None = None


@dataclass(slots=True)
class NewPayout:
    """Выплата на СБП: телефон получателя и банк из списка `GET /sbp_banks`."""

    amount: float
    phone: str
    bank_id: str
    description: str
    metadata: dict[str, str]
    key: str


@dataclass(slots=True)
class Credentials:
    account: str
    secret: str

    @property
    def configured(self) -> bool:
        return bool(self.account and self.secret)


class YooKassaClient:
    def __init__(
        self,
        shop: Credentials,
        payouts: Credentials | None = None,
        *,
        api_url: str = API_URL,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self.shop = shop
        self.payouts = payouts
        self.api_url = api_url.rstrip("/")
        self.transport = transport
        self.timeout = timeout

    @property
    def test(self) -> bool:
        """Тестовый магазин: секретный ключ начинается с `test_`."""
        return self.shop.secret.startswith("test_")

    @property
    def payouts_enabled(self) -> bool:
        return self.payouts is not None and self.payouts.configured

    def _clean(self, text: str) -> str:
        for secret in (self.shop.secret, self.payouts.secret if self.payouts else ""):
            if secret:
                text = text.replace(secret, "***")
        return text[:300]

    async def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        key: str | None = None,
        creds: Credentials | None = None,
    ) -> dict[str, Any]:
        creds = creds or self.shop
        if not creds.configured:
            raise YooKassaError("Не заданы ключи ЮKassa", code="not_configured")
        headers = {"Accept": "application/json"}
        if key:
            headers["Idempotence-Key"] = key
        try:
            async with httpx.AsyncClient(
                auth=httpx.BasicAuth(creds.account, creds.secret),
                timeout=self.timeout,
                transport=self.transport,
                headers=headers,
            ) as client:
                response = await client.request(method, f"{self.api_url}{path}", json=body)
        except httpx.HTTPError as exc:
            raise YooKassaError(f"ЮKassa не ответила: {type(exc).__name__}", retryable=True) from exc
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code >= 400:  # noqa: PLR2004
            body_ = data if isinstance(data, dict) else {}
            code = str(body_.get("code") or "")
            detail = str(body_.get("description") or response.text)
            retryable = response.status_code >= 500 or response.status_code == 429  # noqa: PLR2004
            logger.warning("ЮKassa %s %s: %s %s", method, path, response.status_code, self._clean(detail))
            raise YooKassaError(
                self._clean(detail) or "ЮKassa отказала",
                status=response.status_code,
                code=code,
                retryable=retryable,
            )
        return data if isinstance(data, dict) else {}

    # ---------- Платежи ----------

    async def create_payment(self, new: NewPayment) -> dict[str, Any]:
        body: dict[str, Any] = {
            "amount": money(new.amount),
            "capture": new.capture,
            "confirmation": {"type": "redirect", "return_url": new.return_url},
            "description": new.description[:128],
            "metadata": new.metadata,
            "payment_method_data": {"type": new.method},
        }
        if new.receipt:
            body["receipt"] = new.receipt
        return await self._request("POST", "/payments", body=body, key=new.key)

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}")

    async def capture(
        self, payment_id: str, amount: float, key: str, receipt: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Списать с холда. Сумма может быть меньше удержанной: остаток вернётся сам."""
        body: dict[str, Any] = {"amount": money(amount)}
        if receipt:
            body["receipt"] = receipt
        return await self._request("POST", f"/payments/{payment_id}/capture", body=body, key=key)

    async def cancel(self, payment_id: str, key: str) -> dict[str, Any]:
        """Снять холд (только `waiting_for_capture`), комиссии нет."""
        return await self._request("POST", f"/payments/{payment_id}/cancel", body={}, key=key)

    async def refund(self, payment_id: str, amount: float, key: str, description: str = "") -> dict[str, Any]:
        body: dict[str, Any] = {"payment_id": payment_id, "amount": money(amount)}
        if description:
            body["description"] = description[:250]
        return await self._request("POST", "/refunds", body=body, key=key)

    async def get_refund(self, refund_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/refunds/{refund_id}")

    # ---------- Выплаты (отдельный шлюз «Выплаты») ----------

    async def create_payout(self, new: NewPayout) -> dict[str, Any]:
        """Выплата на СБП: телефон — цифрами (7XXXXXXXXXX), банк — `bank_id` участника СБП."""
        if not self.payouts_enabled:
            raise YooKassaError("Выплаты ЮKassa не подключены", code="payouts_disabled")
        body = {
            "amount": money(new.amount),
            "payout_destination_data": {
                "type": "sbp",
                "phone": new.phone.lstrip("+"),
                "bank_id": new.bank_id,
            },
            "description": new.description[:128],
            "metadata": new.metadata,
        }
        return await self._request("POST", "/payouts", body=body, key=new.key, creds=self.payouts)

    async def get_payout(self, payout_id: str) -> dict[str, Any]:
        if not self.payouts_enabled:
            raise YooKassaError("Выплаты ЮKassa не подключены", code="payouts_disabled")
        return await self._request("GET", f"/payouts/{payout_id}", creds=self.payouts)

    async def sbp_banks(self) -> list[dict[str, str]]:
        """Банки — участники СБП для выплат: `[{ id, name }]`."""
        creds = self.payouts if self.payouts_enabled else self.shop
        data = await self._request("GET", "/sbp_banks", creds=creds)
        items = data.get("items") or []
        return [{"id": str(b.get("bank_id")), "name": str(b.get("name"))} for b in items if b.get("bank_id")]


def remote_state(obj: dict[str, Any]) -> dict[str, Any]:
    """Объект платежа ЮKassa → состояние для доменных правил (`payments.sync_payment`)."""
    status = obj.get("status")
    state: dict[str, Any] = {"status": status, "providerPaymentId": obj.get("id")}
    if status == "succeeded":
        state["amount"] = amount_of(obj)
    if status == "canceled":
        state["reason"] = (obj.get("cancellation_details") or {}).get("reason") or ""
    if "test" in obj:
        state["test"] = bool(obj["test"])
    confirmation = obj.get("confirmation") or {}
    if confirmation.get("confirmation_url"):
        state["confirmationUrl"] = confirmation["confirmation_url"]
    return state
