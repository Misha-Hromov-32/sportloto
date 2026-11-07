"""Куда присылать уведомления: почта, браузер (Web Push), мессенджеры.

`GET/PUT /delivery/settings`, `POST /delivery/push/subscribe`, `POST /delivery/push/unsubscribe`,
`POST /delivery/test`. Только для вошедших; ключ бота `stb_…` тоже принимается — бот читает выбор
`messengers`, чтобы решить, что пересылать.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import Field

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.api.schemas.base import ApiModel
from app.api.schemas.common import ERROR_RESPONSES
from app.db.repositories.delivery import DeliveryRepository
from app.services.delivery import DeliverySettingsService, NotificationDelivery

router = APIRouter(prefix="/delivery", tags=["уведомления"], responses=ERROR_RESPONSES)

Messengers = Literal["all", "important", "off"]
TestStatus = Literal["sent", "off", "failed", "unavailable"]


def get_settings_service(session: SessionDep, settings: SettingsDep) -> DeliverySettingsService:
    return DeliverySettingsService(DeliveryRepository(session), settings)


def get_delivery(request: Request) -> NotificationDelivery:
    return request.app.state.delivery


ServiceDep = Annotated[DeliverySettingsService, Depends(get_settings_service)]
DeliveryDep = Annotated[NotificationDelivery, Depends(get_delivery)]


class BotsOut(ApiModel):
    telegram: bool
    vk: bool


class DeliverySettingsOut(ApiModel):
    email: bool
    browser: bool
    messengers: Messengers
    email_address: str | None
    email_deliverable: bool
    bots: BotsOut
    push_available: bool
    push_key: str | None
    push_subscriptions: int


class DeliverySettingsIn(ApiModel):
    email: bool | None = None
    browser: bool | None = None
    messengers: Messengers | None = None


class PushKeys(ApiModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscribeIn(ApiModel):
    endpoint: str = Field(min_length=1, max_length=2048, pattern=r"^https://")
    keys: PushKeys
    user_agent: str = Field(default="", max_length=1000)


class PushUnsubscribeIn(ApiModel):
    endpoint: str = Field(min_length=1, max_length=2048)


class TestOut(ApiModel):
    email: TestStatus
    browser: TestStatus


@router.get("/settings", response_model=DeliverySettingsOut)
async def read_settings(user: CurrentUser, service: ServiceDep) -> dict[str, object]:
    return await service.view(user)


@router.put("/settings", response_model=DeliverySettingsOut)
async def change_settings(
    body: DeliverySettingsIn, user: CurrentUser, service: ServiceDep
) -> dict[str, object]:
    return await service.update(user, body.model_dump(exclude_none=True))


@router.post("/push/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def push_subscribe(body: PushSubscribeIn, user: CurrentUser, service: ServiceDep) -> Response:
    await service.subscribe(user, body.endpoint, body.keys.p256dh, body.keys.auth, body.user_agent)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def push_unsubscribe(body: PushUnsubscribeIn, user: CurrentUser, service: ServiceDep) -> Response:
    await service.unsubscribe(user, body.endpoint)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test", response_model=TestOut)
async def send_test(user: CurrentUser, delivery: DeliveryDep) -> dict[str, str]:
    return await delivery.send_test(user.id)
