"""Ресурсы и действия API в форме dataProvider Refine: списки, карточки, создание и маршруты custom."""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, NamedTuple

Params = dict[str, Any]
Handle = Callable[[list[str], Params, Params], Any]


class Listed(NamedTuple):
    """Ответ списка: строки и фильтры, которые ресурс обработал сам (остальные применяются к полям ответа)."""

    rows: list[Any]
    consumed: list[str]


Lister = Callable[[Params], Listed]
Getter = Callable[..., Any]


@dataclass(slots=True)
class Route:
    """Действие: метод, шаблон адреса без /api и обработчик `(группы шаблона, тело, query)`."""

    method: str
    pattern: re.Pattern[str]
    handle: Handle
    # Вызов помощника: журнал, режим сбоя и запасной путь (search | draft | match | premoderation).
    assistant: str | None = None


def route(method: str, pattern: str, handle: Handle, assistant: str | None = None) -> Route:
    return Route(method, re.compile(pattern), handle, assistant)


@dataclass(slots=True)
class Resources:
    listers: dict[str, Lister] = field(default_factory=dict)
    getters: dict[str, Getter] = field(default_factory=dict)
    creators: dict[str, Callable[[Params], Any]] = field(default_factory=dict)
    updaters: dict[str, Callable[[str, Params], Any]] = field(default_factory=dict)
    deleters: dict[str, Callable[[str], Any]] = field(default_factory=dict)
