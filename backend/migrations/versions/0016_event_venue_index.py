"""Index event lookups used by venue schedules.

Revision ID: 0016
Revises: 0015
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_venue_id_starts_at ON events (venue_id, starts_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_events_venue_id_starts_at")
