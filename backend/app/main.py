import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai import AiService, build_provider
from app.api.errors import install_error_handlers
from app.api.router import api_router
from app.api.routes import mcp as mcp_routes
from app.core.config import Settings, get_settings
from app.core.local_photos import LocalPhotosMiddleware
from app.db.session import Database
from app.mail import build_mailer
from app.realtime import Broker
from app.services.delivery import NotificationDelivery
from app.services.digest_mail import DigestMailer
from app.services.domain import DomainRuntime
from app.services.email import SendLimiter
from app.services.payments import PaymentsService, build_gateway, configure_domain
from app.services.webpush import build_push_sender


class _HideStreamToken(logging.Filter):
    """Токен вкладки приходит в адресе SSE (`/api/stream?access_token=…`): в журнал — без параметров."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # Аргументы записи uvicorn: адрес клиента, метод, путь с параметрами, версия HTTP, статус.
        if isinstance(args, tuple) and len(args) > 2 and str(args[2]).startswith("/api/stream?"):  # noqa: PLR2004
            record.args = (*args[:2], "/api/stream", *args[3:])
        return True


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("uvicorn.access").addFilter(_HideStreamToken())

    # Ресурсы создаются сразу (подключений к БД это не открывает), а закрываются при остановке.
    db = Database(settings)
    broker = Broker(replay_size=settings.sse_replay_size, queue_size=settings.sse_queue_size)
    ai = AiService(build_provider(settings), db.sessionmaker, settings)
    domain = DomainRuntime(settings, broker)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await domain.start()
        # Оплата на сайте: исполнитель операций ЮKassa (с провайдером fake не нужен)
        app.state.payments.start()
        # Письма подборки дня уходят в фоне, когда работают и фоновые проверки правил.
        if settings.domain_tick_seconds > 0:
            app.state.digest_mail.start()
            # Уведомления на почту и в браузер — по тому же правилу.
            app.state.delivery.start()
        yield
        await app.state.delivery.stop()
        await app.state.digest_mail.stop()
        await app.state.payments.stop()
        await domain.stop()
        broker.close_all()
        await ai.provider.aclose()
        await db.dispose()

    app = FastAPI(
        title="Вместе API",
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = db
    app.state.broker = broker
    app.state.ai = ai
    app.state.domain = domain
    app.state.mailer = build_mailer(settings)
    app.state.mail_limiter = SendLimiter()
    app.state.digest_mail = DigestMailer(app)
    app.state.delivery = NotificationDelivery(app, build_push_sender(settings))
    # Оплата на сайте: ЮKassa или тестовая страница; провайдер — и доменным правилам
    gateway = build_gateway(settings)
    configure_domain(settings, gateway)
    app.state.payments = PaymentsService(app, gateway)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    # Фото демо-данных — с нашего сервера, а не с фотобанка
    app.add_middleware(LocalPhotosMiddleware)
    install_error_handlers(app)
    app.include_router(api_router)
    # Точка протокола MCP — в корне сайта, как в инструкции подключения внешнего ассистента.
    app.include_router(mcp_routes.router)
    return app
