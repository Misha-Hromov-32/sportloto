import logging
import os
from datetime import UTC, datetime

import pytest

from bots.core import fmt, logs
from bots.core.flows.create import parse_date, parse_time
from bots.core.render import Incoming
from bots.core.store import Store
from bots.core.vault import FernetVault, PlainVault

from .conftest import Harness


def test_long_button_payload_gets_short_id():
    store = Store(":memory:")
    payload = {
        "a": "more",
        "f": [{"field": "q", "operator": "eq", "value": "волейбол " * 200}],
        "s": ["e-1"] * 50,
    }
    bid = store.put_button("telegram:1", payload)
    assert len(bid) == 12
    assert len(f"b:{bid}".encode()) <= 64
    assert store.button("telegram:1", bid) == payload
    assert store.put_button("telegram:1", payload) == bid
    assert store.button("telegram:2", bid) is None  # чужой чат не нажмёт чужую кнопку


def test_history_is_limited_to_twelve():
    store = Store(":memory:")
    for i in range(20):
        store.add_history("c", "user", f"m{i}")
    rows = store.history("c")
    assert len(rows) == 12
    assert rows[0]["text"] == "m8"


def test_tokens_are_sealed_in_store(tmp_path):
    pytest.importorskip("cryptography")
    from cryptography.fernet import Fernet

    path = tmp_path / "bot.sqlite"
    store = Store(str(path), FernetVault(Fernet.generate_key().decode()))
    chat = store.chat("vk", "42", "Анна")
    store.set_link(chat.key, "stb_secret_value", "u-1", "Анна")
    assert store.get_chat(chat.key).token == "stb_secret_value"
    raw = store.db.execute("SELECT token FROM chats").fetchone()[0]
    assert raw.startswith("fernet:")
    assert "stb_secret_value" not in raw
    if os.name != "nt":
        assert oct(path.stat().st_mode & 0o777) == "0o600"


@pytest.mark.skipif(os.name != "nt", reason="DPAPI есть только в Windows")
def test_dpapi_roundtrip():
    from bots.core.vault import DpapiVault

    vault = DpapiVault()
    sealed = vault.seal("stb_secret_value")
    assert sealed.startswith("dpapi:")
    assert "stb_secret_value" not in sealed
    assert vault.open(sealed) == "stb_secret_value"


def test_plain_vault():
    assert PlainVault().open(PlainVault().seal("x")) == "x"


def test_logs_hide_secrets():
    fmt_ = logs.RedactingFormatter("%(message)s", ["VKTOKEN_LONG_VALUE"])
    record = logging.LogRecord(
        "x",
        logging.INFO,
        "",
        0,
        "POST https://api.telegram.org/bot123:ABC-def/getUpdates %s %s",
        ("stb_abc", "VKTOKEN_LONG_VALUE"),
        None,
    )
    out = fmt_.format(record)
    assert "ABC-def" not in out
    assert "stb_abc" not in out
    assert "VKTOKEN_LONG_VALUE" not in out


def test_parse_date_and_time():
    now = datetime(2030, 10, 20, 12, 0, tzinfo=UTC)
    assert parse_date("25.10", now).isoformat() == "2030-10-25"
    assert parse_date("25 октября", now).isoformat() == "2030-10-25"
    assert parse_date("1.02", now).isoformat() == "2031-02-01"
    assert parse_date("завтра", now).isoformat() == "2030-10-21"
    assert parse_date("в субботу", now).isoformat() == "2030-10-26"
    assert parse_date("когда-нибудь", now) is None
    assert parse_time("19:30") == "19:30"
    assert parse_time("в 7") == "07:00"
    assert parse_time("25:00") is None


def test_card_text_format():
    from .conftest import event

    text = fmt.card_text(event(), "krasnoyarsk")
    lines = text.splitlines()
    assert lines[0] == "🏐 Волейбол в зале"
    assert lines[1].startswith("Чт, 24 октября · 19:30")
    assert lines[2] == "📍 ул. Лады Кецховели, 22"
    assert lines[4] == "💳 300 ₽ · для любителей"
    assert lines[5] == "Организатор: Дмитрий Орлов"


async def test_rate_limit_per_chat(h: Harness):
    h.bot.config.messages_per_minute = 3
    for _ in range(5):
        await h.text("/help")
    assert h.msg.texts().count("Вы пишете слишком часто. Подождите минуту, и я отвечу.") == 1
    assert len(h.msg.sent) == 4


async def test_settings_city_and_quiet(h: Harness):
    await h.text("/settings")
    assert "Город: Красноярск" in h.msg.last().text
    await h.text("/city")
    await h.press("Москва")
    assert h.bot.store.get_chat("telegram:100").city == "moscow"
    await h.text("/settings")
    await h.press("Тихие часы: выключить")
    assert h.bot.store.get_chat("telegram:100").quiet is False
    await h.text("/settings")
    await h.press("Уведомления: все")
    await h.press("Только важные")
    assert h.bot.store.get_chat("telegram:100").notify_mode == "important"


async def test_unknown_command_and_stale_button(h: Harness):
    await h.text("/nothing")
    assert h.msg.last().text == "Такой команды нет. Все команды — /help"
    await h.bot.handle(
        Incoming(chat_id="100", user_id="100", name="", kind="button", data="zzz", callback="c")
    )
    assert h.msg.last().text == "Эта кнопка устарела. Откройте меню: /start"


async def test_vk_ref_start_links(h: Harness):
    h.bot.messenger.platform = "vk"
    await h.bot.handle(Incoming(chat_id="42", user_id="42", name="Анна Соколова", kind="start", ref="123456"))
    call = h.site.find("POST", "/api/bots/link")[0]
    assert call.body["platform"] == "vk"
    assert call.body["externalId"] == "42"
    assert h.bot.store.get_chat("vk:42").linked
