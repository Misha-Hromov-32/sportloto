"""Боты Telegram и VK: привязки чатов к аккаунтам и одноразовые коды привязки.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bot_links",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(120), server_default="", nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("platform IN ('telegram', 'vk')", name=op.f("ck_bot_links_platform")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_bot_links_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bot_links")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_bot_links_token_hash")),
    )
    op.create_index(op.f("ix_bot_links_user_id"), "bot_links", ["user_id"])
    op.create_index(
        "uq_bot_links_platform_external_id_active",
        "bot_links",
        ["platform", "external_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    op.create_table(
        "bot_codes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("external_id", sa.String(64), nullable=True),
        sa.Column("display_name", sa.String(120), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("link_id", sa.String(64), nullable=True),
        sa.CheckConstraint("kind IN ('site', 'bot')", name=op.f("ck_bot_codes_kind")),
        sa.CheckConstraint("platform IN ('telegram', 'vk')", name=op.f("ck_bot_codes_platform")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_bot_codes_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["link_id"], ["bot_links.id"], name=op.f("fk_bot_codes_link_id_bot_links"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bot_codes")),
    )
    op.create_index(op.f("ix_bot_codes_code_hash"), "bot_codes", ["code_hash"])


def downgrade() -> None:
    op.drop_index(op.f("ix_bot_codes_code_hash"), table_name="bot_codes")
    op.drop_table("bot_codes")
    op.drop_index("uq_bot_links_platform_external_id_active", table_name="bot_links")
    op.drop_index(op.f("ix_bot_links_user_id"), table_name="bot_links")
    op.drop_table("bot_links")
