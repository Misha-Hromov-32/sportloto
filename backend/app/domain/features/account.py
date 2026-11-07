"""Удаление аккаунта по просьбе владельца.

Записи на будущие встречи отменяются, свои встречи отменяются с уведомлением записавшихся,
объявления закрываются, личные списки и уведомления удаляются. Сама запись пользователя
обезличивается: сообщения в общих обсуждениях и история прошедших встреч остаются без имени автора
(Политика, п. 8.2). Войти в удалённый аккаунт нельзя, почту можно зарегистрировать заново.
Пароль, сессии, коды почты и SMS, отзыв согласий — у сервиса входа (app/api/routes/auth.py).
"""

from typing import TYPE_CHECKING

from app.domain.errors import fail
from app.domain.features.kit import commit, db, require_user
from app.domain.features.managers import engagement
from app.domain.statuses import ACTIVE_PARTICIPATION, EventStatus
from app.domain.types import Actor, Entity

if TYPE_CHECKING:
    from app.domain.core import Domain

DELETED_NAME = "Удалённый пользователь"
CANCEL_REASON = "организатор удалил аккаунт"


def _check(user: Entity) -> None:
    if user.get("demo"):
        fail("forbidden", "Демо-аккаунт удалить нельзя: на нём показывают, как работает сайт")
    if user["role"] == "admin":
        fail("forbidden", "Аккаунт администратора удалить нельзя")
    owned = next((o for o in db().organizations if o["ownerId"] == user["id"]), None)
    if owned is not None:
        fail(
            "bad_state",
            f"Вы представитель организации «{owned['name']}». Напишите нам через раздел «Документы»: "
            "решим, кому передать организацию, и удалим аккаунт",
        )


def delete_account(d: "Domain", actor: Actor) -> Entity:
    user = require_user(actor)
    _check(user)
    uid = user["id"]
    data = db()

    # Свои встречи: будущие и идущие отменяются, записавшиеся получают уведомление.
    for e in d._organizer_events_for_read({"kind": "user", "id": uid}):
        if e["status"] != EventStatus.CANCELLED and d.event_state(e) in ("upcoming", "live"):
            d.cancel_event(user, e["id"], {"reason": CANCEL_REASON})
    # Записи и заявки на будущие встречи: места переходят листу ожидания.
    for p in [p for p in data.participations if p["userId"] == uid and p["status"] in ACTIVE_PARTICIPATION]:
        e = data.record("events", p["eventId"])
        if e is not None and d.event_state(e) == "upcoming":
            d.leave(user, e["id"])

    for c in data.companions:
        if c["authorId"] == uid:
            c["status"] = "closed"
        c["metoo"] = [m for m in c["metoo"] if m["userId"] != uid]
    data.invites = [i for i in data.invites if i["toUserId"] != uid]
    data.notifications = [n for n in data.notifications if n["userId"] != uid]
    data.greeters = [g for g in data.greeters if g["userId"] != uid]
    data.first_visits = [f for f in data.first_visits if f["userId"] != uid]
    data.demand_signals = [s for s in data.demand_signals if s["userId"] != uid]
    data.digest_prefs = [p for p in data.digest_prefs if p["userId"] != uid]
    data.digests = [x for x in data.digests if x["userId"] != uid]
    data.mcp_tokens = [t for t in data.mcp_tokens if t["userId"] != uid]
    s = engagement()
    s.favorites = [f for f in s.favorites if f["userId"] != uid]
    s.follows = [f for f in s.follows if f["userId"] != uid]
    s.saved_searches = [x for x in s.saved_searches if x["userId"] != uid]
    s.managers = [m for m in s.managers if m["userId"] != uid]
    s.share_links = [x for x in s.share_links if x["userId"] != uid]

    user.update(
        {
            "name": DELETED_NAME,
            "avatarUrl": None,
            "age": None,
            "role": "deleted",
            "districtId": None,
            "about": "",
            "interests": [],
            "levels": {},
            "readiness": None,
            "home": None,
            "email": f"{uid}@deleted.invalid",
            "phone": "",
            "gender": None,
        }
    )
    commit(
        ["users", "events", "participations", "messages", "companions", "invites", "notifications"],
        [uid],
    )
    return {"ok": True}
