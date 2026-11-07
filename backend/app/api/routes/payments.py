"""Оплата на сайте: маршруты, которые ходят в ЮKassa.

Создание платежа и его чтение работают и с провайдером fake (тогда это только доменные правила),
и с ЮKassa: сначала доменный вызов создаёт платёж, потом сервер создаёт его в ЮKassa и
доменным вызовом сохраняет id и адрес страницы оплаты. Остальное (расчёт, заказы, балансы,
выплаты, админка) — доменные маршруты общего обработчика app/api/routes/domain.py.
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.api.routes import domain as domain_routes
from app.api.routes.robots import site_url
from app.core.errors import AppError, ErrorCode
from app.domain import core, provider
from app.domain.features import payments
from app.payments import client_ip, from_yookassa

router = APIRouter(tags=["оплата"])
logger = logging.getLogger(__name__)


@router.post("/payments/yookassa/webhook", include_in_schema=False)
async def yookassa_webhook(request: Request) -> Response:
    """Уведомление ЮKassa. Ответ 200 — принято; 503 — проверить не удалось, ЮKassa повторит позже."""
    settings = request.app.state.settings
    if not settings.payments_enabled:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Оплата на сайте отключена")
    if settings.yookassa_check_ip and not from_yookassa(client_ip(request)):
        logger.warning("Уведомление ЮKassa с чужого адреса отклонено")
        return JSONResponse({"ok": False}, status_code=403)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return JSONResponse({"ok": True})
    if not isinstance(body, dict):
        return JSONResponse({"ok": True})
    checked = await request.app.state.payments.handle_notification(body)
    return JSONResponse({"ok": checked}, status_code=200 if checked else 503)


@router.get("/payments/quote", include_in_schema=False)
async def quote(request: Request) -> Response:
    return await domain_routes.dispatch("payments/quote", request)


@router.get("/payments/sbp-banks", include_in_schema=False)
async def sbp_banks(request: Request) -> Response:
    return await domain_routes.dispatch("payments/sbp-banks", request)


@router.get("/payments/settings", include_in_schema=False)
async def public_settings(request: Request) -> Response:
    return await domain_routes.dispatch("payments/settings", request)


@router.post("/payments", summary="Создать платёж и получить адрес страницы оплаты")
async def create_payment(request: Request) -> Response:
    """Тело `{ kind, targetId, method }` → `PaymentView` с `confirmationUrl`."""
    body = await _body(request)
    view = await domain_routes.run_domain(
        request, lambda: payments.start_payment(core.domain, provider.actor(), body), write=True
    )
    view = await request.app.state.payments.open_payment(view, site_url(request))
    return domain_routes.DomainJSONResponse(view)


@router.get("/payments/{payment_id}", summary="Платёж: статус, суммы, адрес страницы оплаты")
async def get_payment(payment_id: str, request: Request) -> Response:
    payments.require_enabled()
    view = await domain_routes.run_domain(
        request, lambda: payments.get_payment(provider.actor(), payment_id), write=False
    )
    view = await request.app.state.payments.refresh(view)
    return domain_routes.DomainJSONResponse(view)


async def _body(request: Request) -> dict[str, Any]:
    try:
        value = json.loads(await request.body() or b"{}")
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION, "Некорректный JSON", errors={"_": "Некорректный JSON"}) from exc
    if not isinstance(value, dict):
        raise AppError(ErrorCode.BAD_REQUEST, "Тело запроса должно быть объектом")
    return value
