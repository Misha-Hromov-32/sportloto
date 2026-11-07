"""Клиент сайта: тот же API, что у интерфейса, от имени человека по его ключу бота.

Ошибка сайта — `SiteError` с готовым русским текстом из ответа, сбой сети или сервера — `SiteUnavailable`.
"""

import asyncio
import json
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

Filters = list[dict[str, Any]]


class SiteError(Exception):
    def __init__(self, code: str, status: int, message: str, body: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.body = body or {}


class SiteUnavailable(Exception):
    pass


def flt(field: str, value: Any, operator: str = "eq") -> dict[str, Any]:
    return {"field": field, "operator": operator, "value": value}


class SiteClient:
    def __init__(
        self,
        base_url: str,
        bot_secret: str = "",
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 20.0,
        assistant_timeout: float = 60.0,
    ) -> None:
        self.base = base_url.rstrip("/")
        self.secret = bot_secret
        self.assistant_timeout = assistant_timeout
        self.http = httpx.AsyncClient(
            transport=transport,
            timeout=timeout,
            headers={"Accept": "application/json", "User-Agent": "sport-i-tochka-bot/1.0"},
        )

    async def close(self) -> None:
        await self.http.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        city: str | None = None,
        chat: str | None = None,
        body: Any = None,
        query: dict[str, Any] | None = None,
        signed: bool = False,
        timeout: float | None = None,
    ) -> Any:
        headers: dict[str, str] = {}
        if city:
            headers["X-City"] = city
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if signed and self.secret:
            headers["X-Bot-Secret"] = self.secret
            if chat:
                headers["X-Bot-Chat"] = chat
        params = {
            k: v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
            for k, v in (query or {}).items()
            if v is not None
        }
        url = f"{self.base}/api{path}"
        attempts = 2 if method.upper() == "GET" else 1
        for attempt in range(attempts):
            try:
                response = await self.http.request(
                    method.upper(),
                    url,
                    params=params or None,
                    json=body if method.upper() != "GET" and body is not None else None,
                    headers=headers,
                    timeout=timeout or httpx.USE_CLIENT_DEFAULT,
                )
                break
            except httpx.TimeoutException as exc:
                raise SiteUnavailable("timeout") from exc
            except httpx.HTTPError as exc:
                if attempt + 1 < attempts:
                    await asyncio.sleep(1)
                    continue
                raise SiteUnavailable(type(exc).__name__) from exc
        return self._result(response)

    @staticmethod
    def _result(response: httpx.Response) -> Any:
        if response.is_success and (response.status_code == 204 or not response.content):
            return None
        try:
            data = response.json()
        except ValueError:
            data = None
        if response.is_success:
            return data
        if isinstance(data, dict) and isinstance(data.get("message"), str) and data.get("code"):
            raise SiteError(str(data["code"]), response.status_code, data["message"], data)
        if response.status_code >= 500 or response.status_code in {404, 405}:
            raise SiteUnavailable(f"status {response.status_code}")
        raise SiteError("bad_request", response.status_code, "Не получилось. Попробуйте ещё раз")

    # ---------- Привязка аккаунта ----------

    async def link(self, code: str, platform: str, external_id: str, name: str) -> dict[str, Any]:
        return await self.request(
            "POST",
            "/bots/link",
            body={"code": code, "platform": platform, "externalId": external_id, "displayName": name},
            signed=True,
        )

    async def pending(self, platform: str, external_id: str, name: str) -> dict[str, Any]:
        return await self.request(
            "POST",
            "/bots/pending",
            body={"platform": platform, "externalId": external_id, "displayName": name},
            signed=True,
        )

    async def pending_status(self, code: str, platform: str, external_id: str) -> dict[str, Any]:
        return await self.request(
            "GET",
            f"/bots/pending/{code}",
            query={"platform": platform, "externalId": external_id},
            signed=True,
        )

    async def unlink(self, token: str) -> None:
        await self.request("POST", "/bots/unlink", token=token, signed=True)
