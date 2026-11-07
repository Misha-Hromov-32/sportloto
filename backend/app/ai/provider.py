from dataclasses import dataclass
from typing import Any, Literal, Protocol

Role = Literal["system", "user", "assistant"]
EmbedPurpose = Literal["doc", "query"]


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True, slots=True)
class ResponseSchema:
    name: str
    description: str
    json_schema: dict[str, Any]


class AiProvider(Protocol):
    """Провайдер модели в терминах OpenAI-совместимого API.

    Сообщения с ролями system/user/assistant, ответ по JSON-схеме, эмбеддинги.

    `chat` возвращает сырой JSON-текст: проверку по схеме делает AiService, а не адаптер.
    """

    name: str

    async def chat(
        self, messages: list[ChatMessage], *, schema: ResponseSchema, temperature: float
    ) -> str: ...

    async def embed(self, texts: list[str], *, purpose: EmbedPurpose) -> list[list[float]]: ...

    async def aclose(self) -> None: ...
