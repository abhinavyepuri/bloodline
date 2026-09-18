# SmartBlood (Yarin) — Real-Time Emergency Blood & Donor Network

A real-time emergency blood coordination and voluntary donor dispatch platform connecting
hospitals, blood banks, and verified voluntary donors with geospatial proximity geofencing,
first-expiring-first-out (FEFO) cold-chain allocation, per-unit atomic claims, and
automated re-planning when a resource falls through.

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
       │        API v1 Gateway + Authenticated WebSocket Bus         │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
   Auth & RBAC                 Request Service               Donor Service
  (JWT + Depends)          (Triage & Urgency)          (Proximity Geofence +
         │                            │                   eligibility policy)
         ├────────────────────────────┼────────────────────────────┤
         ▼                            ▼                            ▼
   Matching Matrix            Allocation Engine            Inventory Service
  (ABO/Rh Blood/Plasma)   (FEFO + per-unit claims)     (Cold-Chain + expiry sweep)
         │                            │                            │
         └─────────────────────┬──────┴────────────────────────────┘
                               ▼
                    PostgreSQL 16 + PostGIS
                 (Spatial Queries: ST_DWithin)
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
            Redis 7.2                  WebSocket Manager
    (Alert zones + unit slots)     (Channel-targeted push bus)
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
- `smartblood_postgres` on port `5432`
- `smartblood_redis` on port `6379`

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

# 4. Apply database migrations (Alembic; idempotent)
python -m app.init_db

# 5. Seed Synthetic Demo Data (Section 14 Scenario)
python -m app.seed

# 6. Start the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
*Backend endpoints:*
- REST API: `http://localhost:8000/api/v1`
- Swagger Documentation: `http://localhost:8000/api/v1/docs`
- Real-Time WebSocket: `ws://localhost:8000/api/v1/realtime/ws?token=<jwt>`
- Health Check: `http://localhost:8000/health`

> The WebSocket requires a valid JWT in the `token` query parameter. An anonymous socket
> is sent an `AUTH_ERROR` frame and then closed with policy code **1008**.

---

#### Step 3: Setup and Start Frontend (React + Vite)
Open a second terminal in `frontend/`:
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
| **Admin** | `admin@smartblood.org` | System Administrator (network overview, dev-only reset) |
| **Hospital** | `hospital@smartblood.org` | Metro General Hospital (emergency intake & live tracking) |
| **Hospital** | `stjude@smartblood.org` | St. Jude Emergency Center (second tenant, for isolation testing) |
| **Blood Bank** | `bloodbank@smartblood.org` | Metro Blood Services (stock units `BB-001`…`BB-004`) |
| **Donor (D1)** | `alice@donor.org` | O− donor, ~1.9 km away, reliability 98% |
| **Donor (D2)** | `bob@donor.org` | O− donor, ~3.6 km away, reliability 92% |
| **Donor (D3)** | `charlie@donor.org` | A+ donor (incompatible with an O− recipient — proves matrix filtering) |
| **Coordinator** | `coordinator@smartblood.org` | Emergency Operations Center (city-wide queue & demo controller) |

> 💡 **Tip:** In a development build (`npm run dev`) the header also carries instant
> **SWITCH VIEW** pills that sign in as each demo role with one click. They are stripped
> from production builds — the sign-in form is the only way in there.

---

## 🧪 Testing & Verification

Both suites are integration tests: they talk to the real PostgreSQL/PostGIS and Redis from
`docker compose`, so start those containers first.

### Run the backend test suite (pytest)
```bash
cd backend
.\venv\Scripts\python.exe -m pytest -v tests/
```
*Covers the ABO/Rh compatibility matrices, urgency and proximity scoring, per-unit slot
claiming, partial-fill honesty, re-planning after a quarantine, expiry sweeping, the
donation recovery window, and route-level authorisation for every role.*

### Run the end-to-end Section 14 smoke check
With the backend already running (`uvicorn app.main:app --reload`):
```bash
cd backend
.\venv\Scripts\python.exe verify_demo.py
```
*Walks the full lifecycle over real HTTP — 2-unit O− request reserved from inventory, a
second request falling through to donor alerting, unit `BB-001` quarantined and re-planned,
donor D1 claiming the freed slot, fulfilment, the audit trail, and cross-tenant isolation.
It asserts each expectation and exits non-zero if any does not hold.*

---

## 🎬 How to Run the Live Interactive Demo

1. Open **[http://localhost:5173/](http://localhost:5173/)** and sign in as
   `coordinator@smartblood.org`.
2. In the **Coordinator Ops** view, locate the **Section 14 End-to-End Synthetic Demo
   Controller** at the top.
3. Click **`▶ Run Full Section 14 Flow`** to watch the automated sequence execute with
   live commentary and real coverage reporting.
4. Watch the reactions across the live queue, the donor alert feed, and the event
   telemetry ticker.

---

## 📚 Further Reading

- [`STATUS.md`](STATUS.md) — what is implemented, the real domain enum values, known gaps,
  and the exact commands to verify the build.
- [`backend/alembic/`](backend/alembic/) — the versioned schema history.
