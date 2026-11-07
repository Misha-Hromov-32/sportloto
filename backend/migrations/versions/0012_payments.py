"""Оплата на сайте: платежи, очередь операций к ЮKassa, сроки оплаты, заказы вещей, зачисления и выплаты.

Встреча получает способ оплаты и итог сбора складчины, вещь на полке — цену «Продаю».

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("events", sa.Column("payment_mode", sa.String(length=64), nullable=True))
    op.add_column("events", sa.Column("pay_collect", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("shelf_items", sa.Column("sale", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_table(
        "payments",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=False),
        sa.Column("method", sa.String(length=64), nullable=False),
        sa.Column("base", sa.Double(), nullable=True),
        sa.Column("fee", sa.Double(), nullable=True),
        sa.Column("total", sa.Double(), nullable=True),
        sa.Column("fee_parts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("initial_total", sa.Double(), nullable=True),
        sa.Column("capture", sa.Boolean(), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("provider_payment_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("captured_amount", sa.Double(), nullable=True),
        sa.Column("refunded_amount", sa.Double(), nullable=True),
        sa.Column("confirmation_url", sa.Text(), nullable=True),
        sa.Column("forfeited", sa.Boolean(), nullable=True),
        sa.Column("credited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payments")),
    )
    op.create_index(
        op.f("ix_payments_provider_payment_id"), "payments", ["provider_payment_id"], unique=False
    )
    op.create_index(op.f("ix_payments_status"), "payments", ["status"], unique=False)
    op.create_index(op.f("ix_payments_target_id"), "payments", ["target_id"], unique=False)
    op.create_index(op.f("ix_payments_user_id"), "payments", ["user_id"], unique=False)
    op.create_table(
        "payment_ops",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("payment_id", sa.String(length=64), nullable=True),
        sa.Column("payout_id", sa.String(length=64), nullable=True),
        sa.Column("amount", sa.Double(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=True),
        sa.Column("idempotence_key", sa.Text(), nullable=True),
        sa.Column("provider_id", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payment_ops")),
    )
    op.create_index(op.f("ix_payment_ops_payment_id"), "payment_ops", ["payment_id"], unique=False)
    op.create_index(op.f("ix_payment_ops_provider_id"), "payment_ops", ["provider_id"], unique=False)
    op.create_index(op.f("ix_payment_ops_status"), "payment_ops", ["status"], unique=False)
    op.create_table(
        "payment_dues",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("participation_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payment_dues")),
    )
    op.create_index(op.f("ix_payment_dues_event_id"), "payment_dues", ["event_id"], unique=False)
    op.create_index(
        op.f("ix_payment_dues_participation_id"), "payment_dues", ["participation_id"], unique=False
    )
    op.create_table(
        "item_orders",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=True),
        sa.Column("item_name", sa.Text(), nullable=True),
        sa.Column("buyer_id", sa.String(length=64), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("price", sa.Double(), nullable=True),
        sa.Column("amount", sa.Double(), nullable=True),
        sa.Column("payment_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("pay_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_complete_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_by", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("seller_kind", sa.String(length=16), nullable=False),
        sa.Column("seller_id", sa.String(length=64), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_item_orders")),
    )
    op.create_index(op.f("ix_item_orders_buyer_id"), "item_orders", ["buyer_id"], unique=False)
    op.create_index(op.f("ix_item_orders_item_id"), "item_orders", ["item_id"], unique=False)
    op.create_table(
        "balance_credits",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Double(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipient_kind", sa.String(length=16), nullable=False),
        sa.Column("recipient_id", sa.String(length=64), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_balance_credits")),
    )
    op.create_index(
        op.f("ix_balance_credits_recipient_kind_recipient_id"),
        "balance_credits",
        ["recipient_kind", "recipient_id"],
        unique=False,
    )
    op.create_table(
        "payouts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Double(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("method", sa.String(length=64), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("bank_id", sa.String(length=64), nullable=True),
        sa.Column("bank_name", sa.Text(), nullable=True),
        sa.Column("provider_payout_id", sa.String(length=64), nullable=True),
        sa.Column("requested_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("recipient_kind", sa.String(length=16), nullable=False),
        sa.Column("recipient_id", sa.String(length=64), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payouts")),
    )
    op.create_index(
        op.f("ix_payouts_recipient_kind_recipient_id"),
        "payouts",
        ["recipient_kind", "recipient_id"],
        unique=False,
    )
    op.create_index(op.f("ix_payouts_status"), "payouts", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_payouts_status"), table_name="payouts")
    op.drop_index(op.f("ix_payouts_recipient_kind_recipient_id"), table_name="payouts")
    op.drop_index(op.f("ix_balance_credits_recipient_kind_recipient_id"), table_name="balance_credits")
    op.drop_index(op.f("ix_item_orders_item_id"), table_name="item_orders")
    op.drop_index(op.f("ix_item_orders_buyer_id"), table_name="item_orders")
    op.drop_index(op.f("ix_payment_dues_participation_id"), table_name="payment_dues")
    op.drop_index(op.f("ix_payment_dues_event_id"), table_name="payment_dues")
    op.drop_index(op.f("ix_payment_ops_status"), table_name="payment_ops")
    op.drop_index(op.f("ix_payment_ops_provider_id"), table_name="payment_ops")
    op.drop_index(op.f("ix_payment_ops_payment_id"), table_name="payment_ops")
    op.drop_index(op.f("ix_payments_user_id"), table_name="payments")
    op.drop_index(op.f("ix_payments_target_id"), table_name="payments")
    op.drop_index(op.f("ix_payments_status"), table_name="payments")
    op.drop_index(op.f("ix_payments_provider_payment_id"), table_name="payments")
    op.drop_table("payments")
    op.drop_table("payment_ops")
    op.drop_table("payment_dues")
    op.drop_table("item_orders")
    op.drop_table("balance_credits")
    op.drop_table("payouts")
    op.drop_column("shelf_items", "sale")
    op.drop_column("events", "pay_collect")
    op.drop_column("events", "payment_mode")
