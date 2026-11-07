"""Почта для регистрации: только российские почтовые сервисы.

Федеральный закон от 31.07.2023 № 406-ФЗ (изменения в 149-ФЗ «Об информации…», действует с 01.12.2023):
владелец российского сайта авторизует пользователей из России только по российскому номеру телефона,
через Госуслуги, Единую биометрическую систему или через информационную систему российского
гражданина или юрлица. Поэтому вход с почтой Gmail, Outlook, iCloud и других иностранных сервисов
не регистрируем.

Разрешено: почта российских сервисов (Яндекс, Mail.ru, Рамблер) и адреса на российских доменах
(.ru, .рф, .su и региональные). Служебные зоны .test, .example, .localhost, .invalid (RFC 2606)
не принимают почту из интернета и нужны только для проверок. Правило то же, что во фронтенде:
`frontend/src/lib/emailPolicy.ts`.

Уже зарегистрированные аккаунты продолжают входить: закон обратной силы не имеет.
"""

# Почтовые сервисы российских компаний на доменах вне .ru.
RUSSIAN_PROVIDERS = frozenset({"yandex.com", "yandex.by", "yandex.kz", "yandex.uz", "ya.ru"})

# Российские доменные зоны: .ru, .su, .рф, .рус, .москва, .moscow, .дети, .tatar.
RUSSIAN_ZONES = frozenset(
    {"ru", "su", "xn--p1ai", "xn--p1acf", "xn--80adxhks", "moscow", "xn--d1acj3b", "tatar"}
)

TEST_ZONES = frozenset({"test", "example", "localhost", "invalid"})

# Только для понятного текста ошибки: остальные иностранные домены отклоняются так же.
KNOWN_FOREIGN = (
    "gmail.",
    "googlemail.",
    "outlook.",
    "hotmail.",
    "live.",
    "msn.",
    "icloud.",
    "me.com",
    "mac.com",
    "yahoo.",
    "ymail.",
    "aol.",
    "proton.",
    "protonmail.",
    "pm.me",
    "gmx.",
    "zoho.",
    "tutanota.",
    "tuta.",
    "mail.com",
)

ALLOWED_HINT = "Подойдёт почта Яндекса, Mail.ru, Рамблера или адрес на домене .ru и .рф"


def email_domain(email: str) -> str | None:
    value = email.strip().lower()
    if len(value) > 254 or value.count("@") != 1 or any(char.isspace() for char in value):
        return None
    local, domain = value.split("@", 1)
    first, separator, rest = domain.partition(".")
    if not local or not first or not separator or not rest:
        return None
    domain = domain.rstrip(".")
    try:
        # «почта.рф» → «xn--80a1acny.xn--p1ai»: зоны сравниваем в одном виде.
        return domain.encode("idna").decode("ascii")
    except UnicodeError:
        return domain


def is_allowed_email(email: str) -> bool:
    domain = email_domain(email)
    if domain is None:
        return False
    if domain in RUSSIAN_PROVIDERS:
        return True
    zone = domain.rsplit(".", 1)[-1]
    return zone in RUSSIAN_ZONES or zone in TEST_ZONES


def foreign_email_message(email: str) -> str:
    """Текст под полем почты, если адрес не подходит."""
    domain = email_domain(email) or ""
    if any(domain.startswith(name) or domain == name for name in KNOWN_FOREIGN):
        return f"Почту {domain} зарегистрировать нельзя: по закону нужен российский сервис. {ALLOWED_HINT}"
    return f"Нужна почта российского сервиса. {ALLOWED_HINT}"
