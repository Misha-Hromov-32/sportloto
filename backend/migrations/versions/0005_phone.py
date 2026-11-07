"""Телефон: коды из SMS и подтверждённые номера.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "phone_codes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_phone_codes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_codes")),
    )
    op.create_index("ix_phone_codes_phone_created_at", "phone_codes", ["phone", "created_at"])
    op.create_index("ix_phone_codes_ip_created_at", "phone_codes", ["ip", "created_at"])
    op.create_index("ix_phone_codes_user_id_created_at", "phone_codes", ["user_id", "created_at"])
    op.create_index("ix_phone_codes_created_at", "phone_codes", ["created_at"])

    op.create_table(
        "phone_status",
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_phone_status_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_phone_status")),
    )


def downgrade() -> None:
    op.drop_table("phone_status")
    op.drop_index("ix_phone_codes_created_at", table_name="phone_codes")
    op.drop_index("ix_phone_codes_user_id_created_at", table_name="phone_codes")
    op.drop_index("ix_phone_codes_ip_created_at", table_name="phone_codes")
    op.drop_index("ix_phone_codes_phone_created_at", table_name="phone_codes")
    op.drop_table("phone_codes")
