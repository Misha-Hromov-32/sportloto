"""Страницы для поисковиков и превью ссылок.

Приложение — SPA: без скриптов у каждой страницы был бы один заголовок и пустое тело. nginx вставляет
в index.html два фрагмента (SSI, см. deploy/nginx.conf):
- `GET /api/seo/head?path=…` — title, description, canonical, robots, Open Graph и разметка schema.org;
- `GET /api/seo/body?path=…` — короткое содержание страницы внутри #root, его заменяет React.
`GET /api/seo/meta?path=…` отдаёт те же данные JSON — по нему SPA обновляет заголовок при переходах.
`GET /api/seo/sitemap.xml` — карта сайта: открытые страницы, события, организации и площадки.

Данные читаются от имени гостя: в выдачу попадает только то, что видно без входа.
"""

import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html import escape
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.core.errors import AppError
from app.domain import clock, provider, store
from app.domain.lib.cities import city_of_place, default_city
from app.domain.schema import COLLECTIONS

router = APIRouter(prefix="/seo", tags=["поиск и превью ссылок"])

SITE = "Спорт и точка"
HOME_TITLE = f"{SITE} — компания для спорта в Красноярске"
HOME_DESCRIPTION = (
    "Футбол, волейбол, бег, йога и ещё десятки видов спорта в Красноярске. "
    "Смотрите, кто и где собирается, записывайтесь на встречи или соберите свою."
)
OG_IMAGE = "/og-image.jpg"
DESCRIPTION_LIMIT = 160
CACHE_SECONDS = 30
CACHE_SIZE = 2000

MONTHS = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)

# Открытые страницы: заголовок, описание, приоритет в карте сайта.
STATIC_PAGES: dict[str, tuple[str, str, str]] = {
    "/": (HOME_TITLE, HOME_DESCRIPTION, "1.0"),
    "/events": (
        "События и тренировки в Красноярске",
        (
            "Ближайшие игры и тренировки по районам и видам спорта: время, место, уровень, свободные места. "
            "Записаться можно сразу или по заявке организатору."
        ),
        "0.9",
    ),
    "/companions": (
        "Ищу компанию для спорта",
        (
            "Объявления людей, которые ищут партнёра для тенниса, пробежки, похода в зал или игры в футбол. "
            "Откликнитесь или разместите своё."
        ),
        "0.7",
    ),
    "/inventory": (
        "Инвентарь на время",
        (
            "Мячи, ракетки, лыжи и другая экипировка: возьмите на игру у других участников "
            "или помогите клубу с инвентарём."
        ),
        "0.5",
    ),
    "/rules": (
        "Правила и помощь",
        (
            "Как устроена запись на встречи, что делает организатор, как проверяются клубы "
            "и что делать, если встречу отменили."
        ),
        "0.4",
    ),
    "/assistant": (
        "Чат-бот помощник",
        "Подскажет, как устроен сайт, подберёт встречи, запишет вас или создаст встречу по вашей просьбе.",
        "0.4",
    ),
    # Документы (frontend/src/pages/legal): по ст. 18.1 152-ФЗ политика должна быть в свободном доступе.
    "/legal": (
        "Документы",
        "Соглашение, политика обработки персональных данных, согласия и сведения о владельце сайта.",
        "0.2",
    ),
    "/legal/terms": (
        "Пользовательское соглашение",
        "Условия пользования сайтом: регистрация, встречи, правила поведения, ответственность.",
        "0.2",
    ),
    "/legal/privacy": (
        "Политика обработки персональных данных",
        "Какие данные собирает сайт, зачем, сколько хранит, как защищает и как реализовать свои права.",
        "0.2",
    ),
    "/legal/consent": (
        "Согласие на обработку персональных данных",
        "Текст согласия, которое пользователь даёт при регистрации: данные, цели, действия, срок и отзыв.",
        "0.1",
    ),
    "/legal/public-profile": (
        "Согласие на распространение персональных данных",
        "Какие сведения профиля видны другим людям на сайте, запреты и условия, как отозвать согласие.",
        "0.1",
    ),
    "/legal/cookies": (
        "Политика использования cookie",
        "Что сайт хранит в браузере и зачем: вход в аккаунт и настройки, без рекламных счётчиков.",
        "0.1",
    ),
}

# Страницы, которые не нужны в поиске: вход, личные разделы, формы и кабинеты.
PRIVATE_TITLES = {
    "/login": "Вход",
    "/register": "Регистрация",
    "/verify-email": "Подтверждение почты",
    "/forgot-password": "Восстановление пароля",
    "/reset-password": "Новый пароль",
    "/me": "Мои занятия",
    "/me/money": "Мои деньги",
    "/me/stop-list": "Стоп-лист",
    "/pay/return": "Результат оплаты",
    "/notifications": "Уведомления",
    "/settings": "Настройки",
    "/events/new": "Новое событие",
    "/companions/new": "Новое объявление",
    "/org/new": "Новая организация",
}
PRIVATE_PREFIX = ("/admin", "/settings/", "/org/", "/profile/", "/me/", "/digest/", "/bots/", "/share/", "/pay/", "/orders/")
PRIVATE_SUFFIX = ("/manage", "/edit", "/poster")

_HOST = re.compile(r"^[A-Za-z0-9.\-]+(?::\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$")


@dataclass
class Page:
    title: str
    description: str
    path: str
    noindex: bool = False
    image: str | None = None
    og_type: str = "website"
    jsonld: list[dict[str, Any]] = field(default_factory=list)
    # Короткое содержание для тела страницы: заголовок, абзацы и ссылки.
    heading: str = ""
    lines: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)

    @property
    def full_title(self) -> str:
        return self.title if self.title.startswith(SITE) else f"{self.title} — {SITE}"


# ---------- Помощники ----------


def _clip(text: str, limit: int = DESCRIPTION_LIMIT) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",.;:—- ")
    return f"{cut}…"


def _clean_path(raw: str | None) -> str:
    path = urlsplit(raw or "/").path or "/"
    if not path.startswith("/"):
        path = "/" + path
    path = re.sub(r"/{2,}", "/", path)
    return path.rstrip("/") or "/"


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
        host = request.url.netloc or "localhost"
    return f"{proto}://{host}"


def _image(base: str, url: str | None) -> str | None:
    """Абсолютный адрес картинки для превью; data: URL соцсети не покажут."""
    if not url:
        return None
    if url.startswith("https://images.unsplash.com/"):
        # Превью соцсетей — 1200×630: просим у Unsplash готовую обрезку.
        head, _, query = url.partition("?")
        params = [p for p in query.split("&") if p and p.split("=")[0] not in {"w", "h", "fit", "crop"}]
        return f"{head}?{'&'.join([*params, 'w=1200', 'h=630', 'fit=crop'])}"
    if url.startswith(("http://", "https://")):
        return url
    if url.startswith("/"):
        return base + url
    return None


def _local(iso: str, zone: str) -> datetime:
    return datetime.fromisoformat(iso).astimezone(ZoneInfo(zone))


def _when(moment: datetime) -> str:
    return f"{moment.day} {MONTHS[moment.month - 1]}, {moment:%H:%M}"


def _price(price: dict[str, Any] | None) -> str:
    price = price or {}
    if price.get("kind") == "fixed":
        return f"{price.get('amount')} ₽"
    if price.get("kind") == "split":
        return "скидываемся на аренду"
    return "бесплатно"


def _number(value: object) -> bool:
    return isinstance(value, int | float)


async def _guest(request: Request, fn: Callable[[], Any]) -> Any:  # noqa: ANN401
    """Правило от имени гостя, без сессии: как страницу видит поисковый робот."""
    return await request.app.state.domain.call(fn, write=False, zone=clock.DEFAULT_ZONE)


_cache: dict[str, tuple[float, Any]] = {}


async def _cached(key: str, make: Callable[[], Awaitable[Any]]) -> Any:  # noqa: ANN401
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = await make()
    if len(_cache) > CACHE_SIZE:
        _cache.clear()
    _cache[key] = (now, value)
    return value


# ---------- Страницы ----------


def _not_found(path: str) -> Page:
    return Page(
        title="Страница не найдена",
        description="Такой страницы нет. Посмотрите ближайшие события в Красноярске.",
        path=path,
        noindex=True,
        heading="Страница не найдена",
        links=[("/events", "Все события")],
    )


def _event_jsonld(event: dict[str, Any], url: str, city: dict[str, Any], start: datetime) -> dict[str, Any]:
    place = event.get("place") or {}
    price = event.get("price") or {}
    sport = (event.get("sport") or {}).get("name") or "Спорт"
    organizer = event.get("organizerView") or {}
    where = ", ".join(x for x in (event.get("districtName"), place.get("address")) if x)
    data: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        "name": event["title"],
        "description": _clip(event.get("description") or "", 500),
        "sport": sport,
        "startDate": start.isoformat(),
        "endDate": (start + timedelta(minutes=int(event.get("durationMin") or 90))).isoformat(),
        "eventStatus": "https://schema.org/EventCancelled"
        if event.get("status") == "cancelled"
        else "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "url": url,
        "location": {
            "@type": "Place",
            "name": where or city["name"],
            "address": {
                "@type": "PostalAddress",
                "addressLocality": city["name"],
                "addressRegion": city["region"],
                "streetAddress": place.get("address") or "",
                "addressCountry": "RU",
            },
        },
        "isAccessibleForFree": price.get("kind") != "fixed",
        "offers": {
            "@type": "Offer",
            "url": url,
            "price": price.get("amount", 0) if price.get("kind") == "fixed" else 0,
            "priceCurrency": "RUB",
            "availability": "https://schema.org/InStock",
        },
    }
    if _number(place.get("lat")) and _number(place.get("lng")):
        geo = {"@type": "GeoCoordinates", "latitude": place["lat"], "longitude": place["lng"]}
        data["location"]["geo"] = geo
    if organizer.get("name"):
        data["organizer"] = {
            "@type": "Organization" if organizer.get("kind") == "org" else "Person",
            "name": organizer["name"],
        }
    return data


async def _event_page(request: Request, path: str, event_id: str, base: str) -> Page:
    try:
        event = await _guest(request, lambda: provider.get_one("events", event_id))
    except AppError:
        return _not_found(path)
    if not isinstance(event, dict) or not event.get("title"):
        return _not_found(path)

    city = city_of_place(event.get("place"))
    start = _local(event["startsAt"], city["timeZone"])
    when = _when(start)
    place = event.get("place") or {}
    sport = (event.get("sport") or {}).get("name") or "Спорт"
    organizer = (event.get("organizerView") or {}).get("name") or ""
    district = event.get("districtName") or ""
    status = event.get("status")
    hidden = event.get("visibility") == "invite" or status in {"removed", "deleted"}

    facts = [
        "Встреча отменена" if status == "cancelled" else "",
        f"{sport}, {when}",
        ", ".join(x for x in (district, place.get("address")) if x),
        f"Участие: {_price(event.get('price'))}",
        f"Организатор: {organizer}" if organizer else "",
    ]
    image = _image(base, event.get("coverUrl"))
    jsonld = _event_jsonld(event, base + path, city, start)
    if image:
        jsonld["image"] = [image]
    return Page(
        title=f"{event['title']}, {when}",
        description=_clip(
            f"{sport}, {when}{', ' + district if district else ''}. {event.get('description') or ''}"
        ),
        path=path,
        noindex=hidden,
        image=image,
        og_type="article",
        jsonld=[] if hidden else [jsonld],
        heading=event["title"],
        lines=[*facts, _clip(event.get("description") or "", 600)],
        links=[("/events", "Все события")],
    )


async def _org_page(request: Request, path: str, org_id: str, base: str) -> Page:
    try:
        org = await _guest(request, lambda: provider.get_one("organizations", org_id))
    except AppError:
        return _not_found(path)
    if not isinstance(org, dict) or not org.get("name"):
        return _not_found(path)
    city = org.get("city") or default_city()["name"]
    approved = org.get("status") == "approved"
    logo = _image(base, org.get("logoUrl"))
    jsonld: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "SportsOrganization",
        "name": org["name"],
        "description": _clip(org.get("description") or "", 500),
        "url": base + path,
        "address": {
            "@type": "PostalAddress",
            "addressLocality": city,
            "streetAddress": org.get("address") or "",
            "addressCountry": "RU",
        },
    }
    if logo:
        jsonld["logo"] = logo
    return Page(
        title=f"{org['name']} — {city}",
        description=_clip(org.get("description") or f"{org['name']}: встречи и тренировки, город {city}."),
        path=path,
        noindex=not approved,
        image=logo,
        jsonld=[jsonld] if approved else [],
        heading=org["name"],
        lines=[org.get("address") or "", _clip(org.get("description") or "", 600)],
        links=[("/events", "Все события")],
    )


async def _venue_page(request: Request, path: str, venue_id: str, base: str) -> Page:
    try:
        venue = await _guest(request, lambda: provider.get_one("venues", venue_id))
    except AppError:
        return _not_found(path)
    if not isinstance(venue, dict) or not venue.get("name"):
        return _not_found(path)
    price = venue.get("pricePerHour") or 0
    price_text = "бесплатно" if not price else f"от {price} ₽ в час"
    address = venue.get("address") or ""
    photo = _image(base, venue.get("photoUrl"))
    jsonld: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "SportsActivityLocation",
        "name": venue["name"],
        "description": _clip(venue.get("description") or "", 500),
        "url": base + path,
        "address": {
            "@type": "PostalAddress",
            "addressLocality": default_city()["name"],
            "streetAddress": address,
            "addressCountry": "RU",
        },
    }
    if _number(venue.get("lat")) and _number(venue.get("lng")):
        jsonld["geo"] = {"@type": "GeoCoordinates", "latitude": venue["lat"], "longitude": venue["lng"]}
    if photo:
        jsonld["image"] = photo
    return Page(
        title=f"{venue['name']}, площадка в Красноярске",
        description=_clip(
            f"{venue['name']}, {address}. Аренда {price_text}. {venue.get('description') or ''}"
        ),
        path=path,
        image=photo,
        jsonld=[jsonld],
        heading=venue["name"],
        lines=[address, f"Аренда: {price_text}", _clip(venue.get("description") or "", 600)],
        links=[("/events", "Все события")],
    )


def _site_jsonld(base: str) -> list[dict[str, Any]]:
    return [
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE,
            "url": base + "/",
            "inLanguage": "ru-RU",
        },
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": SITE,
            "url": base + "/",
            "logo": base + "/icon-512.png",
        },
    ]


# Заголовки закрытых разделов по началу или концу адреса.
PRIVATE_PREFIX_TITLES = (
    ("/admin", "Администрирование"),
    ("/profile/", "Профиль"),
    ("/org/", "Кабинет организации"),
    ("/digest/", "Подборка дня"),
    ("/bots/", "Подключение мессенджера"),
    ("/share/", "Подробности встречи"),  # личная ссылка участника: адрес и контакты не для поиска
    ("/pay/fake/", "Тестовая оплата"),
    ("/orders/", "Заказ"),
)
PRIVATE_SUFFIX_TITLES = (
    ("/manage", "Управление встречей"),
    ("/edit", "Правка события"),
    ("/poster", "Афиша для печати"),
)


def _private_title(path: str) -> str:
    for prefix, title in PRIVATE_PREFIX_TITLES:
        if path.startswith(prefix):
            return title
    for suffix, title in PRIVATE_SUFFIX_TITLES:
        if path.endswith(suffix):
            return title
    return "Настройки" if path.startswith("/settings/") else SITE


def _private(path: str) -> bool:
    return path in PRIVATE_TITLES or path.startswith(PRIVATE_PREFIX) or path.endswith(PRIVATE_SUFFIX)


async def resolve(request: Request, raw_path: str | None) -> Page:
    path = _clean_path(raw_path)
    base = site_url(request)

    if path in STATIC_PAGES:
        title, description, _ = STATIC_PAGES[path]
        page = Page(title=title, description=description, path=path, heading=title, lines=[description])
        page.links = [
            ("/events", "Все события"),
            ("/companions", "Ищу компанию"),
            ("/rules", "Правила и помощь"),
        ]
        if path == "/":
            page.heading = "Найдите компанию для спорта"
            page.jsonld = _site_jsonld(base)
        return page

    if _private(path):
        title = PRIVATE_TITLES.get(path) or _private_title(path)
        return Page(title=title, description=HOME_DESCRIPTION, path=path, noindex=True, heading=title)

    match = re.fullmatch(r"/(events|orgs|venues)/([A-Za-z0-9_.-]+)", path)
    if match:
        kind, id_ = match.groups()
        if kind == "events":
            return await _event_page(request, path, id_, base)
        if kind == "orgs":
            return await _org_page(request, path, id_, base)
        return await _venue_page(request, path, id_, base)

    return _not_found(path)


# ---------- Вывод ----------


def render_head(page: Page, base: str) -> str:
    canonical = base + page.path
    image = page.image or base + OG_IMAGE
    tags = [
        f"<title>{escape(page.full_title)}</title>",
        f'<meta name="description" content="{escape(page.description)}" />',
        f'<meta name="robots" content="{"noindex, nofollow" if page.noindex else "index, follow"}" />',
    ]
    if not page.noindex:
        tags.append(f'<link rel="canonical" href="{escape(canonical)}" />')
    tags += [
        f'<meta property="og:type" content="{page.og_type}" />',
        f'<meta property="og:title" content="{escape(page.title)}" />',
        f'<meta property="og:description" content="{escape(page.description)}" />',
        f'<meta property="og:url" content="{escape(canonical)}" />',
        f'<meta property="og:image" content="{escape(image)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ]
    for item in page.jsonld:
        # «</» внутри строки не должно закрыть тег script.
        data = json.dumps(item, ensure_ascii=False).replace("</", "<\\/")
        tags.append(f'<script type="application/ld+json">{data}</script>')
    return "\n    ".join(tags) + "\n"


def render_body(page: Page) -> str:
    parts = ['<div class="container seo-fallback">', f"<h1>{escape(page.heading or page.title)}</h1>"]
    parts += [f"<p>{escape(line)}</p>" for line in page.lines if line]
    if page.links:
        items = "".join(f'<li><a href="{escape(h)}">{escape(label)}</a></li>' for h, label in page.links)
        parts.append(f"<ul>{items}</ul>")
    parts.append("</div>")
    return "".join(parts)


def page_json(page: Page, base: str) -> dict[str, Any]:
    return {
        "title": page.full_title,
        "description": page.description,
        "canonical": None if page.noindex else base + page.path,
        "robots": "noindex, nofollow" if page.noindex else "index, follow",
        "image": page.image or base + OG_IMAGE,
        "ogType": page.og_type,
        "jsonld": page.jsonld,
    }


async def _page(request: Request) -> tuple[Page, str]:
    path = request.query_params.get("path")
    base = site_url(request)
    page = await _cached(f"{base}|{_clean_path(path)}", lambda: resolve(request, path))
    return page, base


@router.get("/head", summary="Мета-теги страницы для вставки в HTML")
async def head(request: Request) -> Response:
    page, base = await _page(request)
    return Response(render_head(page, base), media_type="text/html; charset=utf-8")


@router.get("/body", summary="Короткое содержание страницы для роботов без JavaScript")
async def body(request: Request) -> Response:
    page, _ = await _page(request)
    return Response(render_body(page), media_type="text/html; charset=utf-8")


@router.get("/meta", summary="Заголовок и мета-теги страницы для SPA")
async def meta(request: Request) -> Response:
    page, base = await _page(request)
    return JSONResponse(page_json(page, base))


def _collect() -> dict[str, list[dict[str, Any]]]:
    # Для карты нужны только адреса открытых страниц: полные карточки и история
    # организаторов не должны собираться для десятков тысяч событий.
    data = {}
    for key, collection, status in (
        ("events", "events", "published"),
        ("orgs", "organizations", "approved"),
        ("venues", "venues", "active"),
    ):
        table = COLLECTIONS[collection].table
        columns = [table.c.id]
        if "updated_at" in table.c:
            columns.append(table.c.updated_at)
        query = sa.select(*columns).where(table.c.status == status).order_by(table.c.id)
        if collection == "events":
            query = query.where(sa.or_(table.c.visibility.is_(None), table.c.visibility != "invite"))
        data[key] = [
            {"id": row.id, "status": status,
             "updatedAt": clock.iso(row.updated_at) if getattr(row, "updated_at", None) else None}
            for row in store.data().connection.execute(query)
        ]
    return data


@router.get("/sitemap.xml", summary="Карта сайта")
async def sitemap(request: Request) -> Response:
    base = site_url(request)
    data = await _cached(f"sitemap|{base}", lambda: _guest(request, _collect))
    urls: list[tuple[str, str, Any]] = [(base + p, prio, None) for p, (_, _, prio) in STATIC_PAGES.items()]
    urls += [
        (f"{base}/events/{e['id']}", "0.8", e.get("updatedAt"))
        for e in data["events"]
        if e.get("status") == "published" and e.get("visibility") != "invite"
    ]
    urls += [
        (f"{base}/orgs/{o['id']}", "0.6", o.get("updatedAt"))
        for o in data["orgs"]
        if o.get("status") == "approved"
    ]
    urls += [
        (f"{base}/venues/{v['id']}", "0.5", v.get("updatedAt"))
        for v in data["venues"]
        if v.get("status", "active") == "active"
    ]
    rows = []
    # Одна XML-карта ограничена 50 000 адресов. Большой календарь публикуется
    # отдельными частями, а исходный адрес становится индексом этих частей.
    chunk_size = 40_000
    part = request.query_params.get("part")
    if len(urls) > chunk_size and part is None:
        entries = "".join(
            f"<sitemap><loc>{escape(base + '/sitemap.xml?part=' + str(i + 1))}</loc></sitemap>"
            for i in range((len(urls) + chunk_size - 1) // chunk_size)
        )
        return Response(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + entries + '</sitemapindex>',
            media_type="application/xml; charset=utf-8",
            headers={"Cache-Control": "public, max-age=300"},
        )
    if part is not None:
        if not part.isdigit() or int(part) < 1 or (int(part) - 1) * chunk_size >= len(urls):
            return Response(status_code=404)
        start = (int(part) - 1) * chunk_size
        urls = urls[start:start + chunk_size]
    for loc, prio, updated in urls:
        lastmod = f"<lastmod>{escape(updated[:10])}</lastmod>" if isinstance(updated, str) else ""
        rows.append(f"<url><loc>{escape(loc)}</loc>{lastmod}<priority>{prio}</priority></url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n"
    )
    cache = {"Cache-Control": "public, max-age=300"}
    return Response(xml, media_type="application/xml; charset=utf-8", headers=cache)
