"""Справочники в админке: города, скрытые направления, разделы и правила, пример к правилу.

Города переезжают из кода в таблицу `cities`; миграция заполняет её тремя городами, которые
были встроены в код (граница — круг радиуса `radius_km` вокруг центра).

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CITIES = [
    ("bryansk", "Брянск", "Брянске", "Брянская область", "Europe/Moscow", 53.2436, 34.3634, 35, False, 1),
    (
        "krasnoyarsk",
        "Красноярск",
        "Красноярске",
        "Красноярский край",
        "Asia/Krasnoyarsk",
        56.0106,
        92.8526,
        35,
        True,
        2,
    ),
    (
        "moscow",
        "Москва",
        "Москве",
        "Город федерального значения",
        "Europe/Moscow",
        55.7558,
        37.6173,
        45,
        False,
        3,
    ),
]


def upgrade() -> None:
    cities = op.create_table(
        "cities",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_in", sa.Text(), nullable=True),
        sa.Column("region", sa.Text(), nullable=True),
        sa.Column("time_zone", sa.Text(), nullable=False),
        sa.Column("center", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("radius_km", sa.Double(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("hidden", sa.Boolean(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("ord", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cities")),
    )
    op.bulk_insert(
        cities,
        [
            {
                "id": id_,
                "name": name,
                "name_in": name_in,
                "region": region,
                "time_zone": zone,
                "center": {"lat": lat, "lng": lng},
                "radius_km": radius,
                "is_default": default,
                "hidden": False,
                "sort_order": order,
                "ord": i * 1024,
            }
            for i, (id_, name, name_in, region, zone, lat, lng, radius, default, order) in enumerate(_CITIES)
        ],
    )
    op.add_column("sports", sa.Column("hidden", sa.Boolean(), nullable=True))
    op.add_column("sport_categories", sa.Column("hidden", sa.Boolean(), nullable=True))
    op.add_column("platform_rules", sa.Column("example", sa.Text(), nullable=True))
    op.add_column("platform_rules", sa.Column("hidden", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_rules", "hidden")
    op.drop_column("platform_rules", "example")
    op.drop_column("sport_categories", "hidden")
    op.drop_column("sports", "hidden")
    op.drop_table("cities")
