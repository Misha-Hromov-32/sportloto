from app.api.schemas.base import ApiModel


class AiUsageOut(ApiModel):
    kind: str
    total: int
    succeeded: int
    fallbacks: int
    cached: int
    avg_ms: int
    p95_ms: int
