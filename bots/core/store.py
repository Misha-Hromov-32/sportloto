"""Состояние бота в SQLite: чаты и привязки, история для помощника, шаги сценариев, кнопки,
отправленные уведомления и коды привязки, которые ждут подтверждения на сайте."""

import contextlib
import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from bots.core.vault import PlainVault, Vault

HISTORY_LIMIT = 12

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    key TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    token TEXT,
    user_id TEXT,
    user_name TEXT,
    city TEXT NOT NULL DEFAULT 'krasnoyarsk',
    notify_mode TEXT NOT NULL DEFAULT 'all',
    quiet INTEGER NOT NULL DEFAULT 1,
    reachable INTEGER NOT NULL DEFAULT 1,
    created REAL NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_chat ON history(chat, id);
CREATE TABLE IF NOT EXISTS state (
    chat TEXT PRIMARY KEY,
    flow TEXT NOT NULL,
    data TEXT NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS buttons (
    id TEXT PRIMARY KEY,
    chat TEXT NOT NULL,
    payload TEXT NOT NULL,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sent (
    chat TEXT NOT NULL,
    notification TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    at REAL NOT NULL,
    PRIMARY KEY (chat, notification)
);
CREATE TABLE IF NOT EXISTS codes (
    chat TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
    hash TEXT PRIMARY KEY,
    ref TEXT NOT NULL,
    at REAL NOT NULL
);
"""


@dataclass
class Chat:
    key: str
    platform: str
    chat_id: str
    display_name: str
    token: str | None
    user_id: str | None
    user_name: str | None
    city: str
    notify_mode: str
    quiet: bool
    reachable: bool

    @property
    def linked(self) -> bool:
        return bool(self.token)


def chat_key(platform: str, chat_id: str) -> str:
    return f"{platform}:{chat_id}"


class Store:
    def __init__(self, path: str, vault: Vault | None = None) -> None:
        self.vault = vault or PlainVault()
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        if path != ":memory:" and os.name != "nt":
            with contextlib.suppress(OSError):
                Path(path).chmod(0o600)

    def close(self) -> None:
        self.db.close()

    # ---------- Чаты ----------

    def chat(self, platform: str, chat_id: str, display_name: str = "") -> Chat:
        key = chat_key(platform, chat_id)
        row = self.db.execute("SELECT * FROM chats WHERE key = ?", (key,)).fetchone()
        now = time.time()
        if row is None:
            self.db.execute(
                "INSERT INTO chats (key, platform, chat_id, display_name, created, updated)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (key, platform, chat_id, display_name, now, now),
            )
            row = self.db.execute("SELECT * FROM chats WHERE key = ?", (key,)).fetchone()
        elif display_name and row["display_name"] != display_name:
            self.db.execute("UPDATE chats SET display_name = ? WHERE key = ?", (display_name, key))
        return self._chat(row, display_name or row["display_name"])

    def get_chat(self, key: str) -> Chat | None:
        row = self.db.execute("SELECT * FROM chats WHERE key = ?", (key,)).fetchone()
        return self._chat(row, row["display_name"]) if row else None

    def _chat(self, row: sqlite3.Row, name: str) -> Chat:
        token = None
        if row["token"]:
            try:
                token = self.vault.open(row["token"])
            except Exception:
                token = None
        return Chat(
            key=row["key"],
            platform=row["platform"],
            chat_id=row["chat_id"],
            display_name=name,
            token=token,
            user_id=row["user_id"],
            user_name=row["user_name"],
            city=row["city"],
            notify_mode=row["notify_mode"],
            quiet=bool(row["quiet"]),
            reachable=bool(row["reachable"]),
        )

    def linked_chats(self, platform: str) -> list[Chat]:
        rows = self.db.execute(
            "SELECT * FROM chats WHERE platform = ? AND token IS NOT NULL AND token != ''", (platform,)
        ).fetchall()
        return [self._chat(r, r["display_name"]) for r in rows]

    def set_link(self, key: str, token: str | None, user_id: str | None, user_name: str | None) -> None:
        self.db.execute(
            "UPDATE chats SET token = ?, user_id = ?, user_name = ?, updated = ? WHERE key = ?",
            (self.vault.seal(token) if token else None, user_id, user_name, time.time(), key),
        )

    def update_chat(self, key: str, **fields: Any) -> None:
        allowed = {"city", "notify_mode", "quiet", "reachable", "display_name"}
        sets = {k: (int(v) if isinstance(v, bool) else v) for k, v in fields.items() if k in allowed}
        if not sets:
            return
        cols = ", ".join(f"{k} = ?" for k in sets)
        self.db.execute(
            f"UPDATE chats SET {cols}, updated = ? WHERE key = ?",  # noqa: S608  имена колонок из белого списка
            (*sets.values(), time.time(), key),
        )

    # ---------- История для помощника ----------

    def add_history(self, chat: str, role: str, text: str) -> None:
        self.db.execute("INSERT INTO history (chat, role, text) VALUES (?, ?, ?)", (chat, role, text[:3000]))
        self.db.execute(
            "DELETE FROM history WHERE chat = ? AND id NOT IN"
            " (SELECT id FROM history WHERE chat = ? ORDER BY id DESC LIMIT ?)",
            (chat, chat, HISTORY_LIMIT),
        )

    def history(self, chat: str) -> list[dict[str, str]]:
        rows = self.db.execute(
            "SELECT role, text FROM history WHERE chat = ? ORDER BY id DESC LIMIT ?", (chat, HISTORY_LIMIT)
        ).fetchall()
        return [{"role": r["role"], "text": r["text"]} for r in reversed(rows)]

    def clear_history(self, chat: str) -> None:
        self.db.execute("DELETE FROM history WHERE chat = ?", (chat,))

    # ---------- Шаг сценария ----------

    def state(self, chat: str) -> tuple[str | None, dict[str, Any]]:
        row = self.db.execute("SELECT flow, data FROM state WHERE chat = ?", (chat,)).fetchone()
        if row is None:
            return None, {}
        return row["flow"], json.loads(row["data"])

    def set_state(self, chat: str, flow: str, data: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT INTO state (chat, flow, data, updated) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(chat) DO UPDATE SET flow = excluded.flow, data = excluded.data,"
            " updated = excluded.updated",
            (chat, flow, json.dumps(data, ensure_ascii=False), time.time()),
        )

    def clear_state(self, chat: str) -> None:
        self.db.execute("DELETE FROM state WHERE chat = ?", (chat,))

    # ---------- Кнопки: в мессенджер уходит короткий номер, данные остаются здесь ----------

    def put_button(self, chat: str, payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        bid = hashlib.sha256(f"{chat}|{raw}".encode()).hexdigest()[:12]
        self.db.execute(
            "INSERT INTO buttons (id, chat, payload, created) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET created = excluded.created",
            (bid, chat, raw, time.time()),
        )
        return bid

    def button(self, chat: str, bid: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT chat, payload FROM buttons WHERE id = ?", (bid,)).fetchone()
        if row is None or row["chat"] != chat:
            return None
        return json.loads(row["payload"])

    # ---------- Уведомления ----------

    def sent_status(self, chat: str, notification: str) -> str | None:
        row = self.db.execute(
            "SELECT status FROM sent WHERE chat = ? AND notification = ?", (chat, notification)
        ).fetchone()
        return row["status"] if row else None

    def mark_sent(
        self, chat: str, notification: str, status: str, payload: dict[str, Any] | None = None
    ) -> None:
        self.db.execute(
            "INSERT INTO sent (chat, notification, status, payload, at) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(chat, notification) DO UPDATE SET status = excluded.status,"
            " payload = excluded.payload, at = excluded.at",
            (chat, notification, status, json.dumps(payload or {}, ensure_ascii=False), time.time()),
        )

    def held(self, chat: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT notification, payload FROM sent WHERE chat = ? AND status = 'held' ORDER BY at", (chat,)
        ).fetchall()
        return [{"id": r["notification"], **json.loads(r["payload"] or "{}")} for r in rows]

    # ---------- Коды привязки из бота ----------

    def put_code(self, chat: str, code: str, expires: float) -> None:
        self.db.execute(
            "INSERT INTO codes (chat, code, expires) VALUES (?, ?, ?)"
            " ON CONFLICT(chat) DO UPDATE SET code = excluded.code, expires = excluded.expires",
            (chat, code, expires),
        )

    def codes(self) -> list[tuple[str, str, float]]:
        rows = self.db.execute("SELECT chat, code, expires FROM codes").fetchall()
        return [(r["chat"], r["code"], r["expires"]) for r in rows]

    def drop_code(self, chat: str) -> None:
        self.db.execute("DELETE FROM codes WHERE chat = ?", (chat,))

    # ---------- Загруженные в мессенджер картинки ----------

    def media(self, digest: str) -> str | None:
        row = self.db.execute("SELECT ref FROM media WHERE hash = ?", (digest,)).fetchone()
        return row["ref"] if row else None

    def put_media(self, digest: str, ref: str) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO media (hash, ref, at) VALUES (?, ?, ?)", (digest, ref, time.time())
        )

    def cleanup(self, now: float | None = None) -> None:
        now = now or time.time()
        self.db.execute("DELETE FROM buttons WHERE created < ?", (now - 45 * 86400,))
        self.db.execute("DELETE FROM sent WHERE at < ? AND status != 'held'", (now - 60 * 86400,))
        self.db.execute("DELETE FROM codes WHERE expires < ?", (now,))
        self.db.execute("DELETE FROM state WHERE updated < ?", (now - 7 * 86400,))
