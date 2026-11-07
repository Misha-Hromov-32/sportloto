"""Запуск Telegram-бота: python -m bots.telegram (переменные окружения — bots/README.md)."""

import asyncio
import contextlib
import logging
import sys

from bots.core import logs
from bots.core.config import Config
from bots.core.engine import Bot
from bots.core.site_client import SiteClient
from bots.core.store import Store
from bots.core.vault import make_vault
from bots.telegram.adapter import TelegramError, TelegramMessenger

log = logging.getLogger("bots.telegram")


async def main() -> int:
    cfg = Config.from_env("telegram")
    logs.setup([cfg.telegram_token, cfg.bot_secret, cfg.store_key, cfg.telegram_proxy])
    if not cfg.telegram_token:
        log.error("Не задан TELEGRAM_BOT_TOKEN. Запустите scripts/set-telegram-bot.ps1")
        return 2
    if not cfg.bot_secret:
        log.warning("Не задан BOT_API_SECRET: подключить аккаунт сайта через бота не получится")
    store = Store(cfg.db_path, make_vault(cfg.store_key))
    site = SiteClient(cfg.site_url, cfg.bot_secret, assistant_timeout=cfg.assistant_timeout)
    tg = TelegramMessenger(cfg.telegram_token, proxy=cfg.telegram_proxy or None)
    bot = Bot(cfg, tg, store, site)
    try:
        me = await tg.call("getMe")
        log.info("бот @%s запущен, сайт %s", (me or {}).get("username"), cfg.site_url)
        await tg.set_commands()
    except TelegramError as exc:
        log.warning("Telegram пока не отвечает (%s): бот будет пробовать снова", exc.code)
    try:
        await asyncio.gather(tg.run(bot), bot.background())
    finally:
        await tg.close()
        await site.close()
        store.close()
    return 0


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        sys.exit(asyncio.run(main()))
