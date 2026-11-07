"""Числа в ответах и подписях: разбор ввода и запись по-русски."""

import math

NBSP = " "


def parse_number(value: object) -> int | float | None:
    """Число из JSON или строки ввода («2,5» тоже); None — если числа нет. Целое возвращается как int."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        number = value
    elif isinstance(value, str):
        try:
            number = float(value.strip().replace(",", "."))
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def format_number(value: float, max_fraction: int = 3) -> str:
    """«1 500», «2,5»: разряды через неразрывный пробел, дробная часть через запятую, без лишних нулей."""
    text = f"{value:,.{max_fraction}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in {"-0", ""}:
        text = "0"
    return text.replace(",", NBSP).replace(".", ",")
