"""Единый словарь подписей: одно состояние называется одинаково везде, в ответах API и в интерфейсе."""

PARTICIPATION_STATUS = {
    "confirmed": {"label": "Вы участник", "tone": "ok", "icon": "check"},
    "pending": {"label": "Заявка на рассмотрении", "tone": "wait", "icon": "clock"},
    "waitlist": {"label": "Вы в листе ожидания", "tone": "wait", "icon": "queue"},
    "rejected": {"label": "Заявка отклонена", "tone": "danger", "icon": "cross"},
    "cancelled": {"label": "Вы отменили запись", "tone": "off", "icon": "calendarX"},
    "event_removed": {"label": "Запись приостановлена", "tone": "off", "icon": "ban"},
    "removed": {"label": "Организатор убрал вас из участников", "tone": "danger", "icon": "ban"},  # D-16
}

PARTICIPATION_STATUS_FOR_ORGANIZER = {
    "confirmed": {"label": "Участник", "tone": "ok", "icon": "check"},
    "pending": {"label": "Ждёт решения", "tone": "wait", "icon": "clock"},
    "waitlist": {"label": "В листе ожидания", "tone": "wait", "icon": "queue"},
    "rejected": {"label": "Отклонена", "tone": "danger", "icon": "cross"},
    "cancelled": {"label": "Отменил запись", "tone": "off", "icon": "calendarX"},
    "event_removed": {"label": "Запись приостановлена", "tone": "off", "icon": "ban"},
    "removed": {"label": "Убран из участников", "tone": "danger", "icon": "ban"},  # D-16
}

EVENT_STATE = {
    "upcoming": {"label": "Идёт запись", "tone": "ok", "icon": "check"},
    "live": {"label": "Уже идёт", "tone": "accent", "icon": "play"},
    "past": {"label": "Прошло", "tone": "off", "icon": "history"},
    "cancelled": {"label": "Отменено организатором", "tone": "off", "icon": "calendarX"},
    "removed": {"label": "Снято модератором", "tone": "danger", "icon": "ban"},
    "deleted": {"label": "Удалено", "tone": "off", "icon": "trash"},
}

ORG_STATUS = {
    "draft": {"label": "Черновик", "tone": "neutral", "icon": "pencil"},
    "pending": {"label": "На рассмотрении", "tone": "wait", "icon": "clock"},
    "approved": {"label": "Допущена", "tone": "ok", "icon": "shield"},
    "rejected": {"label": "Отклонена", "tone": "danger", "icon": "cross"},
    "returned": {"label": "Возвращена на доработку", "tone": "wait", "icon": "arrowUUpLeft"},
    "blocked": {"label": "Заблокирована", "tone": "danger", "icon": "lock"},
}

MESSAGE_HIDDEN = {"label": "Скрыто модератором", "tone": "off", "icon": "eyeSlash"}

ORG_TYPE = {
    "club": "Клуб",
    "circle": "Кружок или секция",
    "federation": "Федерация",
    "company": "Компания",
    "school": "Спортивная школа",
    "coach": "Тренер или авторская школа",
    "initiative": "Инициативная группа",
    "sponsor": "Спонсор или партнёр",
    "venue": "Площадка",
}

SKILL_LEVEL = {"beginner": "Новичок", "amateur": "Любитель", "experienced": "Опытный"}

EVENT_LEVEL = {
    "any": "Любой уровень",
    "beginner": "Для новичков",
    "amateur": "Для любителей",
    "experienced": "Для опытных",
}

EVENT_LEVEL_HINT = {
    "any": "Подойдёт и тем, кто пробует впервые, и тем, кто давно занимается",
    "beginner": "Учим с нуля, опыт не нужен",
    "amateur": "Нужно знать правила и немного играть",
    "experienced": "Играем в хорошем темпе, нужен опыт",
}

INTENSITY = {
    "low": {"label": "Спокойно", "hint": "Можно разговаривать, перерывы по желанию"},
    "medium": {"label": "Умеренно", "hint": "Немного запыхаетесь, перерывы есть"},
    "high": {"label": "Интенсивно", "hint": "Серьёзная нагрузка, нужна подготовка"},
}

JOIN_MODE = {
    "open": {
        "label": "Свободная запись",
        "hint": "Вы участник сразу, ждать ответа не нужно",
        "action": "Записаться",
    },
    "approval": {
        "label": "Запись по заявке",
        "hint": "Организатор посмотрит заявку и ответит. До ответа вы ещё не участник",
        "action": "Отправить заявку",
    },
}

READINESS = {
    "join": {"label": "Готов присоединиться", "hint": "Ищу, к кому пойти"},
    "organize": {"label": "Хочу организовать", "hint": "Соберу встречу, если найдутся люди"},
}

DAY_PART = {"morning": "Утром", "day": "Днём", "evening": "Вечером"}

COMPOSITION = {
    "mixed": {"label": "Смешанный", "hint": "Записаться может любой", "tag": None},
    "women": {
        "label": "Только женщины",
        "hint": "Записаться могут те, кто указал в профиле женский пол",
        "tag": "Только женщины",
    },
    "men": {
        "label": "Только мужчины",
        "hint": "Записаться могут те, кто указал в профиле мужской пол",
        "tag": "Только мужчины",
    },
}

GENDER = {"female": "Женский", "male": "Мужской"}
