"""Шифрование личных ключей людей в базе бота.

- Windows (Telegram-бот на домашнем ПК): DPAPI текущего пользователя Windows — расшифровать может только он.
- Сервер (VK-бот в Docker): Fernet с ключом из `BOT_STORE_KEY`; база лежит в томе с правами 600.
- Без ключа на сервере ключи хранятся как есть, файл базы доступен только владельцу (права 600).
"""

import base64
import ctypes
import logging
import os
from typing import Protocol

log = logging.getLogger(__name__)


class Vault(Protocol):
    def seal(self, value: str) -> str: ...
    def open(self, value: str) -> str: ...


class PlainVault:
    def seal(self, value: str) -> str:
        return "plain:" + value

    def open(self, value: str) -> str:
        return value.removeprefix("plain:")


class FernetVault:
    def __init__(self, key: str) -> None:
        from cryptography.fernet import Fernet  # noqa: PLC0415  нужен только на сервере

        self._f = Fernet(key.encode())

    def seal(self, value: str) -> str:
        return "fernet:" + self._f.encrypt(value.encode()).decode()

    def open(self, value: str) -> str:
        if value.startswith("plain:"):
            return value.removeprefix("plain:")
        return self._f.decrypt(value.removeprefix("fernet:").encode()).decode()


class _Blob(ctypes.Structure):
    _fields_ = (("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char)))


class DpapiVault:
    def __init__(self) -> None:
        self._crypt = ctypes.windll.crypt32  # type: ignore[attr-defined]
        self._kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]

    def _call(self, fn: object, data: bytes) -> bytes:
        buf = ctypes.create_string_buffer(data, len(data))
        src = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
        out = _Blob()
        ok = fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out))  # type: ignore[operator]
        if not ok:
            raise OSError("DPAPI: не удалось обработать ключ")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            self._kernel.LocalFree(out.pbData)

    def seal(self, value: str) -> str:
        return "dpapi:" + base64.b64encode(self._call(self._crypt.CryptProtectData, value.encode())).decode()

    def open(self, value: str) -> str:
        if value.startswith("plain:"):
            return value.removeprefix("plain:")
        raw = base64.b64decode(value.removeprefix("dpapi:"))
        return self._call(self._crypt.CryptUnprotectData, raw).decode()


def make_vault(store_key: str = "") -> Vault:
    if os.name == "nt":
        return DpapiVault()
    if store_key:
        return FernetVault(store_key)
    log.warning("BOT_STORE_KEY не задан: ключи людей хранятся без шифрования, файл базы закрыт правами 600")
    return PlainVault()
