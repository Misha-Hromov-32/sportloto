"""Отправка SMS через SMS Aero (REST API v2) или в журнал, когда провайдер не подключён."""

import logging
from typing import Any, Protocol

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)


class SmsError(Exception):
    """Провайдер не принял сообщение. Текст — для журнала, без номера и ключа."""


def mask_phone(phone: str) -> str:
    """+79123456789 → +7 912 ***-**-89: в журнале видно оператора и хвост, но не номер целиком."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) != 11:  # noqa: PLR2004
        return f"***{digits[-2:]}"
    return f"+{digits[0]} {digits[1:4]} ***-**-{digits[-2:]}"


class SmsSender(Protocol):
    async def send(self, phone: str, text: str) -> None:
        """Отправить SMS на номер +7XXXXXXXXXX. Отказ провайдера — SmsError."""
        ...


class LogSmsSender:
    """Провайдер не подключён: текст уходит в журнал (разработка, тесты, автономные запуски)."""

    async def send(self, phone: str, text: str) -> None:
        logger.info("SMS не отправлено, провайдер выключен: %s, текст: %s", mask_phone(phone), text)


class SmsAeroSender:
    """SMS Aero, API v2: POST {url}/sms/send, Basic-авторизация «почта кабинета : API-ключ».

    Ответ — JSON `{success, data, message}`; при ошибке HTTP-код 4xx и `message` с причиной.
    """

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.url = settings.smsaero_api_url.rstrip("/")
        self.email = settings.smsaero_email
        self.api_key = settings.smsaero_api_key
        self.sign = settings.smsaero_sign
        self.timeout = settings.sms_timeout_seconds
        self.transport = transport

    def _clean(self, detail: str, phone: str) -> str:
        """Ответ провайдера может повторять номер или ключ — в журнал без них."""
        key = self.api_key.get_secret_value()
        if key:
            detail = detail.replace(key, "***")
        digits = phone.lstrip("+")
        return detail.replace(digits, mask_phone(phone))[:300]

    async def _post(self, payload: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(self.email, self.api_key.get_secret_value()),
            timeout=self.timeout,
            transport=self.transport,
            headers={"Accept": "application/json"},
        ) as client:
            return await client.post(f"{self.url}/sms/send", json=payload)

    async def send(self, phone: str, text: str) -> None:
        payload = {"number": phone.lstrip("+"), "text": text, "sign": self.sign}
        try:
            response = await self._post(payload)
        except httpx.HTTPError as exc:
            reason = f"{type(exc).__name__}: {self._clean(str(exc), phone)}"
            logger.warning("SMS для %s не отправлено: %s", mask_phone(phone), reason)
            raise SmsError(reason) from None
        try:
            body = response.json()
        except ValueError:
            body = None
        success = isinstance(body, dict) and body.get("success") is True
        if response.is_success and success:
            logger.info("SMS отправлено: %s", mask_phone(phone))
            return
        message = body.get("message") if isinstance(body, dict) else None
        reason = f"HTTP {response.status_code}: {self._clean(str(message or response.text), phone)}"
        logger.warning("SMS для %s не отправлено: %s", mask_phone(phone), reason)
        raise SmsError(reason)


def build_sms_sender(settings: Settings) -> SmsSender:
    return SmsAeroSender(settings) if settings.sms_provider == "smsaero" else LogSmsSender()
