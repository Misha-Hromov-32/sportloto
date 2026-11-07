"""Подборка дня: настройки человека и отправленные подборки.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "digest_prefs",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("is_on", sa.Boolean(), nullable=True),
        sa.Column("hour", sa.Integer(), nullable=True),
        sa.Column("email", sa.Boolean(), nullable=True),
        sa.Column("last_day", sa.Text(), nullable=True),
        sa.Column("token", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_digest_prefs_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_digest_prefs")),
    )
    op.create_index(op.f("ix_digest_prefs_token"), "digest_prefs", ["token"], unique=False)

    op.create_table(
        "digests",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("day", sa.Text(), nullable=True),
        sa.Column("trigger_kind", sa.String(length=64), nullable=True),
        sa.Column("mail", sa.String(length=64), nullable=True),
        sa.Column("mail_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("intro", sa.Text(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_digests_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_digests")),
    )
    op.create_index(op.f("ix_digests_user_id"), "digests", ["user_id"], unique=False)
    op.create_index(op.f("ix_digests_mail"), "digests", ["mail"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_digests_mail"), table_name="digests")
    op.drop_index(op.f("ix_digests_user_id"), table_name="digests")
    op.drop_table("digests")
    op.drop_index(op.f("ix_digest_prefs_token"), table_name="digest_prefs")
    op.drop_table("digest_prefs")
