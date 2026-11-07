"""Сообщение бота без привязки к мессенджеру: текст, кнопки, фото, точка на карте, меню.

Адаптеры Telegram и VK переводят его в свои форматы. У кнопки-действия в `data` лежит короткий номер,
по которому бот достаёт данные из своего хранилища (в Telegram на кнопку не больше 64 байт).
"""

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class Button:
    label: str
    data: str | None = None
    url: str | None = None


@dataclass
class Location:
    lat: float
    lng: float
    title: str
    address: str


@dataclass
class Message:
    text: str
    buttons: list[list[Button]] = field(default_factory=list)
    photo_url: str | None = None
    photo_bytes: bytes | None = None
    location: Location | None = None
    # Постоянное меню под полем ввода (Telegram) или обычная клавиатура (VK).
    menu: list[list[str]] | None = None
    # Кнопка «Отправить местоположение» (только Telegram).
    request_location: bool = False


@dataclass
class Incoming:
    chat_id: str
    user_id: str
    name: str
    kind: str  # text | button | photo | location | start | allow
    text: str = ""
    data: str = ""
    callback: Any = None
    photo: Any = None
    lat: float | None = None
    lng: float | None = None
    # Код привязки из ссылки на бота (VK `ref`).
    ref: str | None = None
    # Сообщение, под которым нажали кнопку: его можно изменить.
    message: str | None = None


class Unreachable(Exception):
    """Человек заблокировал бота или не разрешил сообщения сообщества: писать ему нельзя."""


class Messenger(Protocol):
    platform: str
    can_request_location: bool

    async def send(self, chat_id: str, msg: Message) -> str | None: ...
    async def edit(self, chat_id: str, ref: str, msg: Message) -> None: ...
    async def answer(self, callback: Any, text: str | None = None) -> None: ...
    async def typing(self, chat_id: str) -> None: ...
    async def download(self, photo: Any) -> bytes: ...
