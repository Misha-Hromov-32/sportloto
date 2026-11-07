"""Детерминированный провайдер на правилах: для тестов, e2e и работы без ключа.

Режим сбоя переключается на лету (`failure`), чтобы показывать и проверять запасной путь.
"""

import asyncio
import hashlib
import json
import math
import re
from collections.abc import Callable
from typing import Any

from app.ai.errors import AiUnavailableError
from app.ai.provider import ChatMessage, EmbedPurpose, ResponseSchema
from app.core.config import FakeFailure

Rule = Callable[[str], dict[str, Any]]

_SPORTS: list[tuple[str, str]] = [
    ("настольный теннис", r"настольн\w* теннис|пинг-?понг"),
    ("теннис", r"теннис"),
    ("футбол", r"футбол|футик"),
    ("волейбол", r"волейбол"),
    ("баскетбол", r"баскетбол"),
    ("шахматы", r"шахмат"),
    ("бег", r"бег\w*|пробежк"),
    ("йога", r"йог"),
    ("плавание", r"плаван|бассейн"),
    ("велоспорт", r"велосипед|велопрогулк"),
    ("зарядка", r"зарядк"),
]

_WHEN = [
    ("today", r"сегодня"),
    ("tomorrow", r"завтра"),
    ("weekend", r"выходн|суббот|воскресен"),
    ("week", r"недел"),
]
_DAY_PART = [("morning", r"утр"), ("day", r"дн[её]м|обед"), ("evening", r"вечер")]
_LEVEL = [
    ("beginner", r"новичок|новичк|начина|с нуля"),
    ("amateur", r"любител"),
    ("experienced", r"опытн|профи"),
]


def _first(text: str, table: list[tuple[str, str]]) -> str | None:
    for value, pattern in table:
        if re.search(rf"\b(?:{pattern})", text):
            return value
    return None


def parse_search(text: str) -> dict[str, Any]:
    lowered = text.lower()
    level = _first(lowered, _LEVEL)
    return {
        "sport": _first(lowered, _SPORTS),
        "when": _first(lowered, _WHEN),
        "day_part": _first(lowered, _DAY_PART),
        "level": level,
        "beginners": True if level == "beginner" else None,
        "free": True if re.search(r"\bбесплатн", lowered) else None,
        "near": True if re.search(r"\b(?:рядом|недалеко|поблизости)", lowered) else None,
    }


_TOXIC = r"дурак|идиот|туп(?:ой|ая|ые)|урод|придур"
_SPAM = r"казино|ставк|заработ|кредит|промокод|подпишись|скидк\w* по ссылке"
_LINK = r"https?://|www\.|t\.me/"


def premoderate(text: str) -> dict[str, Any]:
    lowered = text.lower()
    if re.search(rf"\b(?:{_TOXIC})", lowered):
        return {"flag": "toxic", "reason": "Есть грубые выражения"}
    links = len(re.findall(_LINK, lowered))
    if links >= 2 or re.search(rf"\b(?:{_SPAM})", lowered):  # noqa: PLR2004
        return {"flag": "spam", "reason": "Похоже на рекламу или посторонние ссылки"}
    if re.search(r"предоплат|переведите|номер карты", lowered):
        return {"flag": "suspicious", "reason": "Просят перевести деньги заранее"}
    return {"flag": "none", "reason": ""}


DEFAULT_RULES: dict[str, Rule] = {"SearchIntent": parse_search, "ModerationVerdict": premoderate}


class FakeProvider:
    name = "fake"

    def __init__(
        self,
        *,
        embedding_dim: int = 256,
        delay_ms: int = 0,
        failure: FakeFailure = "none",
        rules: dict[str, Rule] | None = None,
    ) -> None:
        self.embedding_dim = embedding_dim
        self.delay_ms = delay_ms
        self.failure: FakeFailure = failure
        self.rules = rules if rules is not None else dict(DEFAULT_RULES)
        self.calls = 0

    async def _simulate(self) -> None:
        self.calls += 1
        if self.delay_ms:
            await asyncio.sleep(self.delay_ms / 1000)
        if self.failure == "timeout":
            # Дольше любого разумного таймаута: AiService прервёт ожидание сам.
            await asyncio.sleep(3600)
        if self.failure == "error":
            raise AiUnavailableError("Учебный сбой помощника")

    async def chat(self, messages: list[ChatMessage], *, schema: ResponseSchema, temperature: float) -> str:  # noqa: ARG002
        await self._simulate()
        if self.failure == "invalid":
            return "{не json"
        rule = self.rules.get(schema.name)
        if rule is None:
            raise AiUnavailableError(f"Для схемы {schema.name} нет правила")
        payload = json.loads(messages[-1].content)
        return json.dumps(rule(str(payload.get("user_text", ""))), ensure_ascii=False)

    async def embed(self, texts: list[str], *, purpose: EmbedPurpose) -> list[list[float]]:  # noqa: ARG002
        await self._simulate()
        return [self._vector(text) for text in texts]

    def _vector(self, text: str) -> list[float]:
        # Хеширование символьных триграмм: похожие строки дают близкие векторы, результат воспроизводим.
        vector = [0.0] * self.embedding_dim
        normalized = f"  {' '.join(text.lower().split())}  "
        for i in range(len(normalized) - 2):
            digest = hashlib.blake2b(normalized[i : i + 3].encode(), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "big") % self.embedding_dim
            vector[bucket] += 1.0 if digest[4] % 2 == 0 else -1.0
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]

    async def aclose(self) -> None:
        return None


class DisabledProvider:
    """Помощник выключен или не настроен: каждый вызов сразу уводит сервис на запасной путь."""

    name = "off"

    def __init__(self, reason: str = "Помощник выключен") -> None:
        self.reason = reason

    async def chat(self, messages: list[ChatMessage], *, schema: ResponseSchema, temperature: float) -> str:  # noqa: ARG002
        raise AiUnavailableError(self.reason)

    async def embed(self, texts: list[str], *, purpose: EmbedPurpose) -> list[list[float]]:  # noqa: ARG002
        raise AiUnavailableError(self.reason)

    async def aclose(self) -> None:
        return None
