"""Допустимые статусы основных сущностей и естественные ключи записей.

CHECK на статусы события, записи, организации, сообщения и объявления «Ищу компанию» (значения —
app/domain/statuses.py на момент миграции) и UNIQUE: одна запись человека на событие, одно «в избранном»,
один управляющий клуба. UNIQUE отложены до конца транзакции, как и внешние ключи.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECKS = {
    ("organizations", "status"): ("draft", "pending", "approved", "rejected", "returned", "blocked"),
    ("events", "status"): ("published", "cancelled", "removed", "deleted"),
    ("events", "join_mode"): ("open", "approval"),
    ("participations", "status"): (
        "confirmed",
        "pending",
        "waitlist",
        "rejected",
        "cancelled",
        "event_removed",
        "removed",
    ),
    ("messages", "status"): ("visible", "hidden", "deleted"),
    ("companions", "status"): ("open", "gathered", "closed"),
}

_UNIQUE = {
    "participations": ("event_id", "user_id"),
    "favorites": ("user_id", "event_id"),
    "org_managers": ("org_id", "user_id"),
}


def upgrade() -> None:
    for (table, column), values in _CHECKS.items():
        allowed = ", ".join(f"'{v}'" for v in values)
        op.create_check_constraint(op.f(f"ck_{table}_{column}"), table, f"{column} IN ({allowed})")
    for table, columns in _UNIQUE.items():
        op.create_unique_constraint(
            op.f(f"uq_{table}_{columns[0]}"), table, list(columns), deferrable=True, initially="DEFERRED"
        )


def downgrade() -> None:
    for table, columns in _UNIQUE.items():
        op.drop_constraint(op.f(f"uq_{table}_{columns[0]}"), table, type_="unique")
    for table, column in _CHECKS:
        op.drop_constraint(op.f(f"ck_{table}_{column}"), table, type_="check")
