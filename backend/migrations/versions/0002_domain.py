"""Доменные данные: справочники, события, записи, обсуждения, организации и модули платформы.

Таблицы повторяют коллекции контракта API (app/domain/schema.py). Вложенные значения —
JSONB, порядок записей внутри коллекции — колонка ord. Внешние ключи отложенные: правила
добавляют связанные записи в одной транзакции в любом порядке.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("target_title", sa.Text(), nullable=True),
        sa.Column("rule_id", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(op.f("ix_audit_log_action"), "audit_log", ["action"], unique=False)
    op.create_table(
        "community_sources",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("org_id", sa.String(length=64), nullable=True),
        sa.Column("transferred_to", sa.String(length=64), nullable=True),
        sa.Column("transferred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_community_sources")),
    )
    op.create_table(
        "demand_log",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("sport_id", sa.String(length=64), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("phrase", sa.Text(), nullable=True),
        sa.Column("audience", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("free", sa.Boolean(), nullable=True),
        sa.Column("results", sa.Integer(), nullable=True),
        sa.Column("demo", sa.Boolean(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_demand_log")),
    )
    op.create_index(op.f("ix_demand_log_at"), "demand_log", ["at"], unique=False)
    op.create_table(
        "demand_offers",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.Text(), nullable=True),
        sa.Column("org_id", sa.String(length=64), nullable=True),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("invited", postgresql.ARRAY(sa.String(length=64)), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_demand_offers")),
    )
    op.create_table(
        "demand_signals",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("sport_id", sa.String(length=64), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("slot", sa.String(length=64), nullable=True),
        sa.Column("level", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_demand_signals")),
    )
    op.create_table(
        "demo_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("seeded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_demo_state")),
    )
    op.create_table(
        "districts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lng", sa.Double(), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_districts")),
    )
    op.create_table(
        "gear_loans",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=True),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("line_id", sa.String(length=64), nullable=True),
        sa.Column("requester_id", sa.String(length=64), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gear_loans")),
    )
    op.create_index(op.f("ix_gear_loans_item_id"), "gear_loans", ["item_id"], unique=False)
    op.create_table(
        "held_asked",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_held_asked")),
    )
    op.create_table(
        "idempotency_keys",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("resource", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_idempotency_keys")),
    )
    op.create_table(
        "match_notified",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_match_notified")),
    )
    op.create_table(
        "mcp_calls",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("token_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("method", sa.Text(), nullable=True),
        sa.Column("tool", sa.Text(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=True),
        sa.Column("preview", sa.Boolean(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_calls")),
    )
    op.create_table(
        "platform_rules",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_rules")),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("reporter_id", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.String(length=64), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(length=64), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
    )
    op.create_table(
        "sent_reminders",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_sent_reminders")),
    )
    op.create_table(
        "shelf_items",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("sport_id", sa.String(length=64), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("condition", sa.String(length=64), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("terms", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_kind", sa.String(length=16), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shelf_items")),
    )
    op.create_table(
        "sport_categories",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("parent_id", sa.String(length=64), nullable=True),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sport_categories")),
    )
    op.create_table(
        "imported_posts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("external_id", sa.Text(), nullable=True),
        sa.Column("post_url", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("meeting", sa.Boolean(), nullable=True),
        sa.Column("draft", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("assisted", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.String(length=64), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["community_sources.id"],
            name=op.f("fk_imported_posts_source_id_community_sources"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_imported_posts")),
    )
    op.create_table(
        "follows",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_follows_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_follows")),
    )
    op.create_table(
        "mcp_tokens",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("hash", sa.String(length=64), nullable=True),
        sa.Column("last4", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_mcp_tokens_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_tokens")),
    )
    op.create_index(op.f("ix_mcp_tokens_hash"), "mcp_tokens", ["hash"], unique=False)
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("link", sa.Text(), nullable=True),
        sa.Column("read", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False)
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sport_ids", postgresql.ARRAY(sa.String(length=64)), nullable=True),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("contacts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("reviews", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_with_assistant", sa.Boolean(), nullable=True),
        sa.Column("ai_flag", sa.String(length=64), nullable=True),
        sa.Column("ai_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("suspension", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["district_id"],
            ["districts.id"],
            name=op.f("fk_organizations_district_id_districts"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_organizations_owner_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organizations")),
    )
    op.create_index(op.f("ix_organizations_owner_id"), "organizations", ["owner_id"], unique=False)
    op.create_index(op.f("ix_organizations_status"), "organizations", ["status"], unique=False)
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("query", sa.Text(), nullable=True),
        sa.Column("criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_saved_searches_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_saved_searches")),
    )
    op.create_table(
        "sports",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("synonyms", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("category_ids", postgresql.ARRAY(sa.String(length=64)), nullable=True),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("popular", sa.Boolean(), nullable=True),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("merged_into", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_sports_created_by_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["merged_into"],
            ["sports.id"],
            name=op.f("fk_sports_merged_into_sports"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sports")),
    )
    op.create_table(
        "companions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("author_id", sa.String(length=64), nullable=False),
        sa.Column("sport_id", sa.String(length=64), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("point", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("when_text", sa.Text(), nullable=True),
        sa.Column("level", sa.String(length=64), nullable=True),
        sa.Column("readiness", sa.String(length=64), nullable=True),
        sa.Column("metoo", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("created_with_assistant", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_companions_author_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["sport_id"],
            ["sports.id"],
            name=op.f("fk_companions_sport_id_sports"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_companions")),
    )
    op.create_table(
        "org_managers",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("org_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("added_by", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name=op.f("fk_org_managers_org_id_organizations"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_org_managers_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_org_managers")),
    )
    op.create_table(
        "support_needs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("org_id", sa.String(length=64), nullable=True),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("offers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("closed_by_org_id", sa.String(length=64), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name=op.f("fk_support_needs_org_id_organizations"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_support_needs")),
    )
    op.create_table(
        "venues",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("org_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("landmark", sa.Text(), nullable=True),
        sa.Column("district_id", sa.String(length=64), nullable=True),
        sa.Column("lat", sa.Double(), nullable=True),
        sa.Column("lng", sa.Double(), nullable=True),
        sa.Column("sport_ids", postgresql.ARRAY(sa.String(length=64)), nullable=True),
        sa.Column("indoor", sa.Boolean(), nullable=True),
        sa.Column("price_per_hour", sa.Double(), nullable=True),
        sa.Column("peak_price_per_hour", sa.Double(), nullable=True),
        sa.Column("features", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("photo_url", sa.Text(), nullable=True),
        sa.Column("contacts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("hours", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("time_zone", sa.Text(), nullable=True),
        sa.Column("slots", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("owner_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["district_id"],
            ["districts.id"],
            name=op.f("fk_venues_district_id_districts"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name=op.f("fk_venues_org_id_organizations"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_venues")),
    )
    op.create_index(op.f("ix_venues_org_id"), "venues", ["org_id"], unique=False)
    op.create_table(
        "events",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sport_id", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("place", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("level", sa.String(length=64), nullable=True),
        sa.Column("beginners_welcome", sa.Boolean(), nullable=True),
        sa.Column("first_step", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("price", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("payment_note", sa.Text(), nullable=True),
        sa.Column("cancel_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("join_mode", sa.String(length=64), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("min_participants", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("moderation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("series", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("private_info", sa.Text(), nullable=True),
        sa.Column("discussion", sa.String(length=64), nullable=True),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("cover_url", sa.Text(), nullable=True),
        sa.Column("created_with_assistant", sa.Boolean(), nullable=True),
        sa.Column("ai_flag", sa.String(length=64), nullable=True),
        sa.Column("ai_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("venue_id", sa.String(length=64), nullable=True),
        sa.Column("access_extras", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("composition", sa.String(length=64), nullable=True),
        sa.Column("visibility", sa.String(length=64), nullable=True),
        sa.Column("invite_code", sa.String(length=64), nullable=True),
        sa.Column("family", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("organizer_kind", sa.String(length=16), nullable=False),
        sa.Column("organizer_id", sa.String(length=64), nullable=False),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["sport_id"],
            ["sports.id"],
            name=op.f("fk_events_sport_id_sports"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["venues.id"],
            name=op.f("fk_events_venue_id_venues"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
    )
    op.create_index(
        "ix_events_organizer_kind_organizer_id", "events", ["organizer_kind", "organizer_id"], unique=False
    )
    op.create_index(op.f("ix_events_sport_id"), "events", ["sport_id"], unique=False)
    op.create_index(op.f("ix_events_starts_at"), "events", ["starts_at"], unique=False)
    op.create_index(op.f("ix_events_status"), "events", ["status"], unique=False)
    op.create_table(
        "event_greeters",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_event_greeters_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_event_greeters_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_event_greeters")),
    )
    op.create_table(
        "event_programs",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("with_companion", sa.Boolean(), nullable=True),
        sa.Column("by_user_id", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_event_programs_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_event_programs")),
    )
    op.create_table(
        "event_teams",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("captain_id", sa.String(length=64), nullable=True),
        sa.Column("members", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("needs_approval", sa.Boolean(), nullable=True),
        sa.Column("accepted", sa.Boolean(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_event_teams_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_event_teams")),
    )
    op.create_index(op.f("ix_event_teams_event_id"), "event_teams", ["event_id"], unique=False)
    op.create_table(
        "favorites",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_favorites_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_favorites_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_favorites")),
    )
    op.create_table(
        "first_visits",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("with_companion", sa.Boolean(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_first_visits_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_first_visits_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_first_visits")),
    )
    op.create_table(
        "gear_lines",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_gear_lines_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gear_lines")),
    )
    op.create_index(op.f("ix_gear_lines_event_id"), "gear_lines", ["event_id"], unique=False)
    op.create_table(
        "gear_pledges",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("line_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_gear_pledges_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_gear_pledges_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gear_pledges")),
    )
    op.create_table(
        "held_votes",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("answer", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_held_votes_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_held_votes_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_held_votes")),
    )
    op.create_table(
        "invite_grants",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_invite_grants_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_invite_grants_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_invite_grants")),
    )
    op.create_table(
        "invites",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("from_user_id", sa.String(length=64), nullable=True),
        sa.Column("to_user_id", sa.String(length=64), nullable=True),
        sa.Column("companion_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_invites_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["from_user_id"],
            ["users.id"],
            name=op.f("fk_invites_from_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["to_user_id"],
            ["users.id"],
            name=op.f("fk_invites_to_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invites")),
    )
    op.create_index(op.f("ix_invites_event_id"), "invites", ["event_id"], unique=False)
    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("author_id", sa.String(length=64), nullable=True),
        sa.Column("as_org_id", sa.String(length=64), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("reply_to", sa.String(length=64), nullable=True),
        sa.Column("reactions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("hidden_reason", sa.Text(), nullable=True),
        sa.Column("hidden_by", sa.String(length=64), nullable=True),
        sa.Column("system", sa.Boolean(), nullable=True),
        sa.Column("ai_flag", sa.String(length=64), nullable=True),
        sa.Column("ai_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_messages_author_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_messages_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    op.create_index(op.f("ix_messages_event_id"), "messages", ["event_id"], unique=False)
    op.create_table(
        "participations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("prev_status", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("needs_escort", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("offer", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("left_because", sa.String(length=64), nullable=True),
        sa.Column("children", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("adult_seat", sa.Boolean(), nullable=True),
        sa.Column("team_id", sa.String(length=64), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_participations_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_participations_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_participations")),
    )
    op.create_index(op.f("ix_participations_event_id"), "participations", ["event_id"], unique=False)
    op.create_index(op.f("ix_participations_user_id"), "participations", ["user_id"], unique=False)
    op.create_table(
        "share_links",
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_share_links_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_share_links_user_id_users"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("token", name=op.f("pk_share_links")),
    )
    op.create_table(
        "urgent_calls",
        sa.Column("pk", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("need", sa.Integer(), nullable=True),
        sa.Column("baseline", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified", postgresql.ARRAY(sa.String(length=64)), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_urgent_calls_event_id_events"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("pk", name=op.f("pk_urgent_calls")),
    )
    # Дробный порядок демо-аккаунтов (7.5) — между соседями без перенумерации.
    op.alter_column("users", "demo_order", type_=sa.Double(), existing_nullable=True)
    op.add_column("users", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("city", sa.Text(), server_default="Красноярск", nullable=False))
    op.add_column("users", sa.Column("district_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("about", sa.Text(), server_default="", nullable=False))
    op.add_column(
        "users",
        sa.Column("interests", postgresql.ARRAY(sa.String(length=64)), server_default="{}", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("levels", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
    )
    op.add_column("users", sa.Column("readiness", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("home", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("users", sa.Column("radius_km", sa.Integer(), server_default="5", nullable=False))
    op.add_column("users", sa.Column("phone", sa.Text(), server_default="", nullable=False))
    op.add_column("users", sa.Column("gender", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False))
    op.create_foreign_key(
        op.f("fk_users_district_id_districts"),
        "users",
        "districts",
        ["district_id"],
        ["id"],
        initially="DEFERRED",
        deferrable=True,
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_users_district_id_districts"), "users", type_="foreignkey")
    op.drop_column("users", "ord")
    op.alter_column(
        "users",
        "demo_order",
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using="demo_order::integer",
    )
    op.drop_column("users", "gender")
    op.drop_column("users", "phone")
    op.drop_column("users", "radius_km")
    op.drop_column("users", "home")
    op.drop_column("users", "readiness")
    op.drop_column("users", "levels")
    op.drop_column("users", "interests")
    op.drop_column("users", "about")
    op.drop_column("users", "district_id")
    op.drop_column("users", "city")
    op.drop_column("users", "age")
    op.drop_column("users", "avatar_url")
    op.drop_table("urgent_calls")
    op.drop_table("share_links")
    op.drop_index(op.f("ix_participations_user_id"), table_name="participations")
    op.drop_index(op.f("ix_participations_event_id"), table_name="participations")
    op.drop_table("participations")
    op.drop_index(op.f("ix_messages_event_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_invites_event_id"), table_name="invites")
    op.drop_table("invites")
    op.drop_table("invite_grants")
    op.drop_table("held_votes")
    op.drop_table("gear_pledges")
    op.drop_index(op.f("ix_gear_lines_event_id"), table_name="gear_lines")
    op.drop_table("gear_lines")
    op.drop_table("first_visits")
    op.drop_table("favorites")
    op.drop_index(op.f("ix_event_teams_event_id"), table_name="event_teams")
    op.drop_table("event_teams")
    op.drop_table("event_programs")
    op.drop_table("event_greeters")
    op.drop_index(op.f("ix_events_status"), table_name="events")
    op.drop_index(op.f("ix_events_starts_at"), table_name="events")
    op.drop_index(op.f("ix_events_sport_id"), table_name="events")
    op.drop_index("ix_events_organizer_kind_organizer_id", table_name="events")
    op.drop_table("events")
    op.drop_index(op.f("ix_venues_org_id"), table_name="venues")
    op.drop_table("venues")
    op.drop_table("support_needs")
    op.drop_table("org_managers")
    op.drop_table("companions")
    op.drop_table("sports")
    op.drop_table("saved_searches")
    op.drop_index(op.f("ix_organizations_status"), table_name="organizations")
    op.drop_index(op.f("ix_organizations_owner_id"), table_name="organizations")
    op.drop_table("organizations")
    op.drop_index(op.f("ix_notifications_user_id"), table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(op.f("ix_mcp_tokens_hash"), table_name="mcp_tokens")
    op.drop_table("mcp_tokens")
    op.drop_table("follows")
    op.drop_table("imported_posts")
    op.drop_table("sport_categories")
    op.drop_table("shelf_items")
    op.drop_table("sent_reminders")
    op.drop_table("reports")
    op.drop_table("platform_rules")
    op.drop_table("mcp_calls")
    op.drop_table("match_notified")
    op.drop_table("idempotency_keys")
    op.drop_table("held_asked")
    op.drop_index(op.f("ix_gear_loans_item_id"), table_name="gear_loans")
    op.drop_table("gear_loans")
    op.drop_table("districts")
    op.drop_table("demo_state")
    op.drop_table("demand_signals")
    op.drop_table("demand_offers")
    op.drop_index(op.f("ix_demand_log_at"), table_name="demand_log")
    op.drop_table("demand_log")
    op.drop_table("community_sources")
    op.drop_index(op.f("ix_audit_log_action"), table_name="audit_log")
    op.drop_table("audit_log")
