"""Демо-данные В1: у Анны токен «Мой ассистент» только на чтение и несколько вызовов в журнале."""

from collections.abc import Callable

from app.domain.types import Entity

DAY_MINUTES = 24 * 60
TOKEN_AGE_DAYS = 3
TOKEN_EXPIRY_DAYS = 90


def seed_mcp(ago: Callable[[float], str]) -> dict[str, list[Entity]]:
    token: Entity = {
        "id": "mcp-anna",
        "userId": "u-anna",
        "name": "Мой ассистент",
        "scopes": ["read"],
        # Хеш токена, выпущенного при подготовке демо; сам токен не сохранён, как и у любого выпущенного.
        "hash": "5aa2808bd92b9fc7824e2879fa801fadc68868289a879a482ecb5c365f7db74a",
        "last4": "Txxd",
        "createdAt": ago(TOKEN_AGE_DAYS * DAY_MINUTES),
        # Срок — 90 дней с выпуска: отрицательное «назад» — момент в будущем.
        "expiresAt": ago((TOKEN_AGE_DAYS - TOKEN_EXPIRY_DAYS) * DAY_MINUTES),
        "lastUsedAt": ago(39),
        "revokedAt": None,
    }

    def call(id_: str, minutes: int, method: str, tool: str | None, error: str | None = None) -> Entity:
        return {
            "id": id_,
            "tokenId": token["id"],
            "userId": token["userId"],
            "at": ago(minutes),
            "method": method,
            "tool": tool,
            "ok": not error,
            "error": error,
        }

    return {
        "mcpTokens": [token],
        "mcpCalls": [
            call("mcpc-1", 39, "tools/call", "join_event", "forbidden_scope"),
            call("mcpc-2", 40, "tools/call", "my_schedule"),
            call("mcpc-3", 26 * 60, "tools/call", "get_event"),
            call("mcpc-4", 26 * 60 + 1, "tools/call", "search_events"),
        ],
    }
