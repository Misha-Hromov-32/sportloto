"""Журнал согласий и удалённые аккаунты.

`user_consents` — какие согласия человек дал при регистрации, с какой редакцией документов и с какого IP;
при удалении аккаунта ставится время отзыва. Роль `deleted` — обезличенный удалённый аккаунт.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_consents",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('terms', 'personal_data', 'public_profile')", name=op.f("ck_user_consents_kind")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_consents_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_consents")),
    )
    op.create_index("ix_user_consents_user_id_kind", "user_consents", ["user_id", "kind"], unique=False)
    op.drop_constraint(op.f("ck_users_role"), "users", type_="check")
    op.create_check_constraint(op.f("ck_users_role"), "users", "role IN ('user', 'admin', 'deleted')")


def downgrade() -> None:
    # Удалённые аккаунты остаются обезличенными и неактивными: войти в них нельзя.
    op.execute("UPDATE users SET role = 'user' WHERE role = 'deleted'")
    op.drop_constraint(op.f("ck_users_role"), "users", type_="check")
    op.create_check_constraint(op.f("ck_users_role"), "users", "role IN ('user', 'admin')")
    op.drop_index("ix_user_consents_user_id_kind", table_name="user_consents")
    op.drop_table("user_consents")
