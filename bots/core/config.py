"""Настройки бота из переменных окружения."""

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_SITE = "https://sport.up-point.tech"


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def default_db_path(platform: str) -> str:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "sport-i-tochka"
    else:
        base = Path("/data")
    return str(base / f"{platform}-bot.sqlite")


@dataclass
class Config:
    platform: str
    site_url: str = DEFAULT_SITE
    public_site_url: str = DEFAULT_SITE
    bot_secret: str = ""
    db_path: str = ""
    notify_interval: int = 30
    store_key: str = ""
    telegram_token: str = ""
    telegram_proxy: str = ""
    vk_token: str = ""
    vk_group_id: str = "242415813"
    # Сколько секунд можно нажать «Вернуть» после решения по заявке.
    undo_seconds: float = 5.0
    # Не больше стольких сообщений в минуту от одного чата.
    messages_per_minute: int = 30
    assistant_timeout: float = 60.0
    extra: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls, platform: str) -> "Config":
        site = (os.environ.get("SITE_URL") or DEFAULT_SITE).rstrip("/")
        public = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
        if not public:
            public = site if site.startswith("https://") else DEFAULT_SITE
        return cls(
            platform=platform,
            site_url=site,
            public_site_url=public,
            bot_secret=os.environ.get("BOT_API_SECRET", ""),
            db_path=os.environ.get("BOT_DB_PATH") or default_db_path(platform),
            notify_interval=max(10, _int("NOTIFY_INTERVAL", 30)),
            store_key=os.environ.get("BOT_STORE_KEY", ""),
            telegram_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
            telegram_proxy=os.environ.get("TELEGRAM_PROXY", ""),
            vk_token=os.environ.get("VK_GROUP_TOKEN", ""),
            vk_group_id=os.environ.get("VK_GROUP_ID") or "242415813",
        )
