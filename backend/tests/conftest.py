"""
Shared test fixtures.

These are integration tests: they talk to the real PostgreSQL/PostGIS and Redis from
``docker compose``. Without those services running the suite fails loudly rather than
silently skipping, because the allocation engine's correctness depends on both.

The HTTP fixtures deliberately do **not** run the app's lifespan. ``ASGITransport`` skips
it, so tests are not affected by the startup inventory sweep or by
``Base.metadata.create_all`` racing the assertions.
"""

from typing import AsyncGenerator, Dict

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core import database
from app.core import redis as redis_module
from app.core.config import settings

# --------------------------------------------------------------------------------------
# Loop-safety bootstrap
# --------------------------------------------------------------------------------------
# pytest-asyncio hands each test its own event loop, and both asyncpg and redis-py bind a
# connection to the loop that opened it. A connection created by test A and then checked
# out of the pool by test B raises "attached to a different loop" — so the pooled engine
# is replaced with one that opens and closes a connection per session, and the cached
# Redis client is dropped between tests. Both changes are confined to this process; the
# application's own pooled engine is untouched.
TEST_ENGINE = create_async_engine(
    settings.DATABASE_URL,
    # DEBUG defaults on, which makes SQLAlchemy echo every statement and buries the
    # pytest output.
    echo=False,
    future=True,
    poolclass=NullPool,
)

# Mutated in place rather than rebound, because ``app.seed`` and others capture the
# sessionmaker with a ``from ... import`` and would otherwise keep the pooled engine.
database.AsyncSessionLocal.configure(bind=TEST_ENGINE)


from app.main import app  # noqa: E402  (must follow the engine swap above)

# Seeded accounts (see app/seed.py). All share the same demo password.
DEMO_PASSWORD = "password123"
DEMO_ACCOUNTS: Dict[str, str] = {
    "HOSPITAL": "hospital@smartblood.org",
    "BLOOD_BANK": "bloodbank@smartblood.org",
    "DONOR": "alice@donor.org",
    "COORDINATOR": "coordinator@smartblood.org",
    "ADMIN": "admin@smartblood.org",
}


@pytest.fixture(autouse=True)
def isolated_redis_client():
    """
    Give every test its own Redis client.

    ``get_redis`` caches one client per process, and its connection pool belongs to the
    loop that created it. Clearing the cache means each test builds a client on its own
    loop. The previous client is dropped rather than closed, because closing it would
    mean awaiting on a loop that has already finished.
    """
    redis_module.redis_client = None
    yield
    redis_module.redis_client = None


@pytest_asyncio.fixture
async def schema() -> AsyncGenerator[None, None]:
    """Ensure the tables exist before a test touches the database."""
    async with TEST_ENGINE.begin() as conn:
        await conn.run_sync(database.Base.metadata.create_all)
    yield


@pytest_asyncio.fixture
async def seeded(schema: None) -> AsyncGenerator[None, None]:
    """
    Reset the database to the documented Section 14 scenario.

    Every test that asserts on coverage or inventory has to start from a known stock
    level: the allocation engine consumes units, so without this the second test in a
    run would see a partially drained blood bank.
    """
    from app.seed import seed_data

    await seed_data()
    yield


@pytest_asyncio.fixture
async def db(schema: None) -> AsyncGenerator[AsyncSession, None]:
    """A session bound to the configured database."""
    async with database.AsyncSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client(schema: None) -> AsyncGenerator[AsyncClient, None]:
    """An HTTP client speaking to the ASGI app in-process (no live server needed)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://testserver",
        headers={"X-Testing": "true"}
    ) as ac:
        yield ac



async def login(client: AsyncClient, role: str) -> str:
    """Sign in as one of the seeded demo accounts and return its access token."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": DEMO_ACCOUNTS[role], "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def hospital_token(client: AsyncClient, seeded: None) -> str:
    return await login(client, "HOSPITAL")


@pytest_asyncio.fixture
async def blood_bank_token(client: AsyncClient, seeded: None) -> str:
    return await login(client, "BLOOD_BANK")


@pytest_asyncio.fixture
async def coordinator_token(client: AsyncClient, seeded: None) -> str:
    return await login(client, "COORDINATOR")


@pytest_asyncio.fixture
async def donor_token(client: AsyncClient, seeded: None) -> str:
    return await login(client, "DONOR")


@pytest_asyncio.fixture
async def admin_token(client: AsyncClient, seeded: None) -> str:
    return await login(client, "ADMIN")


@pytest.fixture
def demo_password() -> str:
    return DEMO_PASSWORD

