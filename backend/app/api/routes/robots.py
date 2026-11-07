"""robots.txt: что поисковикам можно индексировать и где карта сайта.

nginx отдаёт его по адресу /robots.txt (deploy/nginx.conf), сам обработчик живёт под /api.
"""

import re

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

router = APIRouter(tags=["поисковики"])

# Личные, служебные и черновые страницы: в поиске от них нет пользы.
# /api/ целиком не закрываем: поисковики рендерят страницы с JavaScript и берут их содержимое из API.
# /login и /register открыты, чтобы робот увидел на них noindex.
DISALLOW = (
    "/api/auth/",
    "/api/admin/",
    "/api/stream",
    "/admin",
    "/me",
    "/notifications",
    "/settings",
    "/digest/",
    "/org/",
    "/events/new",
    "/companions/new",
    "/*/edit",
    "/*/manage",
    "/*/poster",
    "/mcp",
    "/bots/",
)

_HOST = re.compile(r"^[A-Za-z0-9.\-]+(?::\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$")


def site_url(request: Request) -> str:
    """Адрес сайта: настройка SITE_URL, иначе из запроса за прокси (X-Forwarded-Proto и Host)."""
    configured = request.app.state.settings.site_url
    if configured:
        return configured
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    if proto not in {"http", "https"}:
        proto = request.url.scheme
    host = request.headers.get("host", "")
    if not _HOST.match(host):
        host = "localhost"
    return f"{proto}://{host}"


def robots_txt(site: str) -> str:
    lines = ["User-agent: *", "Allow: /", *(f"Disallow: {path}" for path in DISALLOW), ""]
    lines.append(f"Sitemap: {site}/sitemap.xml")
    return "\n".join(lines) + "\n"


@router.api_route("/robots.txt", methods=["GET", "HEAD"], include_in_schema=False)
async def robots(request: Request) -> Response:
    return PlainTextResponse(robots_txt(site_url(request)), headers={"Cache-Control": "public, max-age=3600"})
