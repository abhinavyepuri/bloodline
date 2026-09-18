# SmartBlood (Yarin) — Project Status

**Last Updated:** September 18, 2026
**Current Phase:** Hardening pass complete; automated verification pending

> **Verification status.** Everything described below is implemented in source. The
> pytest suite, the backend import check, `tsc -b` and `npm run lint` had **not** been
> executed at the time of writing — the environment's command sandbox was unavailable
> for the whole session. Run the commands in §6 before trusting any of it. Where a claim
> here depends on code that has never run, it says so.

---

## 1. Project Overview

SmartBlood (Yarin) is an intelligent, real-time emergency blood allocation and donor
dispatch platform. It bridges hospitals, blood banks, and voluntary donors with
geospatial proximity matching, automated compatibility checks, distributed concurrency
locks, and live WebSocket updates.

---

## 2. Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Backend Framework** | FastAPI, Python 3.13 (async/await), Pydantic v2 |
| **Database & GIS** | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) |
| **Cache & Concurrency** | Redis 7.2 (`redis:7.2-alpine`) via `redis.asyncio` |
| **ORM & Migrations** | SQLAlchemy 2.0 (async), GeoAlchemy2, Alembic |
| **Authentication** | OAuth2 + JWT (python-jose), Passlib (bcrypt) |
| **Real-Time Layer** | WebSockets (native FastAPI connection manager) |
| **Frontend** | React 19 + TypeScript 6 + Vite 8, `lucide-react`, oxlint |
| **Containerization** | Docker Compose |

---

## 3. Domain Enumerations

These are the values the code actually uses. Earlier revisions of this document listed
values (`HOSPITAL_ADMIN`, `BLOOD_BANK_STAFF`, `SYSTEM_ADMIN`, `RESERVED`, `CRITICAL`/
`URGENT`/`ROUTINE`) that exist nowhere in the source.

| Enum | Values |
| :--- | :--- |
| `UserRole` | `HOSPITAL`, `BLOOD_BANK`, `DONOR`, `COORDINATOR`, `ADMIN` |
| `TriageLevel` | `MASSIVE_TRANSFUSION_PROTOCOL`, `ACTIVE_TRAUMA`, `SCHEDULED_EMERGENCY_RESERVE`, `ROUTINE_CLINICAL` |
| `RequestStatus` | `PENDING_EVALUATION`, `PROXIMITY_ZONE_NOTIFIED`, `COMMITTED_IN_TRANSIT`, `RE_PLANNING`, `FULFILLED`, `CANCELLED`, `EXPIRED` |
| `UnitStatus` | `AVAILABLE`, `LOCKED_RESERVE`, `DISPATCHED`, `TRANSFUSED`, `EXPIRED`, `QUARANTINED` |
| `AllocationStatus` | `SOFT_LOCKED`, `HARD_LOCKED`, `IN_TRANSIT`, `COMPLETED`, `CANCELLED_BY_DONOR`, `TIMED_OUT`, `RE_OPTIMIZED` |
| `BloodComponentType` | `WHOLE_BLOOD`, `PRBC`, `PLATELETS`, `FFP`, `CRYOPRECIPITATE` |

`AllocationStatus.SOFT_LOCKED`, `CANCELLED_BY_DONOR` and `TIMED_OUT` are declared but not
currently written by any code path — alert-zone membership lives in Redis rather than in
a row, so there is no soft-locked allocation record to persist.

**Coverage is derived from one place.** `COVERING_ALLOCATION_STATUSES` in
`app/models/allocation.py` (`HARD_LOCKED`, `IN_TRANSIT`, `COMPLETED`) is the single
definition of "this unit is genuinely secured", and both the allocation service and the
`BloodRequest` model read it.

---

## 4. What Exists

### Infrastructure
- [x] **Docker Compose** — PostGIS on `5432`, Redis on `6379`, both with health checks.
- [x] **Alembic** — `backend/alembic/` with baseline revision `0001_initial_schema`;
      `python -m app.init_db` runs `alembic upgrade head`.
- [x] **CORS from environment** — `BACKEND_CORS_ORIGINS` accepts a JSON list or a
      comma-separated string.
- [x] **Secret policy** — the shipped development key is refused when
      `ENVIRONMENT` is anything other than `development`/`dev`/`test`.

### Database Models (`app/models`)
`User`, `Hospital`, `BloodBank`, `Donor`, `InventoryUnit`, `BloodRequest`, `Allocation`,
`AllocationAuditLog`. Spatial columns are `Geography(POINT, 4326)`, so `ST_Distance`
returns metres. `BloodRequest` exposes read-only `hospital_name`, `hospital_address`,
`units_covered` and `units_shortfall` as plain properties — no serialization-time ORM
mutation.

### Core Utilities & Security (`app/core`)
- [x] **Database** (`database.py`) — async engine and session factory
      (`expire_on_commit=False`, `autoflush=False`).
- [x] **Redis & locks** (`redis.py`) — two independent tiers:
      - *Alert zone*: one enumerable SET per request, `lock:soft:req:{id}:donors`, with a
        TTL.
      - *Unit claim*: one key per unit slot, `lock:hard:req:{id}:unit:{n}`, claimed with
        atomic `SET NX`.
      Plus `alert_zone_ttl()` for the donor countdown and `release_request_locks()`.
- [x] **Security** (`security.py`) — bcrypt hashing and JWT issue/verify.
- [x] **RBAC** (`deps.py`) — `require_roles(*roles)` is a real dependency factory, plus
      `get_current_hospital` / `get_current_blood_bank` / `get_current_donor` and
      `is_elevated`.
- [x] **Custom exceptions** (`exceptions.py`) — `DomainException`,
      `DonorIneligibleError`, `AllocationRaceConditionError`.

### Repositories (`app/repositories`)
- [x] `donor_repo.find_eligible_donors_in_proximity()` — `ST_DWithin` radius search that
      also enforces availability, minimum weight, and the component-specific donation
      recovery window in SQL.
- [x] `inventory_repo.find_compatible_units_with_lock()` — FEFO ordering by real PostGIS
      distance to the requesting hospital, with `SELECT … FOR UPDATE SKIP LOCKED`.

### Services (`app/services`)
- [x] **`matching_service.py`** — ABO/Rh matrix (red-cell and plasma variants, which are
      inverses), triage urgency scoring, proximity scoring.
- [x] **`allocation_service.py`** — inventory-first pipeline, staged geofence expansion,
      per-unit donor claiming, honest coverage reporting, whole-shortfall re-planning.
- [x] **`donor_service.py`** — eligibility policy (weight, recovery window, availability),
      plasma-matrix classification, reliability scoring by exponential moving average.
- [x] **`inventory_service.py`** — expiry sweep (`expire_stale_units`) plus re-planning of
      requests holding a unit that expired; runs on a background task every 15 minutes.

### Allocation behaviour
- A request is `COMMITTED_IN_TRANSIT` **only** when every requested unit is covered. A
  partial fill stays in `PROXIMITY_ZONE_NOTIFIED` / `RE_PLANNING`.
- Each ACCEPT claims exactly one unit slot, so an N-unit request can be filled by N
  distinct donors. A donor who already holds a slot is returned `ALREADY_CLAIMED` rather
  than given a second.
- Stand-down on full coverage targets only the donors actually alerted for that request.
- Re-planning reserves the **entire** shortfall, not one unit.
- `POST /requests/{id}/fulfill` refuses with 409 while units are outstanding.

### REST API (`app/api/v1`)
- [x] `/auth` — register, login, profile.
- [x] `/requests` — create, get, list, cancel, fulfil. Hospital accounts act only for
      their own facility; coordinators/admins must name a `hospital_id`.
- [x] `/donors` — own profile, availability toggle, targeted alert feed, respond.
      Cross-tenant listing returns the reduced `DonorPublicOut` shape.
- [x] `/inventory` — register stock, list, status change, incoming orders, dispatch.
- [x] `/hospitals` — facility directory, so a coordinator can obtain a `hospital_id`.
- [x] `/audit` — compliance trail and per-request decision explanation.
- [x] `/admin` — network overview, manual allocation override, dev-only database reset.
- [x] `/health` and `/api/v1/health`.

### Real-Time Layer (`app/websocket`)
- [x] **Connection manager** — sockets register on channels derived from the
      authenticated identity (`user:{id}`, `role:{ROLE}`, `entity:{id}`); dead sockets are
      reaped on send failure.
- [x] **Authenticated `/ws`** — `?token=<jwt>`; an anonymous or invalid socket is accepted,
      sent an `AUTH_ERROR` frame, then closed with policy code **1008**.

### Frontend (`frontend/src`)
- [x] **Real login** — `LoginScreen.tsx` with an email/password form and a
      development-only demo-account panel; `AuthContext` restores a persisted session and
      reacts to 401 by dropping to the sign-in screen.
- [x] **Central API client** (`lib/api.ts`) — one place for the base URL, the bearer
      header, and error-envelope decoding. No hardcoded hosts remain.
- [x] **Environment config** (`config.ts`, `.env.example`) — `VITE_API_BASE_URL` and
      optional `VITE_WS_URL`.
- [x] **WebSocket lifecycle** — authenticates with the current token, and a
      `shouldReconnectRef` stops the old close→reconnect-forever loop; close code 1008
      halts retries.
- [x] **Five role dashboards** — Hospital, Blood Bank, Donor, Coordinator, Admin; all
      render honest "covered X of Y" coverage.

---

## 5. Known Gaps

- `AllocationStatus.SOFT_LOCKED` / `CANCELLED_BY_DONOR` / `TIMED_OUT` are never written
  (see §3).
- The donor response window is enforced by Redis TTL only; there is no scheduled job that
  expires a stale alert into a re-plan, so a request whose zone lapses waits for the next
  inventory or re-plan trigger.
- The test suite covers the security and allocation-critical paths; it is not exhaustive.
- **A donor submitting two ACCEPTs concurrently can hold two unit slots.**
  `process_donor_response` checks `donor_slot(...)` and then calls `claim_unit_slot(...)`,
  which is check-then-act: two in-flight requests from the same donor can each pass the
  check and each take a different free slot. The sequential case is handled (and tested) —
  this only bites on a genuine parallel double-submit. The fix is a partial unique index
  on `allocations (request_id, donor_id) WHERE source_type = 'LIVE_DONOR'`, translating the
  resulting `IntegrityError` into the existing `ALREADY_CLAIMED` response, so the database
  rather than Redis is the final authority. It needs an Alembic revision, so it should
  land with a working baseline to migrate from.
- **The frontend is not type-checked in strict mode.** `frontend/tsconfig.app.json` omits
  `"strict"`, so `strictNullChecks` is off across the whole app. The code is written to
  satisfy it — every `useState` that can hold nothing is annotated `| null`, and every
  `catch` narrows with `err instanceof Error` — but that has never been verified, because
  `tsc -b` gates `npm run build` and therefore the frontend Docker image. Turning it on is
  a one-line change that must be made *after* a clean `npx tsc -b` run, not before.

---

## 6. How to Run and Verify

```bash
# 1. Services
docker compose up -d db redis

# 2. Backend
cd backend
python -m venv venv                       # if not already present
./venv/Scripts/python.exe -m pip install -r requirements.txt
./venv/Scripts/python.exe -m app.init_db  # alembic upgrade head
./venv/Scripts/python.exe -m app.seed
./venv/Scripts/python.exe -m uvicorn app.main:app --reload

# 3. Verification
./venv/Scripts/python.exe -c "import app.main; print('import ok')"
./venv/Scripts/python.exe -m pytest -v tests/

# 4. Frontend
cd ../frontend
npm install
cp .env.example .env
npx tsc -b
npm run lint
npm run dev
```

Interactive API docs: `http://127.0.0.1:8000/api/v1/docs`.

### Demo accounts

All seeded accounts use the password `password123`.

| Role | Email |
| :--- | :--- |
| ADMIN | `admin@smartblood.org` |
| HOSPITAL | `hospital@smartblood.org`, `stjude@smartblood.org` |
| BLOOD_BANK | `bloodbank@smartblood.org` |
| DONOR | `alice@donor.org`, `bob@donor.org`, `charlie@donor.org` |
| COORDINATOR | `coordinator@smartblood.org` |

### Tests

`tests/` currently contains:

- `test_allocation_and_matching.py` — compatibility matrices, urgency and proximity
  scoring, and the seeded inventory pipeline.
- `test_security_wave1.py` — every previously-open route rejects anonymous callers, donors
  cannot read the request board or the donor directory, coordinators must name a hospital,
  a hospital cannot touch another hospital's request, and an anonymous WebSocket is
  rejected with 1008.
- `test_allocation_wave2.py` — per-unit slot claiming, alert-zone membership and TTL,
  full inventory coverage, partial fills never reporting in-transit, a three-unit request
  filled by three separate donors, double-claim rejection, re-planning after a
  quarantine, expiry sweeping, and the donation recovery window.

These are integration tests: PostgreSQL/PostGIS and Redis must be running. They fail
loudly rather than skipping when the services are absent, because the allocation
engine's correctness depends on both.
