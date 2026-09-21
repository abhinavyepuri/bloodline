# Bloodline — FastAPI Backend Service

The core application service and real-time coordination engine for **Bloodline** built with **FastAPI**, **PostgreSQL 16 + PostGIS 3.4**, **Redis 7.2**, and a **Two-Tier Background Worker Engine**.

---

## 🏗️ Architecture & Component Overview

```text
backend/app/
├── main.py                  # FastAPI application entry point, CORS, lifespan, Redis Pub/Sub listener
├── worker.py                # Standalone Tier 2 Background Worker Daemon (Queues, Keyspace, Sweeper)
├── init_db.py               # Database migration runner (alembic upgrade head)
├── seed.py                  # Synthetic scenario demo seeder (Section 14 verification)
├── core/
│   ├── config.py            # Pydantic Settings & environment variable configuration
│   ├── database.py          # SQLAlchemy 2.0 async engine & sessionmaker (expire_on_commit=False)
│   ├── redis.py             # Async Redis client, Lua scripts (LUA_CLAIM_SLOT), soft/hard lock operations
│   ├── security.py          # JWT creation/decoding, bcrypt password hashing
│   ├── deps.py              # RBAC dependency factory require_roles(), entity loaders
│   ├── exceptions.py        # DomainException, AllocationRaceConditionError, DonorIneligibleError
│   ├── idempotency.py       # Idempotency-Key caching header dependency
│   ├── rate_limit.py        # Sliding-window Redis token bucket rate limiter
│   └── tracing.py           # Correlation ID tracking (X-Request-ID) middleware
├── models/                  # SQLAlchemy models with PostGIS Geography(POINT, 4326)
├── repositories/            # Database query layer with row-level locks & ST_DWithin
├── services/
│   ├── matching_service.py  # Biological matrices (RBC/Plasma), urgency formula, proximity decay
│   ├── allocation_service.py# Multi-unit allocation pipeline, Lua slot claims, self-healing re-planner
│   ├── donor_service.py     # Donor eligibility validation, recovery intervals, EMA reliability
│   ├── inventory_service.py # Expiry sweeps, inventory quarantine & re-plan triggers
│   ├── tracking_service.py  # In-transit GPS telemetry, PostGIS ETA, 500m ward proximity alert
│   └── metrics_service.py   # Clinical SLA metrics (MTTS, conversion rate, replan frequency)
├── websocket/
│   └── connection_manager.py# Horizontal WebSocket manager backed by Redis Pub/Sub (smartblood:ws:events)
└── api/v1/                  # 28 REST endpoints partitioned by domain
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Running Docker containers:
  - `smartblood_postgres` on port `5432`
  - `smartblood_redis` on port `6379`
- Python 3.12 or 3.13

### 2. Environment Setup
```bash
# In backend/ directory:
python -m venv venv

# Windows PowerShell:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Initialize Database Migrations
Runs all Alembic revisions (`0001_initial_schema`, `0002_add_request_code`, `0003_enterprise_indexes`):
```bash
python -m app.init_db
```

### 4. Seed Synthetic Demo Data
Seeds hospitals, blood banks, inventory units (`BB-001`…`BB-004`), and donors:
```bash
python -m app.seed
```

### 5. Start the FastAPI Server
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- Interactive Swagger UI: `http://localhost:8000/api/v1/docs`
- Health check: `http://localhost:8000/health`

### 6. Start the Background Worker Daemon
In a separate terminal:
```bash
.\venv\Scripts\activate
python -m app.worker
```
- Consumes push notification queues (`queue:notifications:push` and DLQ).
- Listens to Redis keyspace expirations (`__keyevent@0__:expired`) to trigger 180s geofence timeouts automatically.
- Performs scheduled near-expiry inventory sweeps.

---

## 🛡️ Security & Verification

- **Bandit Security Audit**: Clean report with **0 High, 0 Medium** vulnerabilities across 5,364 LOC:
  ```bash
  bandit -r app -ll
  ```
- **Bytecode Integrity Check**:
  ```bash
  python -m compileall app
  ```
- **Route Authorization**: All routes guarded by JWT Bearer tokens with strict role-based access control (`require_roles()`) and tenant isolation.
