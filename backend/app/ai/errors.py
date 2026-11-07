class AiError(Exception):
    """Сбой помощника. Сервисы ловят его и идут запасным путём: форма, фильтры, правила."""

    kind = "error"


class AiTimeoutError(AiError):
    kind = "timeout"


class AiUnavailableError(AiError):
    kind = "unavailable"


class AiInvalidResponseError(AiError):
    kind = "invalid_response"


class AiRateLimitedError(AiError):
    kind = "rate_limited"
