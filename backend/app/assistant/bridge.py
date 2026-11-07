"""Мост на компьютере: программа на ПК подключается по WebSocket и отвечает на вопросы помощника.

Протокол (JSON-сообщения):
- мост → сервер: `{"type": "hello", "key": "stb_…", "name": "Мой ПК", "engine": "codex", "version": "1.0"}`;
- сервер → мост: `{"type": "ready"}` или `{"type": "error", "message": …}` и закрытие;
- сервер → мост: `{"type": "request", "id": …, "prompt": …, "schema": {...}, "timeoutSeconds": 45}`;
- мост → сервер: `{"type": "response", "id": …, "ok": true, "content": "<JSON-текст ответа>"}`
  или `{"type": "response", "id": …, "ok": false, "error": "…"}`;
- картинка (мост с версии 1.1.0): `{"type": "request", "id": …, "task": "image", "prompt": …,
  "timeoutSeconds": 170}` без schema; ответ тот же, content — `data:image/png;base64,…`.
  Мостам старше 1.1.0 задание с картинкой не отправляется;
- обе стороны: `{"type": "ping"}` / `{"type": "pong"}` раз в 20 секунд, чтобы прокси не рвали соединение.

Сервер работает в одном процессе (deploy/backend.Dockerfile, `--workers 1`), поэтому подключения
живут в памяти. Подключено несколько мостов — вопрос получает наименее занятый.
"""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

PING_SECONDS = 20
HELLO_TIMEOUT_SECONDS = 10
IMAGE_MIN_VERSION = (1, 1, 0)


def _version(value: str) -> tuple[int, ...]:
    parts = []
    for piece in value.split(".")[:3]:
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts + [0] * (3 - len(parts)))


class BridgeUnavailableError(RuntimeError):
    pass


@dataclass(eq=False)
class _Client:
    ws: WebSocket
    name: str
    engine: str
    version: str
    connected_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    answered: int = 0
    pending: dict[str, asyncio.Future[str]] = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send(self, message: dict[str, Any]) -> None:
        async with self.send_lock:
            await self.ws.send_text(json.dumps(message, ensure_ascii=False))


class BridgeHub:
    def __init__(self) -> None:
        self._clients: list[_Client] = []

    @property
    def connected(self) -> bool:
        return bool(self._clients)

    @property
    def can_draw(self) -> bool:
        """Подключён мост, который умеет рисовать картинки (версия 1.1.0 и новее)."""
        return any(_version(c.version) >= IMAGE_MIN_VERSION for c in self._clients)

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "clients": [
                {
                    "name": c.name,
                    "engine": c.engine,
                    "version": c.version,
                    "connectedAt": int(c.connected_at * 1000),
                    "lastSeenAt": int(c.last_seen * 1000),
                    "answered": c.answered,
                    "busy": len(c.pending),
                }
                for c in self._clients
            ],
        }

    async def ask(self, prompt: str, schema: dict[str, Any], wait: float) -> str:
        if not self._clients:
            raise BridgeUnavailableError("Мост не подключён")
        client = min(self._clients, key=lambda c: len(c.pending))
        return await self._request(client, {"prompt": prompt, "schema": schema}, wait)

    async def draw(self, prompt: str, wait: float) -> str:
        """Картинка от моста: строка `data:image/png;base64,…` (проверяет вызывающий)."""
        able = [c for c in self._clients if _version(c.version) >= IMAGE_MIN_VERSION]
        if not able:
            raise BridgeUnavailableError(
                "Обновите мост на компьютере" if self._clients else "Мост не подключён"
            )
        client = min(able, key=lambda c: len(c.pending))
        return await self._request(client, {"task": "image", "prompt": prompt}, wait)

    async def _request(self, client: _Client, payload: dict[str, Any], wait: float) -> str:
        request_id = uuid.uuid4().hex
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        client.pending[request_id] = future
        try:
            await client.send({"type": "request", "id": request_id, **payload, "timeoutSeconds": wait})
            return await asyncio.wait_for(future, wait)
        except TimeoutError as exc:
            raise BridgeUnavailableError("Мост не ответил вовремя") from exc
        finally:
            client.pending.pop(request_id, None)

    async def serve(self, ws: WebSocket, check_key: Callable[[str], Awaitable[bool]]) -> None:  # noqa: C901, PLR0912
        """Жизнь одного подключения: приветствие с ключом, затем приём ответов и пинги."""
        await ws.accept()
        try:
            hello = json.loads(await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT_SECONDS))
        except (TimeoutError, ValueError):
            await ws.close(code=4400)
            return
        if (
            not isinstance(hello, dict)
            or hello.get("type") != "hello"
            or not await check_key(str(hello.get("key") or ""))
        ):
            with contextlib.suppress(Exception):
                await ws.send_text(json.dumps({"type": "error", "message": "Неверный ключ моста"}))
                await ws.close(code=4401)
            return
        client = _Client(
            ws=ws,
            name=str(hello.get("name") or "Компьютер")[:60],
            engine=str(hello.get("engine") or "codex")[:30],
            version=str(hello.get("version") or "")[:20],
        )
        self._clients.append(client)
        logger.info("Мост подключён: %s (%s)", client.name, client.engine)
        pinger = asyncio.create_task(self._ping(client))
        try:
            await client.send({"type": "ready"})
            while True:
                raw = await ws.receive_text()
                client.last_seen = time.time()
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(message, dict):
                    continue
                if message.get("type") == "ping":
                    await client.send({"type": "pong"})
                elif message.get("type") == "response":
                    future = client.pending.get(str(message.get("id")))
                    if future is None or future.done():
                        continue
                    if message.get("ok"):
                        client.answered += 1
                        future.set_result(str(message.get("content") or ""))
                    else:
                        future.set_exception(
                            BridgeUnavailableError(str(message.get("error") or "Мост не ответил"))
                        )
        except Exception as exc:  # noqa: BLE001  разрыв соединения любого рода — просто отключаем мост
            logger.debug("Соединение с мостом закрыто: %s", exc.__class__.__name__)
        finally:
            pinger.cancel()
            self._clients = [c for c in self._clients if c is not client]
            for future in client.pending.values():
                if not future.done():
                    future.set_exception(BridgeUnavailableError("Мост отключился"))
            logger.info("Мост отключён: %s", client.name)

    @staticmethod
    async def _ping(client: _Client) -> None:
        with contextlib.suppress(Exception):
            while True:
                await asyncio.sleep(PING_SECONDS)
                await client.send({"type": "ping"})


hub = BridgeHub()
