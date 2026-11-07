"""Оплата на сайте в процессе сервера: ЮKassa, очередь операций и уведомления.

Доменные правила синхронные (app/domain/features/payments.py): они решают, что вернуть, списать или
выплатить, и ставят операцию в очередь `paymentOps`. Этот слой вызывает ЮKassa асинхронно и
докладывает итог доменным вызовом. С провайдером fake ЮKassa не нужна: операции выполняются сразу.

Исполнитель просыпается по живому обновлению «платежи» и раз в PAYMENTS_POLL_SECONDS.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.domain import core
from app.domain.features import payments
from app.payments import (
    Credentials,
    NewPayment,
    NewPayout,
    YooKassaClient,
    YooKassaError,
    build_receipt,
    remote_state,
)
from app.services.realtime import PUBLIC_TOPIC

logger = logging.getLogger(__name__)

# Операция «отправляется» дольше этого (сервер перезапустился посреди вызова) — снова в очередь.
STUCK_MS = 10 * 60_000
PROVIDER_DOWN = "Не получилось открыть оплату. Попробуйте ещё раз через минуту"


def build_gateway(settings: Settings) -> YooKassaClient | None:
    if settings.payments_provider != "yookassa":
        return None
    payouts = Credentials(
        settings.yookassa_payout_agent_id, settings.yookassa_payout_secret_key.get_secret_value()
    )
    return YooKassaClient(
        Credentials(settings.yookassa_shop_id, settings.yookassa_secret_key.get_secret_value()),
        payouts if payouts.configured else None,
        api_url=settings.yookassa_api_url,
    )


def configure_domain(settings: Settings, gateway: YooKassaClient | None) -> None:
    """Провайдер и режим выплат — доменным правилам (они решают, выполнять ли операции сразу)."""
    yookassa = gateway is not None
    payments.configure(
        provider=settings.payments_provider,
        test=gateway.test if gateway is not None else True,
        shopConfigured=gateway.shop.configured if gateway is not None else False,
        receipts=yookassa and settings.yookassa_receipts,
        payouts="auto" if gateway is not None and gateway.payouts_enabled else "manual",
        checkIp=yookassa and settings.yookassa_check_ip,
    )


class PaymentsService:
    def __init__(self, app: FastAPI, gateway: YooKassaClient | None) -> None:
        self.app = app
        self.gateway = gateway
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    @property
    def settings(self) -> Settings:
        return self.app.state.settings

    async def _domain[T](self, fn: Callable[[], T], *, write: bool = True) -> T:
        return await self.app.state.domain.call(fn, write=write)

    def _receipt(self, request: dict[str, Any], amount: float) -> dict[str, Any] | None:
        if not self.settings.yookassa_receipts:
            return None
        return build_receipt(
            request,
            amount,
            vat_code=self.settings.yookassa_vat_code,
            tax_system_code=self.settings.yookassa_tax_system_code,
        )

    # ---------- Платёж: создание и дообновление ----------

    async def open_payment(self, view: dict[str, Any], site: str) -> dict[str, Any]:
        """Новый платёж у нас уже есть (`pending`, без страницы оплаты): создать его в ЮKassa."""
        gateway = self.gateway
        if gateway is None or view.get("provider") != "yookassa" or view.get("confirmationUrl"):
            return view
        if view.get("status") != "pending":
            return view
        payment_id = view["id"]
        request = await self._domain(lambda: payments.provider_request(payment_id), write=False)
        try:
            obj = await gateway.create_payment(
                NewPayment(
                    amount=request["amount"],
                    capture=request["capture"],
                    method=request["method"],
                    description=request["description"],
                    return_url=f"{site}/pay/return?payment={payment_id}",
                    metadata={"paymentId": payment_id},
                    key=f"{payment_id}-create",
                    receipt=self._receipt(request, request["amount"]),
                )
            )
        except YooKassaError as exc:
            logger.warning("Платёж %s не создан в ЮKassa: %s", payment_id, exc)
            await self._domain(
                lambda: payments.provider_failed(core.domain, payment_id, "ЮKassa не ответила")
            )
            raise AppError(ErrorCode.PAYMENT_PROVIDER_ERROR, PROVIDER_DOWN) from exc
        remote = remote_state(obj)
        return await self._domain(lambda: payments.attach_provider(core.domain, payment_id, remote))

    async def refresh(self, view: dict[str, Any]) -> dict[str, Any]:
        """Уведомление могло не дойти: статус ждущего платежа перезапрашивается в ЮKassa."""
        gateway = self.gateway
        provider_id = None
        if (
            gateway is not None
            and view.get("provider") == "yookassa"
            and view.get("status") in ("pending", "held")
        ):
            payment_id = view["id"]
            found = await self._domain(lambda: payments.find_payment(payment_id), write=False)
            provider_id = (found or {}).get("providerPaymentId")
        if gateway is None or not provider_id:
            return view
        try:
            obj = await gateway.get_payment(provider_id)
        except YooKassaError as exc:
            logger.info("Статус платежа %s не обновлён: %s", view["id"], exc)
            return view
        remote = remote_state(obj)
        payment_id = view["id"]
        return await self._domain(lambda: _sync(payment_id, remote))

    # ---------- Уведомления ЮKassa ----------

    async def handle_notification(self, body: dict[str, Any]) -> bool:
        """Уведомление: объект перезапрашивается через API — подделанный статус ничего не изменит.

        False — проверить не удалось (ЮKassa недоступна): ответим ошибкой, и уведомление придёт снова.
        """
        gateway = self.gateway
        event = str(body.get("event") or "")
        obj = body.get("object") if isinstance(body.get("object"), dict) else {}
        object_id = str(obj.get("id") or "")
        if gateway is None or body.get("type") != "notification" or not object_id:
            return True
        try:
            if event.startswith("payment."):
                fresh = await gateway.get_payment(object_id)
                payment_id = str((fresh.get("metadata") or {}).get("paymentId") or "")
                remote = remote_state(fresh)
                await self._domain(lambda: _sync_by_ids(payment_id, object_id, remote))
            elif event.startswith("refund."):
                fresh = await gateway.get_refund(object_id)
                await self._finish_provider_object(object_id, fresh.get("status"))
            elif event.startswith("payout."):
                fresh = await gateway.get_payout(object_id)
                await self._finish_provider_object(object_id, fresh.get("status"))
        except YooKassaError as exc:
            if exc.retryable:
                logger.warning("Уведомление ЮKassa %s %s не проверено: %s", event, object_id, exc)
                return False
            logger.warning("Уведомление ЮKassa %s %s отклонено: %s", event, object_id, exc)
        return True

    async def _finish_provider_object(self, provider_id: str, status: object) -> None:
        if status not in ("succeeded", "canceled"):
            return
        ok = status == "succeeded"
        error = "" if ok else "ЮKassa отменила операцию"
        await self._domain(lambda: payments.finish_by_provider_id(core.domain, provider_id, ok, error))

    # ---------- Очередь операций ----------

    async def run_ops(self) -> int:
        """Выполнить операции из очереди. Возвращает, сколько обработано."""
        gateway = self.gateway
        if gateway is None:
            return 0
        async with self._lock:
            claimed = await self._domain(_claim)
            for item in claimed:
                op = item["op"]
                result = await self._execute(gateway, item)
                await self._domain(lambda o=op, r=result: payments.finish_op(core.domain, o["id"], r))
            return len(claimed)

    async def _execute(self, gateway: YooKassaClient, item: dict[str, Any]) -> dict[str, Any]:
        op = item["op"]
        handlers = {
            "capture": self._capture,
            "cancel": self._cancel,
            "refund": self._refund,
            "payout": self._payout,
        }
        handler = handlers.get(op["kind"])
        if handler is None:
            return {"ok": False, "final": True, "error": "Неизвестная операция"}
        if op["kind"] != "payout" and not item.get("providerPaymentId"):
            return {"ok": False, "final": True, "error": "Платёж не создан в ЮKassa"}
        try:
            return await handler(gateway, item)
        except YooKassaError as exc:
            return {"ok": False, "final": not exc.retryable, "error": str(exc)}

    async def _capture(self, gateway: YooKassaClient, item: dict[str, Any]) -> dict[str, Any]:
        op = item["op"]
        receipt = self._receipt(item.get("request") or {}, op["amount"])
        obj = await gateway.capture(item["providerPaymentId"], op["amount"], op["idempotenceKey"], receipt)
        return {"ok": obj.get("status") == "succeeded", "error": "ЮKassa не списала деньги", "final": True}

    async def _cancel(self, gateway: YooKassaClient, item: dict[str, Any]) -> dict[str, Any]:
        obj = await gateway.cancel(item["providerPaymentId"], item["op"]["idempotenceKey"])
        return {"ok": obj.get("status") == "canceled", "error": "ЮKassa не сняла холд", "final": True}

    async def _refund(self, gateway: YooKassaClient, item: dict[str, Any]) -> dict[str, Any]:
        op = item["op"]
        obj = await gateway.refund(
            item["providerPaymentId"], op["amount"], op["idempotenceKey"], op.get("reason") or ""
        )
        return _provider_result(obj)

    async def _payout(self, gateway: YooKassaClient, item: dict[str, Any]) -> dict[str, Any]:
        op = item["op"]
        payout = item.get("payout") or {}
        if not gateway.payouts_enabled:
            return {"ok": False, "final": True, "error": "Выплаты ЮKassa не подключены"}
        obj = await gateway.create_payout(
            NewPayout(
                amount=op["amount"],
                phone=payout.get("phone") or "",
                bank_id=payout.get("bankId") or "",
                description=f"Выплата «Спорт и точка» {payout.get('id', '')}",
                metadata={"payoutId": str(payout.get("id", ""))},
                key=op["idempotenceKey"],
            )
        )
        return _provider_result(obj)

    async def check_sending(self) -> None:
        """Возвраты и выплаты, о которых ЮKassa ещё не прислала итог: перезапросить статус."""
        gateway = self.gateway
        if gateway is None:
            return
        waiting = await self._domain(_sending_with_provider_id, write=False)
        for op in waiting:
            try:
                obj = (
                    await gateway.get_payout(op["providerId"])
                    if op["kind"] == "payout"
                    else await gateway.get_refund(op["providerId"])
                )
            except YooKassaError:
                continue
            await self._finish_provider_object(op["providerId"], obj.get("status"))

    async def _safe_run(self) -> None:
        try:
            await self._domain(lambda: payments.reset_sending(STUCK_MS))
            await self.run_ops()
            await self.check_sending()
        except Exception:
            logger.exception("Очередь операций оплаты не выполнена")

    async def _run(self) -> None:
        broker = self.app.state.broker
        poll = max(self.settings.payments_poll_seconds, 1.0)
        while True:
            sub = broker.subscribe([PUBLIC_TOPIC]).subscription
            try:
                await self._safe_run()
                while not sub.closed:
                    try:
                        message = await asyncio.wait_for(sub.queue.get(), timeout=poll)
                    except TimeoutError:
                        await self._safe_run()
                        continue
                    if message is None:
                        break
                    if message.data.get("channel") == "resources/payments":
                        await asyncio.sleep(0.3)
                        await self._safe_run()
            finally:
                broker.unsubscribe(sub)
            await asyncio.sleep(poll)

    def start(self) -> None:
        if self._task is None and self.gateway is not None and self.settings.payments_poll_seconds > 0:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None


def _provider_result(obj: dict[str, Any]) -> dict[str, Any]:
    """Ответ на возврат или выплату: готово, отказ или «итог придёт уведомлением»."""
    status = obj.get("status")
    provider_id = obj.get("id")
    if status == "succeeded":
        return {"ok": True, "providerId": provider_id}
    if status == "canceled":
        reason = (obj.get("cancellation_details") or {}).get("reason") or "отказ ЮKassa"
        return {"ok": False, "final": True, "providerId": provider_id, "error": f"ЮKassa отменила: {reason}"}
    return {"ok": False, "pending": True, "providerId": provider_id}


def _claim() -> list[dict[str, Any]]:
    claimed = payments.claim_ops()
    for item in claimed:
        if item["op"]["kind"] == "capture" and item["op"].get("paymentId"):
            item["request"] = payments.provider_request(item["op"]["paymentId"])
    return claimed


def _sending_with_provider_id() -> list[dict[str, Any]]:
    return [dict(o) for o in core.domain.db.payment_ops if o["status"] == "sending" and o.get("providerId")]


def _sync(payment_id: str, remote: dict[str, Any]) -> dict[str, Any]:
    p = payments.find_payment(payment_id)
    if p is None:
        return {}
    return payments.sync_payment(core.domain, p, remote)


def _sync_by_ids(payment_id: str, provider_payment_id: str, remote: dict[str, Any]) -> None:
    p = payments.find_payment(payment_id) if payment_id else None
    if p is None:
        p = payments.payment_by_provider_id(provider_payment_id)
    if p is not None:
        payments.sync_payment(core.domain, p, remote)
