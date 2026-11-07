"""Заполнение профиля из ВКонтакте по ссылке на страницу.

Сайт запрашивает открытые поля страницы через API VK (`users.get`) сервисным ключом приложения,
находит в них виды спорта из каталога и уровень, собирает «О себе» и забирает фото. Человек видит
найденное и сам решает, что перенести: в профиль ничего не пишется без его нажатия.
"""

import base64
import re
from typing import Any

import httpx

from app.domain import assistant
from app.domain.types import Entity

API_VERSION = "5.199"
FIELDS = "about,activities,interests,status,city,photo_200,photo_400_orig,domain,games"
MAX_PHOTO_BYTES = 110_000  # data URL после base64 укладывается в лимит фото профиля (160 000 символов)

_LINK = re.compile(
    r"^(?:https?://)?(?:www\.|m\.)?(?:vk\.com|vk\.ru|vkontakte\.ru)/([A-Za-z0-9_.]{2,64})/?(?:[?#].*)?$",
    re.IGNORECASE,
)
_PLAIN = re.compile(r"^@?([A-Za-z0-9_.]{2,64})$")
_RESERVED = {"feed", "im", "friends", "groups", "audio", "video", "settings", "login", "search", "away.php"}


class VkError(Exception):
    """Понятная человеку причина, почему не получилось."""


def parse_link(link: str) -> str | None:
    """Ссылка, короткое имя или id → то, что принимает `users.get` (`durov`, `id1`, `1`)."""
    link = (link or "").strip()
    found = _LINK.match(link) or _PLAIN.match(link)
    if not found:
        return None
    name = found.group(1)
    if name.lower() in _RESERVED or name.lower().startswith(("public", "club", "event")):
        return None
    return name[2:] if re.fullmatch(r"id\d+", name, re.IGNORECASE) else name


async def fetch_profile(client: httpx.AsyncClient, api_url: str, token: str, ref: str) -> Entity:
    try:
        response = await client.post(
            f"{api_url.rstrip('/')}/users.get",
            data={"user_ids": ref, "fields": FIELDS, "lang": "ru", "v": API_VERSION, "access_token": token},
        )
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise VkError("ВКонтакте сейчас не отвечает. Попробуйте позже") from exc
    error = body.get("error") if isinstance(body, dict) else None
    if error:
        code = error.get("error_code")
        if code in {113, 18}:
            raise VkError("Такой страницы ВКонтакте нет. Проверьте ссылку")
        raise VkError("ВКонтакте не дал данные страницы. Попробуйте позже")
    users = body.get("response") or []
    if not users:
        raise VkError("Такой страницы ВКонтакте нет. Проверьте ссылку")
    user = users[0]
    if user.get("deactivated"):
        raise VkError("Эта страница ВКонтакте удалена или заблокирована")
    return user


async def fetch_photo(client: httpx.AsyncClient, user: Entity) -> str | None:
    """Фото страницы как data URL: ссылки VK со временем перестают открываться, поэтому храним копию."""
    for key in ("photo_400_orig", "photo_200"):
        url = user.get(key)
        if (
            not isinstance(url, str)
            or not url.startswith("https://")
            or "camera_" in url
            or "deactivated" in url
        ):
            continue
        try:
            response = await client.get(url)
        except httpx.HTTPError:
            continue
        kind = response.headers.get("content-type", "").split(";")[0]
        ok = response.status_code == 200 and kind in {"image/jpeg", "image/png", "image/webp"}  # noqa: PLR2004
        if ok and len(response.content) <= MAX_PHOTO_BYTES:
            return f"data:{kind};base64,{base64.b64encode(response.content).decode()}"
    return None


def _clean(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def texts(user: Entity) -> list[tuple[str, str]]:
    """Поля страницы, где люди пишут о себе: (подпись для человека, текст)."""
    out = [
        ("О себе", _clean(user.get("about"))),
        ("Интересы", _clean(user.get("interests"))),
        ("Деятельность", _clean(user.get("activities"))),
        ("Статус", _clean(user.get("status"))),
        ("Игры", _clean(user.get("games"))),
    ]
    return [(label, text) for label, text in out if text]


def _level_of(text: str) -> str | None:
    t = text.lower()
    if assistant.BEGINNER.search(t) or assistant.BEGINNERS_WELCOME.search(t):
        return "beginner"
    if assistant.EXPERIENCED.search(t):
        return "experienced"
    if assistant.AMATEUR.search(t):
        return "amateur"
    return None


def _sentence(text: str) -> str:
    text = text.strip().rstrip(",;")
    return text if not text or text[-1] in ".!?…" else f"{text}."


def _about(fields: dict[str, str]) -> str:
    """«О себе» и «Деятельность» как есть, списки интересов отдельным предложением."""
    parts = [_sentence(fields[k]) for k in ("О себе", "Деятельность") if fields.get(k)]
    if fields.get("Интересы"):
        parts.append(_sentence(f"Интересы: {fields['Интересы']}"))
    return _clean(" ".join(dict.fromkeys(parts)))[:500]


POSTS_COUNT = 10
POST_CHARS = 600


async def fetch_posts(client: httpx.AsyncClient, api_url: str, token: str, owner_id: int) -> list[str]:
    """Тексты последних записей человека на своей стене (с текстом репостов). Закрыта стена — пусто."""
    try:
        response = await client.post(
            f"{api_url.rstrip('/')}/wall.get",
            data={
                "owner_id": owner_id,
                "count": POSTS_COUNT,
                "filter": "owner",
                "v": API_VERSION,
                "access_token": token,
            },
        )
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return []
    items = (body.get("response") or {}).get("items") if isinstance(body, dict) else None
    out: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        parts = [item.get("text"), *((c or {}).get("text") for c in item.get("copy_history") or [])]
        text = _clean(" ".join(p for p in parts if isinstance(p, str)))
        if text:
            out.append(text[:POST_CHARS])
    return out[:POSTS_COUNT]


def _in_posts(n: int) -> str:
    return "Есть в записи на стене" if n == 1 else f"Есть в {n} записях на стене"


# Если человек нигде не называет спорт, предлагаем подходящий по образу жизни: (признак, вид, почему).
_HINTS: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"природ|лес[ау]?\b|гор[аыу]\b|поход|путешеств|туризм|палатк|столб"),
        "Походы",
        "любите природу",
    ),
    (re.compile(r"собак|пёс|щен|прогулк|гуля"), "Скандинавская ходьба", "любите гулять"),
    (re.compile(r"музык|танц|концерт|вечеринк"), "Танцы", "любите музыку"),
    (re.compile(r"книг|чита|шахмат|настольн|головолом|логик"), "Шахматы", "любите спокойные умные игры"),
    (re.compile(r"велосипед|велик|вело"), "Велопрогулки", "катаетесь на велосипеде"),
    (re.compile(r"мор[ея]|пляж|плава|бассейн|озер"), "Плавание", "любите воду"),
    (re.compile(r"игр[аыу]|гейм|киберспорт|playstation|xbox|steam"), "Фиджитал-игры", "любите игры"),
    (re.compile(r"снег|зим[аы]|горнолыж|сноуборд"), "Лыжи", "любите зиму"),
    (re.compile(r"здоров|питани|похуд|фитнес|зож"), "Зарядка", "следите за здоровьем"),
    (
        re.compile(r"работ|офис|программ|разработ|учёб|учеб|сесси"),
        "Йога",
        "поможет отдохнуть после работы и учёбы",
    ),
]
_DEFAULTS = ("Скандинавская ходьба", "Бег", "Зарядка", "Йога")
_FOR_START = "Советуем для начала: подходит почти всем, встречи для новичков есть каждую неделю"


def _ensure_sport(found: list[Entity], corpus: str, sports: list[Entity]) -> list[Entity]:
    """Каждому человеку хотя бы один вид спорта: по образу жизни из текстов, иначе подходящий для начала."""
    if found:
        return found
    by_name = {s["name"]: s for s in sports if not s.get("mergedInto")}
    low = corpus.lower()
    for pattern, name, why in _HINTS:
        if name in by_name and pattern.search(low):
            sport = by_name[name]
            return [
                {
                    "sportId": sport["id"],
                    "name": name,
                    "why": f"Советуем попробовать: {why}",
                    "suggested": True,
                }
            ]
    for name in _DEFAULTS:
        if name in by_name:
            return [{"sportId": by_name[name]["id"], "name": name, "why": _FOR_START, "suggested": True}]
    return found


def suggest(user: Entity, sports: list[Entity], posts: list[str] | None = None) -> Entity:
    """Что перенести в профиль: «О себе», виды спорта с объяснением, уровень, город.

    Виды спорта — из полей страницы и последних записей на стене: чаще упоминается — выше в списке.
    Если спорта нигде нет, всё равно предлагаем один: по образу жизни или подходящий для начала.
    """
    posts = posts or []
    sources = texts(user)
    weight: dict[str, float] = {}
    found: dict[str, Entity] = {}
    for label, text in sources:
        scan = assistant._scan_sports(text, sports)  # noqa: SLF001  тот же разбор, что у поиска фразой
        for hit in scan["hits"]:
            sport = hit["sport"]
            weight[sport["id"]] = weight.get(sport["id"], 0) + 2
            found.setdefault(
                sport["id"],
                {"sportId": sport["id"], "name": sport["name"], "why": f"{label}: «{hit['term']}»"},
            )
    in_posts: dict[str, int] = {}
    for post in posts:
        for sport in assistant._scan_sports(post, sports)["sports"]:  # noqa: SLF001
            in_posts[sport["id"]] = in_posts.get(sport["id"], 0) + 1
            found.setdefault(sport["id"], {"sportId": sport["id"], "name": sport["name"], "why": ""})
    for sport_id, n in in_posts.items():
        weight[sport_id] = weight.get(sport_id, 0) + n
        found[sport_id]["why"] = (
            f"{found[sport_id]['why']}; {_in_posts(n).lower()}" if found[sport_id]["why"] else _in_posts(n)
        )
    ranked = sorted(found.values(), key=lambda s: -weight.get(s["sportId"], 0))[:8]
    all_texts = [*(t for _, t in sources), *posts]
    level = next((lv for lv in (_level_of(t) for t in all_texts) if lv), None)
    city = (user.get("city") or {}).get("title") if isinstance(user.get("city"), dict) else None
    return {
        "vkId": user.get("id"),
        "name": _clean(f"{user.get('first_name', '')} {user.get('last_name', '')}"),
        "link": f"https://vk.com/{user.get('domain') or 'id' + str(user.get('id'))}",
        "closed": bool(user.get("is_closed")) and not user.get("can_access_closed"),
        "city": city,
        "about": _about(dict(sources)),
        "sports": _ensure_sport(ranked, " ".join(all_texts), sports),
        "level": level,
        "sources": [label for label, _ in sources] + (["Записи на стене"] if posts else []),
        "posts": len(posts),
        "source": "rules",
    }


AI_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["about", "sports", "level"],
    "properties": {
        "about": {"type": "string", "description": "1–3 предложения от первого лица, до 300 символов"},
        "sports": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "why"],
                "properties": {
                    "name": {"type": "string", "description": "Точное название из каталога"},
                    "why": {"type": "string", "description": "Почему, до 80 символов, со ссылкой на данные"},
                },
            },
        },
        "level": {"type": ["string", "null"], "enum": ["beginner", "amateur", "experienced", None]},
    },
}


def ai_instruction(user: Entity, catalog: list[str], posts: list[str] | None = None) -> str:
    fields = "\n".join(f"{label}: {text}" for label, text in texts(user)) or "Поля профиля пустые."
    wall = "\n".join(f"{i + 1}. {p[:400]}" for i, p in enumerate(posts or [])) or "Записей нет."
    return (
        "Помоги заполнить профиль на сайте совместных спортивных встреч по открытым данным страницы "
        "ВКонтакте: полям профиля и последним записям на стене.\n"
        "1. «О себе»: 1–3 предложения от первого лица простыми словами, без восклицаний и без выдуманных "
        "фактов. Если данных мало, напиши коротко о том, что видно (город, увлечения), или оставь пусто.\n"
        "2. Виды спорта: ОБЯЗАТЕЛЬНО хотя бы один, только точные названия из каталога. Сначала те, что прямо "
        "упомянуты. Если спорт нигде не упомянут, выбери 1–2 самых подходящих человеку по его увлечениям и "
        "образу жизни, удобных для новичка, и в why коротко объясни связь, например «любите природу».\n"
        "3. Уровень (beginner, amateur, experienced) или null, если неясно.\n\n"
        f"Каталог видов спорта: {', '.join(catalog)}.\n\nПоля профиля:\n{fields}\n\nЗаписи на стене:\n{wall}"
    )


def merge_ai(base: Entity, ai: dict[str, Any], sports: list[Entity]) -> Entity:
    """Ответ модели поверх правил: только виды из каталога, текст не длиннее лимита.

    Найденное правилами прямо в текстах остаётся первым; совет «попробовать» модель заменяет своим.
    """
    by_name = {s["name"].lower(): s for s in sports if not s.get("mergedInto")}
    picked = [s for s in base["sports"] if not s.get("suggested")]
    for item in ai.get("sports") or []:
        name, why = (item.get("name"), item.get("why")) if isinstance(item, dict) else (item, "")
        sport = by_name.get(str(name or "").strip().lower())
        if sport and all(p["sportId"] != sport["id"] for p in picked):
            text = _clean(why)[:100] or "По записям на странице"
            picked.append({"sportId": sport["id"], "name": sport["name"], "why": f"Помощник: {text}"})
    about = _clean(ai.get("about"))[:500] or base["about"]
    level = ai.get("level") if ai.get("level") in {"beginner", "amateur", "experienced"} else base["level"]
    return {
        **base,
        "about": about,
        "sports": (picked or base["sports"])[:8],
        "level": level,
        "source": "model",
    }
