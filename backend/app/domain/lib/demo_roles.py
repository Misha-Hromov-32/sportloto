"""Подписи демо-аккаунтов на странице входа.

Организация демо-аккаунта проходит сценарий S2 и меняет статус, поэтому подсказка «что здесь проверять»
выбирается по текущему статусу организации, а не хранится одной строкой с момента заполнения демо-данных.
"""

# Пользователь → (его организация, статус в исходных демо-данных, подсказки для других статусов).
# В исходном статусе показывается подсказка из демо-данных пользователя.
DEMO_ORGS: dict[str, tuple[str, str, dict[str, str]]] = {
    "u-olga": ("o-ladya", "approved", {}),
    "u-sergey": (
        "o-enisey",
        "pending",
        {"approved": "Клуб допущен (S2): публикует события от имени клуба, они сразу в поиске"},
    ),
    "u-natalia": (
        "o-shag",
        "pending",
        {"rejected": "Видит причину отказа (S2), исправляет заявку и отправляет снова"},
    ),
    "u-igor": (
        "o-pixel",
        "rejected",
        {"pending": "Исправленная заявка ждёт проверки (S2), публиковать пока нельзя"},
    ),
    "u-elena-k": ("o-venue-arena", "approved", {}),
    "u-andrey": ("o-sportmaster", "approved", {}),
    "u-irina-p": ("o-krastech", "approved", {}),
}

ORG_STATUS_HINT = {
    "draft": "Заявка организации ещё не отправлена",
    "pending": "Заявка организации ждёт проверки, публиковать от её имени пока нельзя",
    "approved": "Организация допущена: публикует события от своего имени, они сразу в поиске",
    "rejected": "Видит причину отказа, исправляет заявку и отправляет снова",
    "returned": "Заявку вернули на доработку: видно, что исправить",
    "blocked": "Организация заблокирована, публиковать от её имени нельзя",
}


def demo_hint(user_id: str, seed_hint: str, org_status: str | None) -> str:
    """Подсказка демо-аккаунта для текущего статуса его организации."""
    entry = DEMO_ORGS.get(user_id)
    if entry is None or org_status is None:
        return seed_hint
    _, seed_status, hints = entry
    if org_status == seed_status:
        return seed_hint
    return hints.get(org_status) or ORG_STATUS_HINT.get(org_status) or seed_hint
