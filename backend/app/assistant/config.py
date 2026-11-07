"""Настройки помощника: хранятся в `settings.assistant` доменных данных и переживают сброс демо.

ИИ на сайте выключен, пока администратор не включит его (`enabled`) и не укажет, чем работать: адрес
и модель, ключ API или ключ моста. Каждую функцию из FEATURES можно выключить отдельно.

Ключи (API, ключ моста) администратору показываются только замаскированными: ключ моста
виден целиком один раз, при выпуске.
"""

import hashlib
import secrets
from typing import Any, Literal, cast

from app.domain import store

Mode = Literal["builtin", "local", "websocket", "api"]
ApiProvider = Literal["openai", "gigachat", "yandexgpt"]
Feature = Literal["chat", "forms", "search", "premoderation", "covers", "profile", "digest", "bots", "mcp"]

MODES: tuple[Mode, ...] = ("builtin", "local", "websocket", "api")
API_PROVIDERS: tuple[ApiProvider, ...] = ("openai", "gigachat", "yandexgpt")
FEATURES: tuple[Feature, ...] = (
    "chat",
    "forms",
    "search",
    "premoderation",
    "covers",
    "profile",
    "digest",
    "bots",
    "mcp",
)
KEY_PREFIX = "stb_"
INDEPENDENT_FEATURES = {"forms", "search", "premoderation", "mcp"}

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "features": {name: name != "mcp" for name in FEATURES},
    "mode": "builtin",
    "timeoutSeconds": 45,
    "local": {"url": "http://host.docker.internal:11434/v1", "model": "qwen2.5:7b"},
    "api": {
        "provider": "openai",
        "url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "apiKey": "",
        "folderId": "",
    },
    "bridge": {"keyHash": "", "keyHint": "", "issuedAt": ""},
}


def _merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def read() -> dict[str, Any]:
    """Полные настройки (с ключами) — только для сервера."""
    saved = store.data().settings.get("assistant")
    return _merge(DEFAULTS, saved if isinstance(saved, dict) else {})


def _save(value: dict[str, Any]) -> None:
    db = store.data()
    db.settings = {**db.settings, "assistant": value}


def _mask(secret: str) -> str:
    return f"…{secret[-4:]}" if len(secret) > 8 else ("задан" if secret else "")  # noqa: PLR2004


def _clip(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def allows(s: dict[str, Any], feature: Feature) -> bool:
    return bool((feature in INDEPENDENT_FEATURES or s["enabled"]) and s["features"].get(feature))


def feature_on(feature: Feature) -> bool:
    """Включена ли функция: нужны и общий выключатель, и её собственный."""
    return allows(read(), feature)


def model_ready(s: dict[str, Any], *, connected: bool) -> bool:
    """Может ли модель ответить прямо сейчас."""
    mode = cast("Mode", s["mode"])
    if not s["enabled"] or mode == "builtin":
        return False
    if mode == "api":
        return bool(s["api"]["apiKey"])
    return mode != "websocket" or connected


def public_view(*, connected: bool, can_draw: bool = False) -> dict[str, Any]:
    """Что нужно сайту: режим, готовность чата, что включено; `images` — мост рисует обложки."""
    s = read()
    features = {name: allows(s, name) for name in FEATURES}
    mode = s["mode"] if s["enabled"] else "builtin"
    return {
        "mode": mode,
        "ready": features["chat"] and model_ready(s, connected=connected),
        "images": features["covers"] and mode == "websocket" and can_draw,
        "features": features,
    }


def admin_view(bridge: dict[str, Any]) -> dict[str, Any]:
    s = read()
    return {
        "enabled": s["enabled"],
        "features": {name: bool(s["features"].get(name)) for name in FEATURES},
        "mode": s["mode"],
        "timeoutSeconds": s["timeoutSeconds"],
        "local": s["local"],
        "api": {
            "provider": s["api"]["provider"],
            "url": s["api"]["url"],
            "model": s["api"]["model"],
            "folderId": s["api"]["folderId"],
            "apiKeySet": bool(s["api"]["apiKey"]),
            "apiKeyHint": _mask(s["api"]["apiKey"]),
        },
        "bridge": {
            "keySet": bool(s["bridge"]["keyHash"]),
            "keyHint": s["bridge"]["keyHint"],
            "issuedAt": s["bridge"]["issuedAt"],
            **bridge,
        },
    }


class SettingsError(ValueError):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("; ".join(errors.values()))
        self.errors = errors


def _url(value: object, field: str, errors: dict[str, str]) -> str:
    url = _clip(value, 300).rstrip("/")
    if not url.startswith(("http://", "https://")):
        errors[field] = "Адрес должен начинаться с http:// или https://"
    return url


def _check_engine(s: dict[str, Any], errors: dict[str, str]) -> None:
    """Включить ИИ можно, только указав, чем он работает."""
    mode = s["mode"]
    if mode == "builtin":
        return
    if mode == "local" and not (s["local"]["url"] and s["local"]["model"]):
        errors["local.model"] = "Укажите адрес сервера и модель"
    elif mode == "websocket" and not s["bridge"]["keyHash"]:
        errors["bridge"] = "Сначала выпустите ключ моста"
    elif mode == "api":
        if not s["api"]["apiKey"]:
            errors["api.apiKey"] = "Укажите ключ API"
        elif s["api"]["provider"] == "yandexgpt" and not s["api"]["folderId"]:
            errors["api.folderId"] = "Укажите каталог (folder id)"


def update(patch: dict[str, Any]) -> None:  # noqa: C901, PLR0912  плоский разбор полей формы
    """Правка администратором. Пустой ключ API не стирает сохранённый: стирает только `apiKey: null`."""
    s = read()
    errors: dict[str, str] = {}
    if "enabled" in patch:
        s["enabled"] = patch["enabled"] is True
    features = patch.get("features")
    if isinstance(features, dict):
        for name in FEATURES:
            if name in features:
                s["features"][name] = features[name] is True
    if "mode" in patch:
        if patch["mode"] not in MODES:
            errors["mode"] = "Выберите режим из списка"
        else:
            s["mode"] = patch["mode"]
    if "timeoutSeconds" in patch:
        try:
            s["timeoutSeconds"] = max(5, min(120, int(patch["timeoutSeconds"])))
        except (TypeError, ValueError):
            errors["timeoutSeconds"] = "Укажите число секунд от 5 до 120"
    local = patch.get("local")
    if isinstance(local, dict):
        if "url" in local:
            s["local"]["url"] = _url(local["url"], "local.url", errors)
        if "model" in local:
            s["local"]["model"] = _clip(local["model"], 120)
    api = patch.get("api")
    if isinstance(api, dict):
        if "provider" in api:
            if api["provider"] not in API_PROVIDERS:
                errors["api.provider"] = "Выберите провайдера из списка"
            else:
                s["api"]["provider"] = api["provider"]
        if "url" in api:
            s["api"]["url"] = _url(api["url"], "api.url", errors)
        if "model" in api:
            s["api"]["model"] = _clip(api["model"], 120)
        if "folderId" in api:
            s["api"]["folderId"] = _clip(api["folderId"], 120)
        if "apiKey" in api:
            if api["apiKey"] is None:
                s["api"]["apiKey"] = ""
            elif _clip(api["apiKey"], 4000):
                s["api"]["apiKey"] = _clip(api["apiKey"], 4000)
    if s["enabled"] and not errors:
        _check_engine(s, errors)
    if errors:
        raise SettingsError(errors)
    _save(s)


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def issue_bridge_key(now_iso: str) -> str:
    key = KEY_PREFIX + secrets.token_urlsafe(32)
    s = read()
    s["bridge"] = {"keyHash": _hash(key), "keyHint": _mask(key), "issuedAt": now_iso}
    _save(s)
    return key


def bridge_key_ok(key: str) -> bool:
    expected = read()["bridge"]["keyHash"]
    return bool(expected) and secrets.compare_digest(expected, _hash(key))
