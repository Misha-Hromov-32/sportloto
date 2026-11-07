from fastapi import APIRouter, Depends

from app.api.deps import touch_bot_key
from app.api.routes import admin, assistant, auth, bots, domain, geo, health, profile_import, seo, stream
from app.api.routes import delivery as delivery_routes
from app.api.routes import payments as payments_routes
from app.api.routes.robots import router as robots_router

api_router = APIRouter(prefix="/api", dependencies=[Depends(touch_bot_key)])
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(stream.router)
api_router.include_router(admin.router)
api_router.include_router(assistant.router)
api_router.include_router(profile_import.router)
api_router.include_router(seo.router)
api_router.include_router(robots_router)
api_router.include_router(bots.router)
api_router.include_router(delivery_routes.router)
api_router.include_router(geo.router)
# Оплата: платёж в ЮKassa и её уведомления — до общего обработчика.
api_router.include_router(payments_routes.router)
# Последним: перехватывает все остальные адреса /api — ресурсы и действия контракта API.
api_router.include_router(domain.router)
