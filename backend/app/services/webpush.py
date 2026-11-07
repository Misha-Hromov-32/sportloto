"""Отправка Web Push по стандарту VAPID (pywebpush в потоке: библиотека синхронная)."""

import asyncio
import json
import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pywebpush import WebPushException, webpush

from app.core.config import Settings

logger = logging.getLogger(__name__)

# Сколько служба браузера хранит уведомление, пока устройство не в сети.
TTL_SECONDS = 24 * 3600
TIMEOUT_SECONDS = 10.0
# Подписки больше нет: браузер её отозвал или человек сбросил разрешение.
GONE_STATUSES = frozenset({404, 410})


class PushOutcome(StrEnum):
    OK = "ok"
    GONE = "gone"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class PushTarget:
    endpoint: str
    p256dh: str
    auth: str


@dataclass(frozen=True, slots=True)
class PushMessage:
    id: str
    title: str
    body: str
    url: str

    def payload(self) -> str:
        return json.dumps(
            {"id": self.id, "title": self.title, "body": self.body, "url": self.url}, ensure_ascii=False
        )


class PushSender(Protocol):
    async def send(self, target: PushTarget, message: PushMessage) -> PushOutcome: ...


class VapidPushSender:
    def __init__(self, settings: Settings) -> None:
        self.private_key = settings.web_push_private_key.get_secret_value().strip()
        self.subject = settings.web_push_subject.strip()

    def _deliver(self, target: PushTarget, data: str) -> None:
        webpush(
            subscription_info={
                "endpoint": target.endpoint,
                "keys": {"p256dh": target.p256dh, "auth": target.auth},
            },
            data=data,
            vapid_private_key=self.private_key,
            # Новый словарь на каждый вызов: библиотека дописывает в него aud и exp.
            vapid_claims={"sub": self.subject},
            ttl=TTL_SECONDS,
            timeout=TIMEOUT_SECONDS,
        )

    async def send(self, target: PushTarget, message: PushMessage) -> PushOutcome:
        try:
            await asyncio.to_thread(self._deliver, target, message.payload())
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in GONE_STATUSES:
                return PushOutcome.GONE
            # Адрес подписки — личный идентификатор устройства: в журнал только служба и код ответа.
            logger.warning("Web Push не доставлен (%s): код %s", _host(target.endpoint), status)
            return PushOutcome.FAILED
        except Exception as exc:  # noqa: BLE001  сеть, неверный ключ подписки — канал не должен падать
            logger.warning("Web Push не доставлен (%s): %s", _host(target.endpoint), type(exc).__name__)
            return PushOutcome.FAILED
        return PushOutcome.OK


def _host(endpoint: str) -> str:
    return endpoint.split("/")[2] if endpoint.count("/") >= 2 else "?"  # noqa: PLR2004


def build_push_sender(settings: Settings) -> PushSender | None:
    return VapidPushSender(settings) if settings.web_push_enabled else None
