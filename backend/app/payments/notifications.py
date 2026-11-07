"""Уведомления ЮKassa: адреса, с которых они приходят.

Основная защита — перезапрос объекта через API: статус берётся из ответа ЮKassa, а не из тела
уведомления. Проверка адреса — дополнительная и включается настройкой YOOKASSA_CHECK_IP.
"""

import ipaddress

from fastapi import Request

# Список из документации ЮKassa («Входящие уведомления»).
YOOKASSA_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "185.71.76.0/27",
        "185.71.77.0/27",
        "77.75.153.0/25",
        "77.75.156.11/32",
        "77.75.156.35/32",
        "77.75.154.128/25",
        "2a02:5180::/32",
    )
]


def client_ip(request: Request) -> str:
    """Адрес отправителя за nginx: X-Real-IP, затем первый адрес X-Forwarded-For."""
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else ""


def from_yookassa(ip: str) -> bool:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(address in network for network in YOOKASSA_NETWORKS)
