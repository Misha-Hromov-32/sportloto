"""Демо-данные городов кроме основного набора Красноярска: Москва и Брянск целиком,
Красноярску — логотипы и обложки клубов, обложки встреч без фото, фото вещей на полке и вещи «Продаю»."""

from datetime import timedelta
from typing import Any

from app.domain import clock
from app.domain.seed import city_bryansk, city_moscow
from app.domain.seed.city_kit import seed_city
from app.domain.seed.city_photos import cover, item, logo

# Встречи Красноярска без обложки (спам и снятые остаются без фото)
_KRAS_EVENT_COVERS = {
    "e-chess-kids": "chess_giant_square",
    "e-taichi": "yoga_tree_hills",
    "e-gorodki": "seniors_game",
    "e-phygital": "foot_goalie",
    "e-hiking": "hike_ridge",
    "e-tabletennis-live": "tt_office",
    "e-hockey": "hockey_net_blue",
    "e-checkers": "chess_giant_bw",
}

# Одно фото — не больше трёх раз: часть встреч и площадок Красноярска получает другое фото
_KRAS_COVER_SWAPS = {
    "e-corp-volley": "volley_women",
    "e-volley-sun": "hall_arena",
    "e-volley-vzlet": "hall_school",
    "e-workout-akadem-w3": "group_park_women",
}
_KRAS_VENUE_SWAPS = {"v-vzlet-courts": "tennis_court", "v-tennis-hall": "tennis_racket_green"}

# Клубы Красноярска: логотип и обложка. Рекламная и заблокированная организации — без фото.
_KRAS_ORG_PHOTOS = {
    "o-ladya": ("chess_dark", "chess_park_giant"),
    "o-morning": ("seniors_bands", "group_square"),
    "o-legends": ("foot_on_ball", "foot_legs"),
    "o-vorontsova": ("yoga_pier", "yoga_mountain"),
    "o-enisey": ("run_sunset", "run_marathon"),
    "o-shag": ("forest_aerial", "forest_lake"),
    "o-tropa": ("hike_woman", "hills"),
    "o-pixel": ("foot_ball_dusk", "stadium_night"),
    "o-volan": ("badm_shuttle", "badm_hall"),
    "o-krastech": ("sneakers_red", "run_blur"),
    "o-venue-arena": ("hall_hoop_sun", "stadium"),
    "o-venue-city": ("foot_grass_line", "bask_bridge"),
    "o-venue-volna": ("swim_goggles", "swim_race"),
    "o-sportmaster": ("tennis_balls_racket", "foot_ball_boots"),
}

_KRAS_SHELF_PHOTOS = {
    "sh-legends-balls": "foot_ball_sky",
    "sh-legends-bibs": "foot_feet_ball",
    "sh-legends-cones": "fit_outdoor",
    "sh-ladya-sets": "chess_pawns",
    "sh-ladya-clocks": "chess_big_pieces",
    "sh-morning-poles": "walk_group",
    "sh-morning-mats": "mat_close",
    "sh-yoga-mats": "mats_rolled",
    "sh-sm-volley": "volley_beach",
    "sh-sm-basket": "bask_ball_close",
    "sh-sm-bibs": "foot_amateur",
    "sh-sm-net": "volley_ball",
    "sh-sm-skis": "skis_snow",
    "sh-pavel-rackets": "badm_racket",
    "sh-pavel-shuttles": "badm_shuttles",
    "sh-artem-pingpong": "tt_paddle",
    "sh-ksenia-ball": "volley_beach",
    "sh-konstantin-poles": "hike_woman",
    "sh-sofia-helmet": "helmet_bench",
    "sh-dmitry-ball": "bask_balls",
}

# Вещи людей Красноярска: часть продаётся, палатку дают на выходные
_KRAS_SHELF_MORE: list[dict[str, Any]] = [
    {
        "id": "sh-sofia-bike",
        "owner": "u-sofia",
        "name": "Шоссейный велосипед, рама 52 см",
        "kind": "other",
        "sportId": "s-cycling",
        "condition": "used",
        "districtId": "d-vzlet",
        "terms": ["pickup"],
        "note": "Катала два сезона, всё обслужено весной. Покажу и дам прокатиться у дома на Взлётке.",
        "photo": "bike_road",
        "sale": 25000,
        "days": 6,
    },
    {
        "id": "sh-alina-racket",
        "owner": "u-alina",
        "name": "Теннисная ракетка, 300 г",
        "kind": "racket",
        "sportId": "s-tennis",
        "condition": "good",
        "districtId": "d-pokrovka",
        "terms": ["pickup"],
        "note": "Перешла на более лёгкую. Новая обмотка, струны натянуты в сентябре.",
        "photo": "tennis_racket_blue",
        "sale": 3500,
        "days": 3,
    },
    {
        "id": "sh-ruslan-gloves",
        "owner": "u-ruslan",
        "name": "Боксёрские перчатки, 14 унций",
        "kind": "protection",
        "sportId": "s-boxing",
        "condition": "good",
        "districtId": "d-zhd",
        "terms": ["pickup"],
        "note": "Запасная пара из зала, кожа целая. Подойдут для тренировок и лёгких спаррингов.",
        "photo": "box_gloves",
        "sale": 2000,
        "days": 9,
    },
    {
        "id": "sh-maxim-sneakers",
        "owner": "u-maxim",
        "name": "Баскетбольные кроссовки, 44 размер",
        "kind": "other",
        "sportId": "s-basketball",
        "condition": "good",
        "districtId": "d-oct",
        "terms": ["pickup"],
        "note": "Высокие, хорошо держат голеностоп. Малы на полразмера.",
        "photo": "sneakers_high",
        "sale": 3000,
        "days": 2,
    },
    {
        "id": "sh-konstantin-tent",
        "owner": "u-konstantin",
        "name": "Двухместная палатка",
        "kind": "other",
        "sportId": "s-hiking",
        "condition": "good",
        "districtId": "d-kirov",
        "terms": ["return_after", "pickup"],
        "note": "Даю на выходные тем, кто идёт со мной на Столбы впервые.",
        "photo": "tent_sunset",
        "days": 20,
    },
]


def _photos_for_krasnoyarsk(ctx: dict[str, Any]) -> None:
    now = ctx["now"]
    for e in ctx["events"]:
        if e["id"] in _KRAS_EVENT_COVERS and not e.get("coverUrl"):
            e["coverUrl"] = cover(_KRAS_EVENT_COVERS[e["id"]])
        if e["id"] in _KRAS_COVER_SWAPS:
            e["coverUrl"] = cover(_KRAS_COVER_SWAPS[e["id"]])
    for v in ctx["venues"]:
        if v["id"] in _KRAS_VENUE_SWAPS:
            v["photoUrl"] = cover(_KRAS_VENUE_SWAPS[v["id"]])
    for o in ctx["organizations"]:
        if o["id"] in _KRAS_ORG_PHOTOS:
            logo_key, cover_key = _KRAS_ORG_PHOTOS[o["id"]]
            o["logoUrl"] = o.get("logoUrl") or logo(logo_key)
            o["coverUrl"] = o.get("coverUrl") or cover(cover_key)
    for s in ctx["shelf"]:
        if s["id"] in _KRAS_SHELF_PHOTOS and not s.get("photoUrl"):
            s["photoUrl"] = item(_KRAS_SHELF_PHOTOS[s["id"]])
    for x in _KRAS_SHELF_MORE:
        at = clock.iso(now - timedelta(days=x["days"]))
        record: dict[str, Any] = {
            "id": x["id"],
            "owner": {"kind": "user", "id": x["owner"]},
            "createdBy": x["owner"],
            "note": x["note"],
            "name": x["name"],
            "kind": x["kind"],
            "sportId": x["sportId"],
            "quantity": 1,
            "condition": x["condition"],
            "districtId": x["districtId"],
            "terms": x["terms"],
            "photoUrl": item(x["photo"]),
            "createdAt": at,
            "updatedAt": at,
        }
        if x.get("sale"):
            record["sale"] = {"price": x["sale"]}
        ctx["shelf"].append(record)


def seed_cities(ctx: dict[str, Any]) -> None:
    _photos_for_krasnoyarsk(ctx)
    seed_city(city_moscow, ctx)
    seed_city(city_bryansk, ctx)
