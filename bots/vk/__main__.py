"""Запуск VK-бота: python -m bots.vk. Без ключа сообщества сервис не падает, а ждёт его."""

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
from bots.vk.adapter import VkMessenger

log = logging.getLogger("bots.vk")


async def main() -> int:
    cfg = Config.from_env("vk")
    logs.setup([cfg.vk_token, cfg.bot_secret, cfg.store_key])
    if not cfg.vk_token:
        log.warning(
            "VK_GROUP_TOKEN не задан: VK-бот выключен. Задайте ключ сообщества (scripts/set-vk-bot-token.ps1) "
            "и перезапустите сервис vk-bot"
        )
        await asyncio.Event().wait()
    if not cfg.bot_secret:
        log.warning("Не задан BOT_API_SECRET: подключить аккаунт сайта через бота не получится")
    store = Store(cfg.db_path, make_vault(cfg.store_key))
    site = SiteClient(cfg.site_url, cfg.bot_secret, assistant_timeout=cfg.assistant_timeout)
    vk = VkMessenger(cfg.vk_token, cfg.vk_group_id, store=store)
    bot = Bot(cfg, vk, store, site)
    log.info("VK-бот запущен, сообщество %s, сайт %s", cfg.vk_group_id, cfg.site_url)
    try:
        await asyncio.gather(vk.run(bot), bot.background())
    finally:
        await vk.close()
        await site.close()
        store.close()
    return 0


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        sys.exit(asyncio.run(main()))
