"""Задачи помощника: инструкция для модели и строгая схема ответа.

Схемы — черновые и сверяются с контрактом API (docs/architecture/api.md) при подключении
доменных эндпоинтов. Сервисы сопоставляют ответ с каталогом и правилами сами: модель ничего не решает.
"""

from dataclasses import dataclass
from functools import cached_property
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai.provider import ResponseSchema
from app.ai.schema import response_schema


@dataclass(frozen=True)
class AiTask[T: BaseModel]:
    kind: str
    instructions: str
    response_model: type[T]
    description: str
    temperature: float = 0.1

    @cached_property
    def schema(self) -> ResponseSchema:
        return response_schema(self.response_model, self.description)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class SearchIntent(_Strict):
    sport: str | None = Field(
        default=None, max_length=60, description="Направление так, как его назвал человек"
    )
    when: Literal["today", "tomorrow", "weekend", "week"] | None = None
    day_part: Literal["morning", "day", "evening"] | None = None
    level: Literal["beginner", "amateur", "experienced"] | None = None
    beginners: bool | None = Field(default=None, description="Ищет занятия, где рады новичкам")
    free: bool | None = Field(default=None, description="Только бесплатные")
    near: bool | None = Field(default=None, description="Рядом с домом")


class ModerationVerdict(_Strict):
    flag: Literal["none", "spam", "toxic", "suspicious"]
    reason: str = Field(default="", max_length=200, description="Короткое объяснение для администратора")


SEARCH_PARSE = AiTask(
    kind="search_parse",
    instructions=(
        "Ты разбираешь запрос человека, который ищет спортивное занятие, на фильтры поиска. "
        "Заполняй только то, что явно сказано. Не придумывай направление, время или уровень."
    ),
    response_model=SearchIntent,
    description="Фильтры поиска спортивных занятий",
)

PREMODERATION = AiTask(
    kind="premoderation",
    instructions=(
        "Ты помогаешь модератору спортивной платформы. Оцени текст: spam — реклама и посторонние ссылки, "
        "toxic — оскорбления и грубость, suspicious — похоже на обман, none — обычный текст. "
        "Причину объясни одной короткой фразой на русском. Решение принимает модератор, ты только помечаешь."
    ),
    response_model=ModerationVerdict,
    description="Пометка предмодерации",
    temperature=0.0,
)
