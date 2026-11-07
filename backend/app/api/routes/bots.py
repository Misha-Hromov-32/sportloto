"""Привязка аккаунта к ботам Telegram и VK (docs/product/10-bots.md, раздел 2).

Сайт: `POST /bots/link-code`, `POST /bots/claim`, `GET /bots/links`, `DELETE /bots/links/{id}`.
Бот (заголовок `X-Bot-Secret`): `POST /bots/link`, `POST /bots/pending`, `GET /bots/pending/{code}`.
Бот с ключом человека: `POST /bots/unlink`. Без входа: `GET /bots/config`.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request, Response, status
from pydantic import Field

from app.api.deps import BotServiceDep, CurrentUser, SettingsDep, TokenDep
from app.api.schemas.base import ApiModel
from app.api.schemas.common import ERROR_RESPONSES
from app.db.models import BotPlatform, User
from app.services.bots import Chat, IssuedKey

router = APIRouter(prefix="/bots", tags=["боты"], responses=ERROR_RESPONSES)

PlatformName = Literal["vk"]
BotSecret = Annotated[str | None, Header(alias="X-Bot-Secret")]


class LinkCodeIn(ApiModel):
    platform: PlatformName


class LinkCodeOut(ApiModel):
    code: str
    url: str | None
    expires_at: datetime


class ChatIn(ApiModel):
    platform: PlatformName
    external_id: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=120)

    def chat(self) -> Chat:
        return Chat(BotPlatform(self.platform), self.external_id.strip(), self.display_name.strip())


class LinkIn(ChatIn):
    code: str = Field(max_length=32)


class CodeIn(ApiModel):
    code: str = Field(max_length=32)


class BotUserOut(ApiModel):
    id: str
    name: str


class KeyOut(ApiModel):
    token: str
    user: BotUserOut


class PendingOut(ApiModel):
    code: str
    expires_at: datetime


class PendingStatusOut(ApiModel):
    status: Literal["waiting", "linked"]
    token: str | None = None
    user: BotUserOut | None = None


class ClaimOut(ApiModel):
    platform: PlatformName
    display_name: str


class LinkOut(ApiModel):
    id: str
    platform: PlatformName
    display_name: str
    created_at: datetime
    last_used_at: datetime | None


class TelegramConfigOut(ApiModel):
    enabled: bool
    username: str | None


class VkConfigOut(ApiModel):
    enabled: bool
    group_id: int


class BotsConfigOut(ApiModel):
    vk: VkConfigOut


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _user(user: User) -> BotUserOut:
    return BotUserOut(id=user.id, name=user.name)


def _key(issued: IssuedKey) -> KeyOut:
    return KeyOut(token=issued.token, user=_user(issued.user))


@router.get("/config", summary="Какие боты подключены")
async def config(settings: SettingsDep) -> BotsConfigOut:
    enabled = settings.bots_enabled
    return BotsConfigOut(
        vk=VkConfigOut(enabled=enabled, group_id=settings.vk_group_id),
    )


@router.post("/link-code", summary="Одноразовый код и ссылка для привязки бота")
async def link_code(body: LinkCodeIn, user: CurrentUser, bots: BotServiceDep) -> LinkCodeOut:
    platform = BotPlatform(body.platform)
    issued = await bots.issue_site_code(user, platform)
    return LinkCodeOut(
        code=issued.code, url=bots.link_url(platform, issued.code), expires_at=issued.expires_at
    )


@router.post("/link", summary="Бот обменивает код с сайта на ключ")
async def link(body: LinkIn, request: Request, bots: BotServiceDep, secret: BotSecret = None) -> KeyOut:
    bots.verify_bot(secret)
    return _key(await bots.link(_ip(request), body.code, body.chat()))


@router.post("/pending", summary="Код для ввода на сайте")
async def pending(
    body: ChatIn, request: Request, bots: BotServiceDep, secret: BotSecret = None
) -> PendingOut:
    bots.verify_bot(secret)
    issued = await bots.issue_bot_code(_ip(request), body.chat())
    return PendingOut(code=issued.code, expires_at=issued.expires_at)


@router.get(
    "/pending/{code}",
    summary="Подтвердили ли код на сайте",
    response_model_exclude_none=True,
)
async def pending_status(  # noqa: PLR0913
    code: str,
    request: Request,
    bots: BotServiceDep,
    *,
    platform: Annotated[PlatformName, Query()],
    external_id: Annotated[str, Query(alias="externalId", min_length=1, max_length=64)],
    secret: BotSecret = None,
) -> PendingStatusOut:
    bots.verify_bot(secret)
    result = await bots.poll(_ip(request), code, Chat(BotPlatform(platform), external_id.strip()))
    if result.key is None:
        return PendingStatusOut(status="waiting")
    return PendingStatusOut(status="linked", token=result.key.token, user=_user(result.key.user))


@router.post("/claim", summary="Подключить бота кодом из чата")
async def claim(body: CodeIn, request: Request, user: CurrentUser, bots: BotServiceDep) -> ClaimOut:
    claimed = await bots.claim(_ip(request), user, body.code)
    return ClaimOut(platform=claimed.platform, display_name=claimed.display_name)  # type: ignore[arg-type]


@router.get("/links", summary="Подключённые мессенджеры")
async def links(user: CurrentUser, bots: BotServiceDep) -> list[LinkOut]:
    return [LinkOut.model_validate(link) for link in await bots.list_links(user)]


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Отключить мессенджер")
async def revoke(link_id: str, user: CurrentUser, bots: BotServiceDep) -> Response:
    await bots.revoke(user, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/unlink", status_code=status.HTTP_204_NO_CONTENT, summary="Бот отключает свой ключ")
async def unlink(token: TokenDep, bots: BotServiceDep) -> Response:
    await bots.unlink(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
