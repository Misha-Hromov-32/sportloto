import logging

from app.ai.fake import DisabledProvider, FakeProvider
from app.ai.gigachat import GigaChatProvider
from app.ai.provider import AiProvider
from app.ai.yandexgpt import YandexGptProvider
from app.core.config import Settings

logger = logging.getLogger(__name__)


def build_provider(settings: Settings) -> AiProvider:
    """Провайдер по AI_PROVIDER.

    Без ключа помощник выключается, а не роняет приложение: S1–S6 от него не зависят.
    """
    match settings.ai_provider:
        case "fake":
            return FakeProvider(
                embedding_dim=settings.ai_embedding_dim,
                delay_ms=settings.ai_fake_delay_ms,
                failure=settings.ai_fake_failure,
            )
        case "gigachat":
            try:
                return GigaChatProvider(settings)
            except ValueError as exc:
                logger.warning("Помощник выключен: %s", exc)
                return DisabledProvider(str(exc))
        case "yandexgpt":
            try:
                return YandexGptProvider(settings)
            except ValueError as exc:
                logger.warning("Помощник выключен: %s", exc)
                return DisabledProvider(str(exc))
        case "off":
            return DisabledProvider()
