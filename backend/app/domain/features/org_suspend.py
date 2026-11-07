"""С17 «Приостановить допуск».

Допущенная организация остаётся на платформе, её страница и уже опубликованные встречи видны,
но новые встречи от её имени не публикуются, пока администратор не возобновит допуск.
Причину видят представитель и администратор, остальные — только сам факт приостановки.
"""

import re
from typing import TYPE_CHECKING, Any

from app.domain import clock
from app.domain.errors import fail
from app.domain.features import reports
from app.domain.features.kit import commit, db, notify
from app.domain.features.participation_host import input_text
from app.domain.types import ID, Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

MIN_REASON = 5

_SPACES = re.compile(r"\s+")


def _get_org(id_: ID) -> Entity:
    found = next((o for o in db().organizations if o["id"] == id_), None)
    return found if found is not None else fail("not_found", "Организация не найдена")


def assert_org_active(o: Entity) -> None:
    """Проверка при публикации встречи от имени организации."""
    if o.get("suspension") is not None:
        fail(
            "org_suspended",
            f"Допуск организации приостановлен администратором: {o['suspension']['reason']} Публиковать новые встречи от её имени пока нельзя.",
        )


def suspend_organization(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = reports.require_admin(actor)
    o = _get_org(id_)
    reason = _SPACES.sub(" ", input_text(input_.get("reason"))).strip()[:600]
    if o.get("suspension") is not None:
        return d.organization_view(admin, o)
    if o["status"] != "approved":
        fail("org_wrong_status", "Приостановить можно только допущенную организацию")
    if len(reason) < MIN_REASON:
        fail(
            "reason_required",
            "Укажите причину. Её увидит представитель организации",
            {"reason": "Напишите, что случилось и что исправить"},
        )
    at = clock.iso(clock.now())
    o["suspension"] = {
        "reason": reason if reason.endswith((".", "!", "?")) else f"{reason}.",
        "at": at,
        "by": admin["id"],
    }
    o["updatedAt"] = at
    notify(
        d,
        [o["ownerId"]],
        "org_suspended",
        "Допуск организации приостановлен",
        f"«{o['name']}»: {o['suspension']['reason']} Опубликованные встречи остаются, новые публиковать пока нельзя. Когда исправите, напишите администратору.",
        f"/org/{o['id']}",
    )
    reports.audit_log(d, admin, "org.suspend", "org", o["id"], o["name"], reason)
    commit(["organizations", "notifications", "audit", "admin", "events"], [o["id"]])
    return d.organization_view(admin, o)


def resume_organization(d: "Domain", actor: Actor, id_: ID, input_: dict[str, Any]) -> Entity:
    admin = reports.require_admin(actor)
    o = _get_org(id_)
    if o.get("suspension") is None:
        return d.organization_view(admin, o)
    note = _SPACES.sub(" ", input_text(input_.get("reason"))).strip()[:600]
    o["suspension"] = None
    o["updatedAt"] = clock.iso(clock.now())
    notify(
        d,
        [o["ownerId"]],
        "org_resumed",
        "Допуск организации возобновлён",
        f"«{o['name']}» снова может публиковать встречи.{f' {note}' if note else ''}",
        f"/org/{o['id']}",
    )
    reports.audit_log(d, admin, "org.resume", "org", o["id"], o["name"], note)
    commit(["organizations", "notifications", "audit", "admin", "events"], [o["id"]])
    return d.organization_view(admin, o)
