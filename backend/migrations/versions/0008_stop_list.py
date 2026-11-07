"""Стоп-листы организаторов и причина, по которой организатор убрал человека из участников.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("participations", sa.Column("removed_reason", sa.Text(), nullable=True))
    op.create_table(
        "stop_entries",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_kind", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("reason_text", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lifted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lifted_by", sa.String(length=64), nullable=True),
        sa.Column("lifted_reason", sa.Text(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_stop_entries_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["added_by"],
            ["users.id"],
            name=op.f("fk_stop_entries_added_by_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["lifted_by"],
            ["users.id"],
            name=op.f("fk_stop_entries_lifted_by_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stop_entries")),
        sa.UniqueConstraint("owner_kind", "owner_id", "user_id", name="uq_stop_entries_owner_user"),
    )
    op.create_index(op.f("ix_stop_entries_user_id"), "stop_entries", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_stop_entries_user_id"), table_name="stop_entries")
    op.drop_table("stop_entries")
    op.drop_column("participations", "removed_reason")
