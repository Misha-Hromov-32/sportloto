"""Журнал без ключей: адреса API Telegram содержат ключ бота, ответы сайта — ключи людей."""

import logging
import re

_PATTERNS = [
    re.compile(r"bot\d+:[\w-]+"),
    re.compile(r"stb_[\w-]+"),
    re.compile(r"(access_token=)[^&\s]+"),
]


class RedactingFormatter(logging.Formatter):
    def __init__(self, fmt: str, secrets: list[str]) -> None:
        super().__init__(fmt)
        self.secrets = [s for s in secrets if s and len(s) >= 8]

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        for secret in self.secrets:
            text = text.replace(secret, "***")
        for pattern in _PATTERNS:
            text = pattern.sub(lambda m: (m.group(1) if m.groups() else "") + "***", text)
        return text


def setup(secrets: list[str]) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s", secrets))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    # httpx пишет каждый адрес запроса, а в адресе Telegram — ключ бота.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
