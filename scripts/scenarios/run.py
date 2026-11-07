"""Сценарии запросов к HTTP API: коды ответов и ошибки сервера.

Сервер поднимается в процессе (httpx + ASGI) на отдельной базе `vmeste_scenarios`, часы правил заморожены,
демо-данные загружаются заново. Перед каждым шагом выполняются проверки по времени, как фоновый тик.

Результат — код ответа и код ошибки каждого шага. С `--expect` коды сравниваются с записанными ранее;
ответ 5xx — всегда ошибка. Запуск — в контейнере бэкенда (см. scripts/scenarios/README.md):
    python /scenarios/run.py <сценарий.json> [--expect коды.json] [--out коды.json]
"""

import argparse
import asyncio
import json
import os
import re
import sys
from collections.abc import Awaitable, Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.domain import clock, provider, seed, store
from app.main import create_app

BACKEND = Path(os.environ.get("BACKEND_DIR", "/app"))
DATABASE_URL = os.environ.get(
    "SCENARIOS_DATABASE_URL", "postgresql+asyncpg://vmeste:vmeste@db:5432/vmeste_scenarios"
)
NOW = os.environ.get("SCENARIOS_NOW", "2026-10-19T03:00:00.000Z")


async def _ensure_database(url: str) -> None:
    parsed = make_url(url)
    connection = await asyncpg.connect(
        host=parsed.host,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        database="postgres",
    )
    try:
        if not await connection.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", parsed.database):
            await connection.execute(f'CREATE DATABASE "{parsed.database}"')
    finally:
        await connection.close()


def _migrate(url: str) -> None:
    config = Config(str(BACKEND / "alembic.ini"))
    config.attributes["database_url"] = url
    config.attributes["configure_logger"] = False
    command.downgrade(config, "base")
    command.upgrade(config, "head")


def resolve(value: Any, results: list[Any]) -> Any:
    """«{{3.ok.id}}» в строках шага — значение из ответа шага 3."""
    if isinstance(value, str):
        whole = re.fullmatch(r"\{\{(\d+)\.([^}]+)\}\}", value)
        if whole:
            return pick(results[int(whole.group(1))], whole.group(2))
        return re.sub(
            r"\{\{(\d+)\.([^}]+)\}\}", lambda m: str(pick(results[int(m.group(1))], m.group(2))), value
        )
    if isinstance(value, list):
        return [resolve(v, results) for v in value]
    if isinstance(value, dict):
        return {k: resolve(v, results) for k, v in value.items()}
    return value


def pick(result: Any, path: str) -> Any:
    for key in path.split("."):
        if isinstance(result, dict):
            result = result.get(key)
        elif isinstance(result, list) and key.isdigit():
            result = result[int(key)] if int(key) < len(result) else None
        else:
            return None
    return result


class Runner:
    def __init__(self, client: httpx.AsyncClient, email_of: Callable[[str], Awaitable[str | None]]) -> None:
        self.client = client
        self.email_of = email_of
        self.tokens: dict[str, str] = {}

    async def headers(self, user_id: str | None) -> dict[str, str]:
        headers = {"X-City": "krasnoyarsk"}
        if not user_id:
            return headers
        if user_id not in self.tokens:
            res = await self.client.post("/api/auth/demo-login", json={"userId": user_id})
            if res.status_code != 200:
                # Не демо-аккаунт, а участник из демо-данных: вход по почте без пароля.
                email = await self.email_of(user_id)
                if email:
                    res = await self.client.post("/api/auth/login", json={"email": email, "password": ""})
            if res.status_code != 200:
                msg = f"Не удалось войти как {user_id}: {res.text}"
                raise RuntimeError(msg)
            self.tokens[user_id] = res.json()["token"]
            # Вход ставит cookie сессии; шаги гостя и других ролей не должны её отправлять.
            self.client.cookies.clear()
        headers["Authorization"] = f"Bearer {self.tokens[user_id]}"
        return headers

    async def request(self, step: dict[str, Any], headers: dict[str, str]) -> httpx.Response:
        op = step["op"]
        resource = step.get("resource")
        if op == "list":
            params = {
                "filters": json.dumps(step.get("filters") or [], ensure_ascii=False),
                "sorters": json.dumps(step.get("sorters") or [], ensure_ascii=False),
                "pagination": json.dumps(step.get("pagination") or {"mode": "off"}),
            }
            return await self.client.get(f"/api/{resource}", params=params, headers=headers)
        if op == "one":
            params = {"meta": json.dumps(step["meta"])} if step.get("meta") else None
            return await self.client.get(f"/api/{resource}/{step['id']}", params=params, headers=headers)
        if op == "many":
            ids = ",".join(step["ids"])
            return await self.client.get(f"/api/_many/{resource}", params={"ids": ids}, headers=headers)
        if op == "create":
            return await self.client.post(f"/api/{resource}", json=step.get("body") or {}, headers=headers)
        if op == "update":
            url = f"/api/{resource}/{step['id']}"
            return await self.client.put(url, json=step.get("body") or {}, headers=headers)
        if op == "delete":
            return await self.client.delete(f"/api/{resource}/{step['id']}", headers=headers)
        if op == "custom":
            method = str(step.get("method") or "get").upper()
            query = {
                k: v if isinstance(v, str) else json.dumps(v) for k, v in (step.get("query") or {}).items()
            }
            return await self.client.request(
                method,
                f"/api{step['url']}",
                params=query or None,
                json=step.get("body") if method != "GET" else None,
                headers=headers,
            )
        if op == "register":
            return await self.client.post("/api/auth/register", json=step.get("body") or {}, headers=headers)
        if op == "delete-account":
            body = step.get("body") or {}
            return await self.client.post("/api/auth/delete-account", json=body, headers=headers)
        msg = f"Неизвестный шаг {op}"
        raise ValueError(msg)

    async def step(self, step: dict[str, Any]) -> dict[str, Any]:
        res = await self.request(step, await self.headers(step.get("as")))
        body = res.json() if res.content and "json" in res.headers.get("content-type", "") else None
        if step["op"] == "register" and res.status_code == 200:
            self.tokens[body["id"]] = body["token"]
            self.client.cookies.clear()
        if step["op"] == "delete-account" and res.status_code == 200:
            self.tokens.pop(str(step.get("as")), None)
        if res.status_code >= 400:
            code = body.get("code") if isinstance(body, dict) else None
            return {"status": res.status_code, "code": code, "message": (body or {}).get("message")}
        return {"status": res.status_code, "ok": body}


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    parser.add_argument("--expect", help="коды ответов прошлого прогона (--out)")
    parser.add_argument("--out", help="куда записать коды ответов")
    parser.add_argument("--skip-ticks", action="store_true", help="Обход чтений без повторного фонового тика перед каждым запросом")
    args = parser.parse_args()
    steps = json.loads(Path(args.scenario).read_text())
    expected = json.loads(Path(args.expect).read_text()) if args.expect else None

    await _ensure_database(DATABASE_URL)
    await asyncio.to_thread(_migrate, DATABASE_URL)
    now = clock.parse(NOW)
    clock.set_frozen(now)
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        app_env="test",
        database_url=DATABASE_URL,
        domain_strict=True,
        demo_seed_on_start=False,
        domain_tick_seconds=0,
    )
    app = create_app(settings)
    runtime = app.state.domain
    await asyncio.to_thread(runtime.store.write, lambda: provider.load_seed(seed.build_seed(now)))

    results: list[Any] = []
    codes: list[dict[str, Any]] = []
    problems: list[str] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://scenarios") as client:

        async def email_of(user_id: str) -> str | None:
            def find() -> str | None:
                return next((u.get("email") for u in store.data().users if u["id"] == user_id), None)

            return await asyncio.to_thread(runtime.store.read, find)

        runner = Runner(client, email_of)
        for i, raw in enumerate(steps):
            step = resolve(raw, results)
            if step["op"] == "advance":
                now += timedelta(minutes=int(step.get("minutes", 0)))
                clock.set_frozen(now)
                results.append({"ok": {"now": clock.iso(now)}})
                codes.append({"status": 0})
                continue
            if step["op"] == "reset":
                await asyncio.to_thread(
                    runtime.store.write, lambda: provider.load_seed(seed.build_seed(now))
                )
                runner.tokens.clear()
                results.append({"ok": {"ok": True}})
                codes.append({"status": 0})
                continue
            if not args.skip_ticks:
                await asyncio.to_thread(runtime.tick)
            try:
                got = await runner.step(step)
            except Exception as exc:  # noqa: BLE001
                got = {"status": 599, "code": "runner", "message": repr(exc)}
            results.append(got)
            code = {"status": got["status"], "code": got.get("code")}
            codes.append(code)
            title = " ".join(
                str(raw.get(k)) for k in ("op", "method", "resource", "url", "id", "as") if raw.get(k)
            )
            if got["status"] >= 500:
                problems.append(f"[{i}] {title}: {got['status']} {got.get('message')}")
            elif expected is not None and expected[i] != code:
                was = f"{expected[i]['status']} {expected[i].get('code') or ''}".strip()
                became = f"{code['status']} {code.get('code') or ''}".strip()
                problems.append(f"[{i}] {title}: было {was}, стало {became} — {got.get('message') or ''}")

    await app.state.db.dispose()
    await asyncio.to_thread(runtime.store.dispose)
    print(f"Шагов: {len(steps)}, расхождений и ошибок сервера: {len(problems)}")  # noqa: T201
    for line in problems[:80]:
        print(line)  # noqa: T201
    if args.out:
        Path(args.out).write_text(json.dumps(codes, ensure_ascii=False, indent=0))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
