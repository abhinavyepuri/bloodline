"""Add code column to blood_requests

Revision ID: 0002_add_request_code
Revises: 0001_initial_schema
Create Date: 2026-09-18
"""

from typing import Sequence, Union
import random
from alembic import op
import sqlalchemy as sa


revision: str = "0002_add_request_code"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add column as nullable first
    op.add_column(
        "blood_requests",
        sa.Column("code", sa.String(length=16), nullable=True)
    )

    # 2. Backfill any existing records with unique codes
    conn = op.get_bind()
    requests = conn.execute(sa.text("SELECT id FROM blood_requests WHERE code IS NULL")).fetchall()
    used_numbers = set()
    for row in requests:
        req_id = row[0]
        while True:
            num = random.randint(1000, 9999)
            if num not in used_numbers:
                used_numbers.add(num)
                break
        code = f"REQ-{num}"
        conn.execute(
            sa.text("UPDATE blood_requests SET code = :code WHERE id = :id"),
            {"code": code, "id": req_id}
        )

    # 3. Create unique index
    op.create_index(
        op.f("ix_blood_requests_code"),
        "blood_requests",
        ["code"],
        unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_blood_requests_code"), table_name="blood_requests")
    op.drop_column("blood_requests", "code")
