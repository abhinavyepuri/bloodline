"""Enterprise spatial and partial indexes for high-throughput scaling.

Revision ID: 0003_enterprise_indexes
Revises: 0002_add_request_code
Create Date: 2026-09-18
"""

from typing import Sequence, Union
from alembic import op

revision: str = "0003_enterprise_indexes"
down_revision: Union[str, None] = "0002_add_request_code"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # High-speed GiST spatial indexes for ST_DWithin and ST_Distance radius searches
    op.execute("CREATE INDEX IF NOT EXISTS idx_donors_location_gist ON donors USING GIST (location);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_blood_banks_location_gist ON blood_banks USING GIST (location);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_hospitals_location_gist ON hospitals USING GIST (location);")

    # Filtered partial index for active available shelf stock (ignores expired/quarantined)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_inventory_active_search "
        "ON inventory_units (blood_group, component_type, expiry_date) "
        "WHERE status = 'AVAILABLE';"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_inventory_active_search;")
    op.execute("DROP INDEX IF EXISTS idx_hospitals_location_gist;")
    op.execute("DROP INDEX IF EXISTS idx_blood_banks_location_gist;")
    op.execute("DROP INDEX IF EXISTS idx_donors_location_gist;")
