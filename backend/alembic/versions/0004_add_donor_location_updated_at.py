"""Add donor location_updated_at column and index for freshness tracking.

Revision ID: 0004_add_donor_location_updated_at
Revises: 0003_enterprise_indexes
Create Date: 2026-09-19
"""

from typing import Sequence, Union
from alembic import op

revision: str = "0004_donor_location_freshness"
down_revision: Union[str, None] = "0003_enterprise_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add column location_updated_at (idempotent)
    op.execute(
        "ALTER TABLE donors ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP WITH TIME ZONE;"
    )

    # 2. Backfill existing donors with non-null location
    op.execute(
        "UPDATE donors SET location_updated_at = updated_at WHERE location IS NOT NULL;"
    )

    # 3. Create index for fast filtered proximity and freshness scans
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_donors_location_freshness "
        "ON donors (is_available, location_updated_at);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_donors_location_freshness;")
    op.drop_column("donors", "location_updated_at")
