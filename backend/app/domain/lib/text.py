"""Работа с названиями и именами (порт frontend/src/lib/text.ts)."""

import re

_NOT_WORD = re.compile(r"[^a-zа-я0-9]+")
_LETTER = re.compile(r"[A-Za-zА-Яа-яЁё]")


def normalize(value: str) -> str:
    """Нормализация для поиска и сравнения названий: регистр, ё, знаки препинания, лишние пробелы."""
    return _NOT_WORD.sub(" ", value.lower().replace("ё", "е")).strip()


def edit_distance(a: str, b: str) -> int:
    """Расстояние Левенштейна: ловит опечатки в названиях направлений («валейбол» → «Волейбол»)."""
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev = row[0]
        row[0] = i
        for j in range(1, len(b) + 1):
            tmp = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + (0 if a[i - 1] == b[j - 1] else 1))
            prev = tmp
    return row[len(b)]


def initials(name: str) -> str:
    words = [w for w in re.split(r"\s+", re.sub(r'[«»"]', " ", name).strip()) if _LETTER.search(w)]
    first = words[0][0] if words else "?"
    second = words[1][0] if len(words) > 1 else ""
    return (first + second).upper()


def short_name(name: str) -> str:
    """«Анна Соколова» → «Анна С.» — так участники видят друг друга."""
    parts = name.split(" ")
    first = parts[0]
    second = parts[1] if len(parts) > 1 else ""
    return f"{first} {second[0]}." if second else first


def capitalize(value: str) -> str:
    return value[0].upper() + value[1:] if value else value


def truncate(value: str, max_len: int) -> str:
    return f"{value[: max_len - 1].rstrip()}…" if len(value) > max_len else value


def ru_sort_key(value: str) -> tuple[str, str]:
    """Ключ сортировки названий по-русски: без учёта регистра, «ё» рядом с «е»."""
    return value.casefold().replace("ё", "е"), value
