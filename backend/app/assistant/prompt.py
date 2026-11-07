"""Подсказка для модели и проверка её ответа.

Модель получает: правила поведения, базу знаний о сайте (knowledge.md, собирается из
frontend/src/pages/chat/knowledge.ts), профиль человека, его записи, подборку «Для вас» нашей
системы рекомендаций и переписку. Отвечает строго JSON по REPLY_SCHEMA. Действия модель только
предлагает: выполняет их сайт после подтверждения человеком.
"""

import json
import re
from functools import cache
from pathlib import Path
from typing import Any

ACTION_TYPES = (
    "navigate",
    "create_event",
    "join_event",
    "leave_event",
    "create_companion",
    "favorite_event",
    "update_profile",
)

_NULL_STR = {"type": ["string", "null"]}
_NULL_INT = {"type": ["integer", "null"]}

ACTION_PARAMS: dict[str, Any] = {
    "path": _NULL_STR,
    "eventId": _NULL_STR,
    "sport": _NULL_STR,
    "title": _NULL_STR,
    "description": _NULL_STR,
    "date": _NULL_STR,
    "time": _NULL_STR,
    "durationMin": _NULL_INT,
    "address": _NULL_STR,
    "capacity": _NULL_INT,
    "price": _NULL_INT,
    "level": {"type": ["string", "null"], "enum": ["any", "beginner", "amateur", "experienced", None]},
    "joinMode": {"type": ["string", "null"], "enum": ["open", "approval", None]},
    "text": _NULL_STR,
    "when": _NULL_STR,
    "district": _NULL_STR,
    "interests": {"type": ["array", "null"], "items": {"type": "string"}},
}

# Строгая схема (все поля обязательны, лишних нет): так её принимают и Codex, и OpenAI-совместимые API.
REPLY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "links", "search", "action", "question", "options"],
    "properties": {
        "text": {"type": "string", "description": "Ответ человеку, 1–5 коротких предложений"},
        "links": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "to"],
                "properties": {"label": {"type": "string"}, "to": {"type": "string"}},
            },
        },
        "search": {
            "type": ["string", "null"],
            "description": "Фраза для подбора встреч системой сайта, если человек ищет, куда пойти",
        },
        "action": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["type", "summary", "params"],
                    "properties": {
                        "type": {"type": "string", "enum": list(ACTION_TYPES)},
                        "summary": {"type": "string"},
                        "params": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": list(ACTION_PARAMS),
                            "properties": ACTION_PARAMS,
                        },
                    },
                },
            ]
        },
        "question": {"type": ["string", "null"]},
        "options": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
    },
}

RULES = """Ты помощник сайта «Спорт и точка»: платформа, где люди находят компанию для спорта и
встречаются на тренировках и играх. Отвечай по-русски, на «вы», коротко и конкретно, простыми словами
для людей с разным опытом, включая пожилых. Без восклицаний, без «легко» и «всего пара кликов».

Как отвечать:
1. Как что-то сделать на сайте — объясни по базе знаний ниже: куда перейти, какую кнопку нажать
   (названия кнопок в «ёлочках», как на сайте). Дай 1–3 ссылки на страницы сайта (поле links,
   только пути из базы знаний или из подборки, начинаются с «/»). Не выдумывай кнопок и разделов.
2. Человек ищет, куда пойти, с кем позаниматься, что есть в выходные и т.п. — заполни search
   короткой фразой для системы подбора (вид спорта, когда, район, уровень, «бесплатно»), например
   «волейбол в субботу вечером, новичок». Вид спорта — одно конкретное название из каталога ниже
   (не «командные игры»); если человек не назвал вид, оставь только время, район и уровень, а лучше
   выбери по его интересам или подборке. Карточки встреч сайт покажет сам. Можешь сослаться на
   подборку «Для вас» ниже, если она подходит. Не придумывай встречи, которых нет в данных.
3. Человек просит сделать что-то за него — предложи действие в поле action. Сайт покажет карточку
   с кнопкой «Подтвердить», и только после неё действие выполнится. Перед действием спроси всё,
   чего не хватает (поле question и варианты options), по одному-двум вопросам за раз.
   - create_event: нужны вид спорта, дата (ГГГГ-ММ-ДД), время (ЧЧ:ММ), адрес; желательно число мест
     (capacity), цена с человека в рублях (price, 0 — бесплатно), уровень, название, описание.
   - join_event / leave_event / favorite_event: нужен eventId из подборки или записей человека.
   - create_companion: text — что человек ищет, sport, when (например «выходные вечером»), district.
   - update_profile: interests — названия видов спорта, district — район.
   - navigate: path — страница сайта.
   В summary кратко опиши действие («Создать встречу «Волейбол» в субботу, 19:00»). Неиспользуемые
   параметры — null. Гостю (не вошёл на сайт) предлагай войти: действие navigate на /login.
4. Вопрос не про сайт и не про спорт — вежливо скажи, что помогаешь с занятиями на сайте.
5. Никогда не проси пароли, данные карт и документов. Не называй себя моделью и не упоминай,
   как ты устроен.
Все поля ответа обязательны: пустые — null или [] по схеме."""


@cache
def knowledge() -> str:
    path = Path(__file__).with_name("knowledge.md")
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _event_line(e: dict[str, Any]) -> str:
    price = e.get("price") or {}
    cost = (
        "бесплатно" if price.get("kind") == "free" else f"{price.get('amount') or price.get('total') or ''} ₽"
    )
    left = (e.get("counts") or {}).get("spotsLeft")
    places = "" if left is None else f", мест: {left}"
    why = "; ".join(e.get("matchReasons") or [])
    return (
        f"- id={e['id']} «{e['title']}» ({e['sport']['name']}), {e['startsAt']}, "
        f"{(e.get('place') or {}).get('address', '')}, {cost}{places}"
        + (f". Почему подходит: {why}" if why else "")
    )


def context_block(ctx: dict[str, Any]) -> str:
    user = ctx.get("user")
    lines = [f"Сейчас: {ctx['now']}. Город: {ctx['city']}. Человек на странице: {ctx.get('page') or '/'}."]
    if not user:
        lines.append("Человек не вошёл на сайт (гость): записаться и создавать встречи можно после входа.")
    else:
        lines.append(
            f"Человек: {user['name']}, роль: {user['role']}. "
            f"Интересы: {', '.join(user['interests']) or 'не указаны'}. "
            f"Район: {user.get('district') or 'не указан'}. Уровни: {user.get('levels') or 'не указаны'}."
        )
        if ctx.get("mine"):
            lines.append("Его ближайшие записи:")
            lines.extend(_event_line(e) + f" [статус: {e['my']['status']}]" for e in ctx["mine"])
        if ctx.get("organizing"):
            lines.append("Встречи, которые он проводит:")
            lines.extend(_event_line(e) for e in ctx["organizing"])
    if ctx.get("forYou"):
        lines.append("Подборка «Для вас» системы рекомендаций сайта:")
        lines.extend(_event_line(e) for e in ctx["forYou"])
    if ctx.get("upcoming"):
        lines.append("Ближайшие открытые встречи в городе:")
        lines.extend(_event_line(e) for e in ctx["upcoming"])
    if ctx.get("sports"):
        lines.append("Виды спорта в каталоге: " + ", ".join(ctx["sports"]) + ".")
    return "\n".join(lines)


_WORD = re.compile(r"[а-яёa-z0-9]{4,}")


def _stems(text: str) -> set[str]:
    return {w[:5] for w in _WORD.findall(text.lower().replace("ё", "е"))}


def relevant_knowledge(question: str, limit: int = 8) -> str:
    """Карта страниц и самые подходящие к вопросу темы: для моделей с небольшим контекстом."""
    head, _, rest = knowledge().partition("## Как что сделать")
    topics = [t for t in rest.split("\n### ") if t.strip()]
    asked = _stems(question)
    ranked = sorted(topics, key=lambda t: -len(asked & _stems(t)))
    titles = ", ".join(t.strip().split("\n", 1)[0].lstrip("# ") for t in topics)
    picked = "\n### ".join(t.strip() for t in ranked[:limit])
    return f"{head}## Как что сделать (подходящие темы)\n\n### {picked}\n\nДругие темы: {titles}."


def system_prompt(question: str | None = None) -> str:
    """Без вопроса — вся база знаний (мост на Codex), с вопросом — только подходящие темы."""
    base = relevant_knowledge(question) if question is not None else knowledge()
    return f"{RULES}\n\n# База знаний о сайте\n\n{base}"


def conversation(history: list[dict[str, str]]) -> list[dict[str, str]]:
    """Переписка из чата: последние 12 сообщений, каждое не длиннее 1500 символов."""
    out: list[dict[str, str]] = []
    for m in history[-12:]:
        role = m.get("role")
        text = str(m.get("text") or "").strip()[:1500]
        if role in {"user", "assistant"} and text:
            out.append({"role": role, "content": text})
    return out


def flat_prompt(ctx_text: str, history: list[dict[str, str]]) -> str:
    """Одна строка для моста (Codex принимает один запрос)."""
    talk = "\n".join(f"{'Человек' if m['role'] == 'user' else 'Помощник'}: {m['content']}" for m in history)
    return (
        f"{system_prompt()}\n\n# Данные сайта на этот момент\n\n{ctx_text}\n\n# Переписка\n\n{talk}\n\n"
        "Ответь на последнее сообщение человека. Не запускай команды и не открывай файлы: "
        "сразу верни один JSON-объект по схеме ответа."
    )


_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)
_SAFE_PATH = re.compile(r"^/(?!/)[A-Za-z0-9/_\-?=&.%,:+]*$")


def _str(value: object, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def parse_reply(raw: str) -> dict[str, Any]:  # noqa: C901, PLR0912  проверка каждого поля ответа
    """Ответ модели → безопасная форма для чата. Битый ответ — ValueError (чат уйдёт на запасной путь)."""
    raw = raw.strip()
    try:
        data = json.loads(raw)
    except ValueError:
        found = _JSON_BLOCK.search(raw)
        if not found:
            raise
        data = json.loads(found.group(0))
    if not isinstance(data, dict) or not _str(data.get("text"), 4000):
        raise ValueError("В ответе нет текста")
    links = [
        {"label": _str(link.get("label"), 80), "to": link.get("to")}
        for link in (data.get("links") or [])[:3]
        if isinstance(link, dict)
        and isinstance(link.get("to"), str)
        and _SAFE_PATH.match(link["to"])
        and _str(link.get("label"), 80)
    ]
    action = data.get("action")
    clean_action: dict[str, Any] | None = None
    if isinstance(action, dict) and action.get("type") in ACTION_TYPES:
        params = action.get("params") if isinstance(action.get("params"), dict) else {}
        clean: dict[str, Any] = {}
        for key in ACTION_PARAMS:
            value = params.get(key)
            if value is None:
                continue
            if key in {"durationMin", "capacity", "price"}:
                try:
                    clean[key] = max(0, min(100_000, int(value)))
                except (TypeError, ValueError):
                    continue
            elif key == "interests":
                if isinstance(value, list):
                    clean[key] = [s for s in (_str(v, 60) for v in value[:10]) if s]
            else:
                text = _str(value, 2000 if key == "description" else 300)
                if text:
                    clean[key] = text
        if action["type"] == "navigate" and not _SAFE_PATH.match(str(clean.get("path") or "")):
            clean_action = None
        else:
            clean_action = {
                "type": action["type"],
                "summary": _str(action.get("summary"), 300) or "Выполнить действие",
                "params": clean,
            }
    options = [o for o in (_str(v, 80) for v in (data.get("options") or [])[:5]) if o]
    return {
        "text": _str(data.get("text"), 4000),
        "links": links,
        "search": _str(data.get("search"), 300),
        "action": clean_action,
        "question": _str(data.get("question"), 300),
        "options": options,
    }
