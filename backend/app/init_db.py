"""
Initialise the database schema.

Runs the Alembic migration chain instead of ``Base.metadata.create_all``, so a schema
change is an explicit, versioned revision that reaches existing databases rather than an
implicit side effect of importing the models. ``alembic upgrade head`` is idempotent.

Usage:
    python -m app.init_db
"""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_ROOT = Path(__file__).resolve().parent.parent

logger = logging.getLogger("init_db")


def build_alembic_config() -> Config:
    """Alembic config rooted at the backend directory, independent of the CWD."""
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def run_migrations(revision: str = "head") -> None:
    """Bring the database up to the given revision (default: latest)."""
    logger.info("Applying database migrations up to %s...", revision)
    command.upgrade(build_alembic_config(), revision)
    logger.info("Database schema is up to date.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_migrations()
