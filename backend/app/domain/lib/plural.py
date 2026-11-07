"""Склонение по числу (правила CLDR для русского языка)."""

from app.domain.lib.numbers import NBSP, format_number

type Forms = tuple[str, str, str]


def _rule(n: float) -> str:
    if not float(n).is_integer():
        return "other"
    i = abs(int(n))
    if i % 10 == 1 and i % 100 != 11:
        return "one"
    if 2 <= i % 10 <= 4 and not 12 <= i % 100 <= 14:
        return "few"
    return "many"


def plural(n: float, forms: Forms) -> str:
    """forms: (одна, две, пять) — «участник», «участника», «участников»."""
    rule = _rule(n)
    if rule == "one":
        return forms[0]
    if rule == "few":
        return forms[1]
    return forms[2]


def count(n: float, forms: Forms) -> str:
    """«5 участников» с неразрывным пробелом."""
    return f"{format_number(n)}{NBSP}{plural(n, forms)}"


WORDS: dict[str, Forms] = {
    "participant": ("участник", "участника", "участников"),
    "person": ("человек", "человека", "человек"),
    "place": ("место", "места", "мест"),
    "event": ("событие", "события", "событий"),
    "meeting": ("встреча", "встречи", "встреч"),
    "application": ("заявка", "заявки", "заявок"),
    "question": ("вопрос", "вопроса", "вопросов"),
    "answer": ("ответ", "ответа", "ответов"),
    "minute": ("минута", "минуты", "минут"),
    "hour": ("час", "часа", "часов"),
    "day": ("день", "дня", "дней"),
    "sport": ("направление", "направления", "направлений"),
    "notification": ("уведомление", "уведомления", "уведомлений"),
    "message": ("сообщение", "сообщения", "сообщений"),
    "response": ("отклик", "отклика", "откликов"),
    "organization": ("организация", "организации", "организаций"),
}
