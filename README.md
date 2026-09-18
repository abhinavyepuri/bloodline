# SmartBlood (Yarin) — Real-Time Emergency Blood & Donor Network

A real-time emergency blood coordination and voluntary donor dispatch platform connecting
hospitals, blood banks, and verified voluntary donors with geospatial proximity geofencing,
first-expiring-first-out (FEFO) cold-chain allocation, atomic multi-unit slot claims via Redis Lua scripts,
a resilient two-tier background worker engine, and automated self-healing re-planning.

---

## 🏗️ Architecture & Real-Time Flow

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                React 19 Web App (Vite + TS)                 │
       │   Hospital Intake | Blood Bank Stock | Donor Dispatch       │
       │                 Coordinator Live Queue                      │
       └──────────────────────────────┬──────────────────────────────┘
                                      │ HTTPS / WSS  (Bearer JWT)
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                       FASTAPI BACKEND                       │
       │   API Gateway + Idempotency + Rate Limiting + Tracing       │
       └──────┬───────────────────────┬───────────────────────┬──────┘
              │                       │                       │
              ▼                       ▼                       ▼
        Auth & RBAC            Request Service          Donor Service
       (JWT + Depends)       (Triage & Urgency)     (Proximity Geofence &
              │                       │              Telemetry Streaming)
              ├───────────────────────┼───────────────────────┤
              ▼                       ▼                       ▼
        Matching Matrix       Allocation Engine       Inventory Service
       (ABO/Rh Blood/Plasma)  (FEFO + Lua Claims)   (Cold-Chain + Sweeper)
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      ▼
                           PostgreSQL 16 + PostGIS
                     (GiST Indexes + Partial Shelf Index)
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
          Redis 7.2                                  WebSocket Manager
   (Atomic Lua script,                              (Redis Pub/Sub Backplane
    Soft alert zones,                                smartblood:ws:events)
    Task Queue + DLQ)                                         │
              │                                               ▼
              ▼                                     Horizontal Multi-Worker
    Background Worker Engine                                Fanout
     (python -m app.worker)
   - Push notification queue
   - Keyspace expiry timeout listener
   - T-24h near-expiry sweeper
```

---

## 🚀 Quickstart Guide: How to Run the Project

### 1. Prerequisites
- **Docker & Docker Compose** (for PostgreSQL + PostGIS & Redis)
- **Python 3.12+** (Python 3.13 supported)
- **Node.js 18+** & **npm**

---

### 2. Step-by-Step Setup

#### Step 1: Start Database and Redis Containers
From the project root:
```bash
docker compose up -d db redis
```
*Containers started:*
- `smartblood_postgres` on port `5432` (PostgreSQL 16 with PostGIS 3.4)
- `smartblood_redis` on port `6379` (Redis 7.2)

---

#### Step 2: Setup and Start Backend (FastAPI)
Open a terminal in `backend/`:
```bash
cd backend

# 1. Create Python virtual environment (if not already created)
python -m venv venv

# 2. Activate virtual environment
# On Windows PowerShell:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Apply database migrations (Alembic: 0001, 0002, 0003)
python -m app.init_db

# 5. Seed Synthetic Demo Data (Section 14 Scenario)
python -m app.seed

# 6. Start the FastAPI API server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
*Backend endpoints:*
- REST API: `http://localhost:8000/api/v1`
- Swagger Documentation: `http://localhost:8000/api/v1/docs`
- Real-Time WebSocket: `ws://localhost:8000/api/v1/realtime/ws?token=<jwt>`
- Health Check: `http://localhost:8000/health`
- Clinical SLA Metrics: `http://localhost:8000/api/v1/admin/metrics`

> The WebSocket requires a valid JWT in the `token` query parameter. An anonymous socket
> is sent an `AUTH_ERROR` frame and then closed with policy code **1008**.

---

#### Step 3: Start the Standalone Background Worker Daemon
Open a separate terminal in `backend/`:
```bash
cd backend
.\venv\Scripts\activate
python -m app.worker
```
*Worker tasks:*
- Consumes push notifications from Redis queue (`queue:notifications:push`).
- Listens to Redis keyspace expirations (`__keyevent@0__:expired`) to trigger 180s geofence timeouts automatically.
- Runs scheduled shelf-life sweeps alerting for blood units expiring within 24 hours.

---

#### Step 4: Setup and Start Frontend (React + Vite)
Open a third terminal in `frontend/`:
```bash
cd frontend

# 1. Install npm dependencies
npm install

# 2. Point the app at your backend (defaults to http://127.0.0.1:8000)
cp .env.example .env

# 3. Start the Vite development server
npm run dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** and sign in with any account
from the table below.

---

## 👥 Pre-Configured Demo Accounts

All accounts use the password: `password123`

| Role | Email | Profile / Scenario Details |
| :--- | :--- | :--- |
| **ADMIN** | `admin@smartblood.org` | System Administrator (metrics, audits, dev resets) |
| **COORDINATOR** | `coordinator@smartblood.org` | Emergency Operations Center (city-wide queue & overrides) |
| **HOSPITAL** | `hospital@smartblood.org` | Metro General Hospital (emergency intake & live tracking) |
| **HOSPITAL** | `stjude@smartblood.org` | St. Jude Trauma Center (secondary tenant for isolation) |
| **BLOOD_BANK** | `bloodbank@smartblood.org` | Metro Blood Services (cold-chain stock units `BB-001`…`BB-004`) |
| **DONOR (D1)** | `alice@donor.org` | O− donor, ~1.9 km away, reliability 98% |
| **DONOR (D2)** | `bob@donor.org` | O− donor, ~3.6 km away, reliability 92% |
| **DONOR (D3)** | `charlie@donor.org` | A+ donor (verifies biological matrix filtering for O− recipient) |

> 💡 **Tip:** In a development build (`npm run dev`), the header carries instant
> **SWITCH VIEW** pills to sign in as each demo role with one click.

---

## ⚡ Enterprise Features Implemented

1. **Sub-Millisecond Atomic Lua Claiming (`LUA_CLAIM_SLOT`)**:
   - Single-round-trip atomic compare-and-swap over $0 \dots N-1$ unit slots in Redis.
   - Eliminates network latency and guarantees zero double-claim race conditions under heavy concurrent mobile responses.
2. **Horizontal Redis Pub/Sub WebSocket Backplane**:
   - WebSockets publish and subscribe across `smartblood:ws:events`, allowing zero-drop real-time broadcasting across multiple Uvicorn worker instances.
3. **Spatial GiST & Partial Shelf Stock Indexing**:
   - PostGIS GiST spatial indexing on `donors`, `blood_banks`, and `hospitals` tables for sub-5ms `ST_DWithin` proximity queries.
   - Partial composite index `idx_inventory_active_search` on `inventory_units WHERE status = 'AVAILABLE'` for instant FEFO queries.
4. **Resilient Background Worker Engine (`app.worker`)**:
   - Multi-queue worker daemon handling retries, Dead-Letter Queues (DLQ), keyspace expiration timeout triggers, and near-expiry sweeps.
5. **Mobile Protection & GPS Telemetry**:
   - `Idempotency-Key` response caching header preventing duplicate transactions on network loss.
   - Sliding-window Redis rate limiter protecting authentication and emergency dispatch routes.
   - Live GPS telemetry stream (`POST /api/v1/donors/me/telemetry`) tracking donor transit and broadcasting `DONOR_APPROACHING_WARD` when entering 500m of the hospital trauma center.
6. **Clinical SLA Metrics**:
   - Dedicated endpoint `GET /api/v1/admin/metrics` reporting Mean Time to Sourcing (MTTS), donor conversion rate, and replanning frequency.
7. **Security Audit**:
   - Bandit security audit completed across 5,364 lines of Python backend code with **0 High, 0 Medium** vulnerabilities.

---

## 📚 Further Reading

- [`STATUS.md`](STATUS.md) — Implemented features, verification checklist, domain enums, and operational state.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Comprehensive technical architecture, two-tier worker specifications, and component designs.
- [`structure.md`](structure.md) — Detailed route flows, sequence diagrams, and mathematical scoring formulas.
- [`backend/alembic/`](backend/alembic/) — Version-controlled database schema migrations.
