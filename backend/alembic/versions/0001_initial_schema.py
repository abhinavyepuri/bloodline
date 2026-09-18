"""Baseline schema: every table as defined by the current models.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-18

This baseline is built from ``Base.metadata`` rather than from a hand-written
``op.create_table`` list. That is deliberate: the models are the single source of truth
today, and transcribing ~8 tables and their PostGIS geography columns by hand would
guarantee drift. Because the result is byte-for-byte the schema the models describe,
the next ``alembic revision --autogenerate`` produces a correct, empty diff and every
revision after this one is a normal, reviewable migration.

``downgrade`` drops the same tables, so ``alembic downgrade base`` returns an empty
database.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _metadata():
    # Imported lazily so the module can be read by Alembic before the app package is
    # on the path during offline SQL generation.
    from app.core.database import Base
    from app.models import (  # noqa: F401
        allocation,
        audit,
        blood_bank,
        donor,
        hospital,
        inventory,
        request,
        user,
    )

    return Base.metadata


def upgrade() -> None:
    # PostGIS must exist before the geography columns are created. Ignored when the
    # role is not permitted to install extensions and PostGIS is already present.
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    _metadata().create_all(bind=op.get_bind())


def downgrade() -> None:
    _metadata().drop_all(bind=op.get_bind())
