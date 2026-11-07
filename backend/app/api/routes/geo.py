"""Адрес по точке и точка по адресу для формы встречи.

`GET /geo/search?q=…&cityId=…` — до пяти мест в выбранном городе, `GET /geo/reverse?lat=…&lng=…` —
адрес точки. Данные OpenStreetMap: сначала Photon (подсказки по мере ввода), при сбое — Nominatim.
Браузер ходит только сюда: ответы кэшируются, на каждый адрес свой лимит запросов.
Сбой внешнего сервиса — 503; форма тогда работает как раньше, адрес и точку вводят вручную.
"""

import time
from collections import OrderedDict, defaultdict, deque
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Query, Request

from app.core.errors import AppError, ErrorCode
from app.domain.lib.cities import city_by_id, city_of_point, default_city, point_in_city
from app.payments.notifications import client_ip

router = APIRouter(prefix="/geo", tags=["карта"])

PHOTON = "https://photon.komoot.io"
NOMINATIM = "https://nominatim.openstreetmap.org"
USER_AGENT = "sport.up-point.tech geocoder (+https://sport.up-point.tech)"
_TIMEOUT = 6.0
_CACHE_SIZE = 2000
_CACHE_TTL = 24 * 3600.0
_LIMIT = 40  # запросов в минуту с одного адреса: подсказки идут по мере ввода
_WINDOW = 60.0

_cache: OrderedDict[str, tuple[float, object]] = OrderedDict()
_calls: dict[str, deque[float]] = defaultdict(deque)


class GeocoderError(Exception):
    """Внешний сервис адресов не ответил или ответил не так."""


def _limit(key: str) -> None:
    now = time.monotonic()
    calls = _calls[key]
    while calls and now - calls[0] > _WINDOW:
        calls.popleft()
    if len(calls) >= _LIMIT:
        raise AppError(ErrorCode.RATE_LIMIT, "Слишком часто. Подождите минуту")
    calls.append(now)


def _cached(key: str) -> object:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        _cache.move_to_end(key)
        return hit[1]
    return None


def _store(key: str, value: object) -> None:
    _cache[key] = (time.monotonic(), value)
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)


def label_of(props: dict[str, Any]) -> str:
    """Строка для поля «Адрес»: улица и дом, перед ними название места, если оно есть."""
    street = props.get("street") or ""
    house = props.get("housenumber") or ""
    street_line = f"{street}, {house}" if street and house else street
    name = props.get("name") or ""
    if name and name not in {street, house}:
        return f"{name}, {street_line}" if street_line else name
    return street_line or props.get("district") or props.get("city") or ""


def _detail_of(props: dict[str, Any]) -> str:
    return ", ".join(p for p in (props.get("district"), props.get("city")) if p)


async def fetch_json(url: str, params: dict[str, Any]) -> object:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GeocoderError(str(exc)) from exc


def _photon_places(data: object) -> list[dict[str, Any]]:
    places = []
    for feature in data.get("features", []) if isinstance(data, dict) else []:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        label = label_of(props)
        if len(coords) == 2 and label:  # noqa: PLR2004 — [долгота, широта]
            places.append(
                {
                    "label": label,
                    "detail": _detail_of(props),
                    "lat": round(float(coords[1]), 6),
                    "lng": round(float(coords[0]), 6),
                }
            )
    return places


def _nominatim_place(item: dict[str, Any]) -> dict[str, Any] | None:
    address = item.get("address") or {}
    props = {
        "name": item.get("name") or "",
        "street": address.get("road") or address.get("pedestrian") or address.get("footway") or "",
        "housenumber": address.get("house_number") or "",
        "district": address.get("city_district") or address.get("suburb") or "",
        "city": address.get("city") or address.get("town") or address.get("village") or "",
    }
    label = label_of(props)
    try:
        lat, lng = float(item["lat"]), float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not label:
        return None
    return {"label": label, "detail": _detail_of(props), "lat": round(lat, 6), "lng": round(lng, 6)}


async def search_places(query: str, city: dict[str, Any]) -> list[dict[str, Any]]:
    center = city["center"]
    try:
        data = await fetch_json(
            f"{PHOTON}/api/",
            {"q": f"{query}, {city['name']}", "limit": 8, "lat": center["lat"], "lon": center["lng"]},
        )
        places = _photon_places(data)
    except GeocoderError:
        data = await fetch_json(
            f"{NOMINATIM}/search",
            {
                "q": f"{query}, {city['name']}",
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 8,
                "accept-language": "ru",
            },
        )
        items = data if isinstance(data, list) else []
        found = (_nominatim_place(item) for item in items if isinstance(item, dict))
        places = [p for p in found if p]
    inside = [p for p in places if point_in_city(p, city)]
    unique: dict[str, dict[str, Any]] = {}
    for place in inside:
        # «Остров Татышев» и «остров Татышев» из разных объектов OSM — одна подсказка.
        unique.setdefault(f"{place['label'].casefold()}|{place['detail']}", place)
    return list(unique.values())[:5]


async def reverse_place(lat: float, lng: float) -> dict[str, Any] | None:
    try:
        data = await fetch_json(f"{PHOTON}/reverse", {"lat": lat, "lon": lng, "limit": 1})
        places = _photon_places(data)
        return places[0] if places else None
    except GeocoderError:
        data = await fetch_json(
            f"{NOMINATIM}/reverse",
            {"lat": lat, "lon": lng, "format": "jsonv2", "addressdetails": 1, "accept-language": "ru"},
        )
        return _nominatim_place(data) if isinstance(data, dict) else None


def _unavailable(exc: Exception) -> AppError:
    return AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        "Поиск адресов сейчас не отвечает. Введите адрес и отметьте точку вручную",
        errors={"reason": str(exc)[:200]},
    )


@router.get("/search", summary="Места по адресу в городе")
async def search(
    request: Request,
    q: Annotated[str, Query(min_length=1, max_length=160)],
    city_id: Annotated[str | None, Query(alias="cityId")] = None,
) -> dict[str, Any]:
    query = " ".join(q.split())
    if len(query) < 3:  # noqa: PLR2004
        return {"places": []}
    city = city_by_id(city_id) or default_city()
    key = f"s|{city['id']}|{query.casefold()}"
    cached = _cached(key)
    if cached is not None:
        return {"places": cached}
    _limit(client_ip(request))
    try:
        places = await search_places(query, city)
    except GeocoderError as exc:
        raise _unavailable(exc) from exc
    _store(key, places)
    return {"places": places}


@router.get("/reverse", summary="Адрес точки на карте")
async def reverse(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
) -> dict[str, Any]:
    if not city_of_point({"lat": lat, "lng": lng}):
        return {"place": None}
    # Точность ~10 м: соседние щелчки по карте берут ответ из кэша.
    key = f"r|{lat:.4f}|{lng:.4f}"
    cached = _cached(key)
    if cached is not None:
        return {"place": cached or None}
    _limit(client_ip(request))
    try:
        place = await reverse_place(lat, lng)
    except GeocoderError as exc:
        raise _unavailable(exc) from exc
    _store(key, place or {})
    return {"place": place}


def _photon_settlements(data: object) -> list[dict[str, Any]]:
    out = []
    for feature in data.get("features", []) if isinstance(data, dict) else []:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) == 2 and props.get("name"):  # noqa: PLR2004 — [долгота, широта]
            out.append(
                {
                    "label": props["name"],
                    "detail": ", ".join(p for p in (props.get("state"), props.get("country")) if p),
                    "region": props.get("state") or "",
                    "country": props.get("countrycode") or "",
                    "lat": round(float(coords[1]), 6),
                    "lng": round(float(coords[0]), 6),
                }
            )
    return out


def _nominatim_settlement(item: dict[str, Any]) -> dict[str, Any] | None:
    address = item.get("address") or {}
    try:
        lat, lng = float(item["lat"]), float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    name = item.get("name") or address.get("city") or address.get("town") or ""
    if not name:
        return None
    region = address.get("state") or ""
    return {
        "label": name,
        "detail": ", ".join(p for p in (region, address.get("country")) if p),
        "region": region,
        "country": (address.get("country_code") or "").upper(),
        "lat": round(lat, 6),
        "lng": round(lng, 6),
    }


async def search_settlements(query: str) -> list[dict[str, Any]]:
    """Города и посёлки по названию — для нового города в справочнике; российские первыми."""
    try:
        data = await fetch_json(f"{PHOTON}/api/", {"q": query, "limit": 8, "layer": "city"})
        found = _photon_settlements(data)
    except GeocoderError:
        data = await fetch_json(
            f"{NOMINATIM}/search",
            {
                "q": query,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 8,
                "featuretype": "settlement",
                "accept-language": "ru",
            },
        )
        items = data if isinstance(data, list) else []
        found = [p for p in (_nominatim_settlement(i) for i in items if isinstance(i, dict)) if p]
    found.sort(key=lambda p: p["country"] != "RU")
    unique: dict[str, dict[str, Any]] = {}
    for place in found:
        unique.setdefault(f"{place['label'].casefold()}|{place['region']}", place)
    return list(unique.values())[:5]


@router.get("/settlements", summary="Город по названию: центр и регион")
async def settlements(
    request: Request, q: Annotated[str, Query(min_length=1, max_length=80)]
) -> dict[str, Any]:
    query = " ".join(q.split())
    if len(query) < 2:  # noqa: PLR2004
        return {"places": []}
    key = f"c|{query.casefold()}"
    cached = _cached(key)
    if cached is not None:
        return {"places": cached}
    _limit(client_ip(request))
    try:
        places = await search_settlements(query)
    except GeocoderError as exc:
        raise _unavailable(exc) from exc
    _store(key, places)
    return {"places": places}
