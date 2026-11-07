"""Пара ключей VAPID для уведомлений в браузер (Web Push).

Запуск из окружения бэкенда (там есть библиотека cryptography):
    cd backend && python -m uv run python ../scripts/generate-vapid-keys.py

Печатает две строки для deploy/.env. Публичный ключ браузер получает через /api/delivery/settings,
закрытый остаётся только на сервере. После запуска сайта ключи не меняют: подписки браузеров
привязаны к публичному ключу и со сменой пары перестают работать.
"""

import base64
import sys

try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
except ImportError:
    sys.exit(
        "Нужна библиотека cryptography: cd backend && python -m uv run python ../scripts/generate-vapid-keys.py"
    )


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    print(f"WEB_PUSH_PUBLIC_KEY={b64url(public_raw)}")  # noqa: T201
    print(f"WEB_PUSH_PRIVATE_KEY={b64url(private_raw)}")  # noqa: T201


if __name__ == "__main__":
    main()
