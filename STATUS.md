# SmartBlood (Yarin) — Project Status

**Last Updated:** September 19, 2026  
**Current Phase:** Real-Time Routing, Android Integration, Donor Location Freshness TTL & Background Heartbeats Complete  

> **System Status Summary:**  
> The backend is fully refactored, hardened, and running on Dockerized PostgreSQL 16 + PostGIS 3.4 and Redis 7.2. All high-latency tasks have been offloaded to a two-tier background processing architecture (FastAPI `BackgroundTasks` + standalone `app.worker` daemon). Concurrency locking operates via single-round-trip atomic Lua scripts, WebSockets scale horizontally across workers via Redis Pub/Sub, and database queries are accelerated with PostGIS GiST spatial and partial active inventory indexes. Real-time hospital-to-blood-bank order visibility, dynamic alert-zone enrollment, and full Android mobile integration are verified. Stale GPS issues are eliminated via a 60-minute Location Freshness TTL engine and Android `WorkManager` background heartbeats. Security audits (Bandit) report **0 High, 0 Medium** vulnerabilities.

---

## 1. Project Overview

SmartBlood (Yarin) is an intelligent, real-time emergency blood allocation and voluntary donor dispatch platform. It bridges hospitals, blood banks, and voluntary donors with geospatial proximity matching, automated compatibility checks, distributed concurrency locks, background task workers, and live WebSocket updates.

---

## 2. Technology Stack & Infrastructure

| Layer | Technology | Status / Details |
| :--- | :--- | :--- |
| **Backend Framework** | FastAPI, Python 3.11/3.12 (async/await), Pydantic v2 | Fully operational; 29 versioned REST endpoints |
| **Database & GIS** | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) | Running in Docker container `smartblood_postgres` on port `5432` |
| **Cache & Concurrency** | Redis 7.2 (`redis:7.2-alpine`) via `redis.asyncio` | Running in Docker container `smartblood_redis` on port `6379` |
| **Background Worker Engine** | Standalone Python process (`app.worker`) | Consumes push notification queues, DLQ, keyspace expirations, and expiry sweeps |
| **ORM & Migrations** | SQLAlchemy 2.0 (async), GeoAlchemy2, Alembic | 4 migrations applied (`0001`, `0002`, `0003`, `0004`) |
| **Spatial Indexing** | PostGIS GiST Indexes | Applied on `donors`, `blood_banks`, and `hospitals` locations |
| **Query Optimization** | Filtered Partial B-Tree Indexes | `idx_inventory_active_search` (shelf stock) & `idx_donors_location_freshness` (active donors) |
| **Authentication & RBAC** | OAuth2 + JWT (python-jose), Passlib (bcrypt) | Stateless tokens with role-based endpoint guards |
| **Real-Time Bus** | WebSockets + Redis Pub/Sub backplane | Multi-worker horizontal broadcast over `smartblood:ws:events` |
| **Reliability & Security** | Idempotency, Rate Limiting, Request ID tracing | Sliding-window limiter, `Idempotency-Key` caching, correlation IDs |
| **Frontend** | React 19 + TypeScript + Vite 8, `lucide-react`, oxlint | 5 role-specific dashboards with dynamic LAN host resolution |
| **Mobile Client** | Native Android (Kotlin + Jetpack Compose + WorkManager) | Emergency dispatch intake, 1-tap responses, periodic location heartbeats, GPS telemetry |

---

## 3. Domain Enumerations

The code enforces strict, typed domain models across all layers:

| Enum | Active Values |
| :--- | :--- |
| `UserRole` | `HOSPITAL`, `BLOOD_BANK`, `DONOR`, `COORDINATOR`, `ADMIN` |
| `TriageLevel` | `MASSIVE_TRANSFUSION_PROTOCOL`, `ACTIVE_TRAUMA`, `SCHEDULED_EMERGENCY_RESERVE`, `ROUTINE_CLINICAL` |
| `RequestStatus` | `PENDING_EVALUATION`, `PROXIMITY_ZONE_NOTIFIED`, `COMMITTED_IN_TRANSIT`, `RE_PLANNING`, `FULFILLED`, `CANCELLED`, `EXPIRED` |
| `UnitStatus` | `AVAILABLE`, `LOCKED_RESERVE`, `DISPATCHED`, `TRANSFUSED`, `EXPIRED`, `QUARANTINED` |
| `AllocationStatus` | `SOFT_LOCKED`, `HARD_LOCKED`, `IN_TRANSIT`, `COMPLETED`, `CANCELLED_BY_DONOR`, `TIMED_OUT`, `RE_OPTIMIZED` |
| `BloodComponentType` | `WHOLE_BLOOD`, `PRBC`, `PLATELETS`, `FFP`, `CRYOPRECIPITATE` |

**Single Source of Coverage Truth:**  
`COVERING_ALLOCATION_STATUSES` in `app/models/allocation.py` (`HARD_LOCKED`, `IN_TRANSIT`, `COMPLETED`) is the canonical definition of secured units. Both `AllocationService` and `BloodRequest` properties (`units_covered`, `units_shortfall`) read from this tuple.

---

## 4. Implemented Features & Architecture State

### Database & Spatial Migrations (`backend/alembic/versions/`)
- [x] `0001_initial_schema.py`: Tables for users, hospitals, blood banks, donors, inventory units, blood requests, allocations, and audit logs with PostGIS `Geography(POINT, 4326)`.
- [x] `0002_add_request_code.py`: Indexed 8-character human-readable short code (e.g., `REQ-8492`) for emergency calls and 1-tap mobile dispatches.
- [x] `0003_enterprise_indexes.py`: 
  - GiST spatial indexes on `donors.location`, `blood_banks.location`, and `hospitals.location` for sub-5ms `ST_DWithin` geofence evaluations.
  - Partial composite index `idx_inventory_active_search` on `inventory_units (blood_group, component_type, expiry_date) WHERE status = 'AVAILABLE'` eliminating full table scans during FEFO matching.
- [x] `0004_add_donor_location_updated_at.py`:
  - Added `location_updated_at` (timestamp with time zone) to `donors`.
  - Filtered composite index `idx_donors_location_freshness` on `donors (is_available, location_updated_at)`.

### Real-Time Hospital-to-Blood-Bank Routing & Order Visibility
- [x] **Hospital Request Visibility on Blood Bank Desk**: Fixed `selectinload` join and query filtering on `/api/v1/inventory/orders` so that when a hospital creates an emergency request, reserved inventory batches appear in real-time on the Blood Bank dispatch queue.
- [x] **Dynamic Alert-Zone Enrollment**: Updated `/api/v1/donors/requests/active` to auto-enroll active compatible donors into the Redis alert zone even if they joined after initial broadcast.
- [x] **Cross-Platform LAN Resolution**: Configured dynamic host resolution in Vite frontend and Android `ApiClient` allowing physical smartphones and laptops on the same Wi-Fi network to seamlessly communicate with the local backend.

### Donor Location Freshness Engine & Periodic Background Heartbeats
- [x] **Location Freshness TTL (`DONOR_LOCATION_TTL_MINUTES = 60`)**: Prevents stale coordinates (e.g., donor who moved from 3km to 10km away hours ago) from receiving false proximity emergency dispatches.
- [x] **Two-Stage Prioritization in Geofencing**: Proximity searches prioritize donors with verified fresh locations ($\le 60$ minutes). If zero fresh donors exist in the area, resilient fallback alerts eligible donors in the expanded geofence.
- [x] **Android `WorkManager` Heartbeats (`LocationHeartbeatWorker`)**: Mobile client runs a battery-efficient background heartbeat every 15 minutes, pinging `POST /api/v1/donors/me/heartbeat` with fresh GPS coordinates while the donor is `is_available = true`. Automatically stops on logout or standby.

### Distributed Concurrency & Locking (`app/core/redis.py`)
- [x] **Atomic Lua Multi-Slot Claiming**: Replaced iterative Python slot claims with `LUA_CLAIM_SLOT` script. Evaluates $0 \dots N-1$ keys and executes `SET NX EX` in a single atomic $O(1)$ round-trip.
- [x] **Soft-Lock Alert Zone**: Enumerable Redis SET (`lock:soft:req:{id}:donors`) with configurable TTL (180s) tracking candidate donors for targeted stand-down notifications.
- [x] **Safe Rollback**: Immediate slot release on database commit failure to prevent lock leakage.

### Real-Time Pub/Sub WebSockets (`app/websocket/connection_manager.py`)
- [x] **Horizontal Redis Backplane**: Connection manager publishes events to Redis channel `smartblood:ws:events`.
- [x] **Multi-Worker Synchronization**: Background listener subscribes to the Redis bus and distributes frames to locally connected WebSockets, ensuring seamless broadcast across multiple Uvicorn workers.
- [x] **Thread-Safe Mobile Ingestion**: Android WebSocket client dispatches UI transitions on `runOnUiThread`, eliminating background-thread navigation crashes.

### Two-Tier Background Processing & Worker Daemon (`app/worker.py`)
- [x] **Tier 1 (In-Process FastAPI `BackgroundTasks`)**: Offloads non-critical writes (audit logging, non-blocking notification dispatch) directly in the HTTP lifecycle.
- [x] **Tier 2 (Dedicated Daemon Process `python -m app.worker`)**:
  - Consumes reliable Redis notification queue (`queue:notifications:push`).
  - Dead-Letter Queue (`queue:notifications:dlq`) with exponential retry tracking.
  - Redis keyspace event listener (`__keyevent@0__:expired`) detecting 180s soft-lock expirations and triggering immediate `handle_allocation_timeout`.
  - Near-expiry inventory sweeper (`sweep_expiring_inventory`) issuing alerts for units expiring within 24 hours.

### Mobile Reliability, Protection & Telemetry
- [x] **Idempotency Engine (`app/core/idempotency.py`)**: Caches responses against `Idempotency-Key` headers in Redis, preventing duplicate allocations on network drops.
- [x] **Sliding-Window Rate Limiter (`app/core/rate_limit.py`)**: Token/counter sliding window protecting sensitive routes (60 req/min for auth, 30 req/min for emergency responses).
- [x] **Distributed Tracing (`app/core/tracing.py`)**: Automatically propagates or injects correlation IDs via `X-Request-ID`.
- [x] **In-Transit Donor Telemetry (`app/services/tracking_service.py`, `POST /api/v1/donors/me/telemetry`)**: Computes real-time PostGIS distance/ETA for traveling donors and emits `DONOR_APPROACHING_WARD` when entering within 500m of the destination hospital.
- [x] **Clinical SLA Metrics (`GET /api/v1/admin/metrics`)**: Exposes Mean Time to Sourcing (MTTS), donor conversion rate, and replan frequency.

---

## 5. API Endpoints Reference (29 Routes)

| Tag / Area | Method & Route | Description |
| :--- | :--- | :--- |
| **Auth** | `POST /api/v1/auth/register` | Register new user and auto-provision role profile |
| | `POST /api/v1/auth/login` | Authenticate and obtain JWT access token |
| | `GET /api/v1/auth/me` | Fetch active user profile and linked entity |
| **Requests** | `POST /api/v1/requests` | Create emergency blood request with auto-shortcode & urgency score |
| | `GET /api/v1/requests` | List active emergency requests ordered by urgency score |
| | `GET /api/v1/requests/{id}` | Get request detail by UUID or shortcode (e.g., `REQ-8492`) |
| | `PATCH /api/v1/requests/{id}/cancel` | Cancel request and release reserved units/locks |
| | `POST /api/v1/requests/{id}/fulfill` | Mark delivered/fulfilled; transition inventory to `DISPATCHED` |
| **Donors** | `GET /api/v1/donors/me` | Fetch private clinical donor profile |
| | `GET /api/v1/donors` | Staff-only sanitized donor directory (PII-free) |
| | `PATCH /api/v1/donors/availability` | Toggle availability and update GPS coordinates (`location_updated_at`) |
| | `POST /api/v1/donors/me/heartbeat` | **[NEW]** Lightweight periodic background GPS refresh without altering availability |
| | `GET /api/v1/donors/requests/active` | Get emergency requests broadcasting to this donor (with auto-enrollment) |
| | `POST /api/v1/donors/respond` | Contextual 1-tap dispatch response for mobile |
| | `POST /api/v1/donors/requests/{id}/respond` | Targeted dispatch response by UUID or shortcode |
| | `POST /api/v1/donors/me/telemetry` | Stream live GPS coordinates; triggers 500m ward proximity alert |
| **Inventory** | `GET /api/v1/inventory` | List blood bank inventory ordered by FEFO |
| | `POST /api/v1/inventory/units` | Log new verified blood unit into stock |
| | `PATCH /api/v1/inventory/units/{id}/status` | Update unit status (quarantine triggers auto-replan) |
| | `GET /api/v1/inventory/orders` | List incoming hospital dispatch orders |
| | `POST /api/v1/inventory/orders/{request_id}/dispatch` | Confirm unit packaging and courier handover |
| **Hospitals** | `GET /api/v1/hospitals` | Hospital facility directory |
| **Audit** | `GET /api/v1/audit/logs` | Immutable audit trail of allocation decisions |
| | `GET /api/v1/audit/requests/{id}/explanation` | Human-readable allocation explainability report |
| **Admin** | `GET /api/v1/admin/overview` | Network-wide active operational queue |
| | `GET /api/v1/admin/metrics` | Clinical SLA metrics (MTTS, conversion rate, replan rate) |
| | `POST /api/v1/admin/allocations/{id}/override` | Manual coordinator allocation override |
| | `POST /api/v1/admin/reset-demo-data` | Development-only database re-seed |
| **System** | `GET /health` & `GET /api/v1/health` | Service and infrastructure health checks |
| **Real-Time** | `WebSocket /api/v1/realtime/ws` | Authenticated WebSocket stream with Redis backplane |

---

## 6. How to Run the Complete Stack

### Step 1: Start Docker Infrastructure
```bash
docker compose up -d db redis
```
Verify containers are healthy on ports `5432` (PostgreSQL/PostGIS) and `6379` (Redis).

### Step 2: Initialize Database & Seed Demo Data
```bash
cd backend
./venv/Scripts/python.exe -m app.init_db   # Runs alembic upgrade head (includes 0004)
./venv/Scripts/python.exe -m app.seed      # Seeds Section 14 synthetic scenario
```

### Step 3: Start the Backend API Server
```bash
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Step 4: Start the Standalone Background Worker
Open a separate terminal:
```bash
cd backend
./venv/Scripts/python.exe -m app.worker
```

### Step 5: Start the Frontend
Open a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)**.

---

## 7. Demo Accounts

All seeded accounts use password: `password123`

| Role | Email | Purpose / Persona |
| :--- | :--- | :--- |
| `ADMIN` | `admin@smartblood.org` | System Administrator (metrics, audits, resets) |
| `COORDINATOR` | `coordinator@smartblood.org` | Operations Center (city queue, manual overrides) |
| `HOSPITAL` | `hospital@smartblood.org` | Metro General Hospital (intake & tracking) |
| `HOSPITAL` | `stjude@smartblood.org` | St. Jude Trauma Center (secondary tenant) |
| `BLOOD_BANK` | `bloodbank@smartblood.org` | Metro Blood Services (cold-chain stock) |
| `DONOR` | `alice@donor.org` | D1 (O−, 1.9km away, 98% reliability, fresh GPS) |
| `DONOR` | `bob@donor.org` | D2 (O−, 3.6km away, 92% reliability, fresh GPS) |
| `DONOR` | `charlie@donor.org` | D3 (A+, verifies compatibility matrix rejection) |
