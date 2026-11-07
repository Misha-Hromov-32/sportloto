"""С9. Личный календарь.

Предупреждение о пересечении по времени при записи и напоминания в приложении
за сутки и за 2 часа до начала.
"""

from datetime import timedelta

from app.domain import clock
from app.domain.event_reads import organized
from app.domain.features.participation_host import ParticipationHost, date_token, event_end
from app.domain.features.waitlist_offer import expire_offers, has_active_offer
from app.domain.lib.dates import format_time
from app.domain.types import ID, Entity

DAY = timedelta(days=1)
SOON = timedelta(hours=2)
KEEP_REMINDER_KEYS = 500


def find_conflicts(host: ParticipationHost, user: Entity, e: Entity) -> list[Entity]:
    """Что у человека в это же время.

    Встречи, где он участник, ждёт решения по заявке или держит место из листа ожидания,
    и встречи, которые он проводит сам.
    """
    start = clock.parse(e["startsAt"])
    end = event_end(e)
    if start is None or end is None:
        return []
    now = clock.now()

    def overlaps(x: Entity) -> bool:
        if x["id"] == e["id"] or host.event_state(x) not in ("upcoming", "live"):
            return False
        x_start, x_end = clock.parse(x["startsAt"]), event_end(x)
        return x_start is not None and x_end is not None and x_start < end and x_end > start

    result: dict[ID, Entity] = {}
    for p in host.db.participations:
        if p["userId"] != user["id"]:
            continue
        busy = p["status"] == "confirmed" or p["status"] == "pending" or has_active_offer(p, now)
        x = host.event(p["eventId"]) if busy else None
        if x is not None and overlaps(x):
            result[x["id"]] = to_conflict(x, "participant")
    for x in organized(host.db, user["id"]):
        if x["id"] not in result and host.is_organizer(user, x) and overlaps(x):
            result[x["id"]] = to_conflict(x, "organizer")
    return sorted(result.values(), key=lambda c: c["startsAt"])


def to_conflict(e: Entity, role: str) -> Entity:
    return {
        "eventId": e["id"],
        "title": e["title"],
        "startsAt": e["startsAt"],
        "durationMin": e["durationMin"],
        "role": role,
    }


def conflict_message(conflicts: list[Entity]) -> str:
    """«Пересекается с «Йога в студии» в 19:00»."""
    list_ = " и ".join(f"«{c['title']}» в {format_time(c['startsAt'])}" for c in conflicts)
    return f"Пересекается с {list_}"


def generate_reminders(host: ParticipationHost) -> list[ID]:
    """Напоминания участникам.

    Каждое отправляется один раз (ключ с временем начала: после переноса придёт новое).
    Кто записался уже внутри окна, напоминание этого окна не получает.
    """
    db = host.db
    now = clock.now()
    sent = db.reminders
    touched: list[ID] = []
    for p in db.participations:
        if p["status"] != "confirmed":
            continue
        e = host.event(p["eventId"])
        if e is None or host.event_state(e) != "upcoming":
            continue
        start = clock.parse(e["startsAt"])
        if start is None or not now < start <= now + DAY:
            continue
        soon = start - now <= SOON
        window_start = start - (SOON if soon else DAY)
        decided_at = p.get("decidedAt")
        decided = clock.parse(decided_at if decided_at is not None else p["createdAt"])
        if decided is not None and decided > window_start:
            continue
        key = f"{p['userId']}|{e['id']}|{'soon' if soon else 'day'}|{e['startsAt']}"
        if key in sent:
            continue
        sent.append(key)
        where = ". ".join(x for x in [e["place"].get("address"), e["place"].get("landmark")] if x)
        host.notify(
            [p["userId"]],
            "reminder",
            f"Через 2 часа: {e['title']}" if soon else f"Завтра: {e['title']}",
            f"Начало в {format_time(e['startsAt'])}. {where}."
            if soon
            else f"{date_token(e['startsAt'])}. {where}. Если не сможете прийти, отмените запись: место пригодится другим.",
            f"/events/{e['id']}",
        )
        touched.append(p["userId"])
    if len(sent) > KEEP_REMINDER_KEYS:
        db.reminders = sent[-KEEP_REMINDER_KEYS:]
    return touched


def participation_tick(host: ParticipationHost) -> bool:
    """Проверки по времени: истёкшие резервы из листа ожидания и напоминания.

    Запускаются фоновой проверкой сервера и перед каждым изменением данных.
    """
    events = expire_offers(host)
    reminded = generate_reminders(host)
    if not events and not reminded:
        return False
    resources = ["notifications"]
    if events:
        resources.extend(["events", "participations"])
    host.commit(resources, events)
    return True
