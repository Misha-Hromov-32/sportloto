"""Типы данных правил. Записи и ответы — словари в форме контракта (frontend/src/types)."""

from typing import Any

# Запись коллекции (`SportEvent`, `Participation` …) или ответ API (`EventView` …): ключи camelCase.
Entity = dict[str, Any]
# Кто смотрит: пользователь (`User`) или гость.
Actor = dict[str, Any] | None
ID = str
