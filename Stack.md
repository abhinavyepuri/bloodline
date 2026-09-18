# Technology Stack
# SmartBlood — Smart Blood & Emergency Donor Network

**Version:** 2.0  
**Status:** Fully Implemented (Backend Core, Real-Time Worker Engine, and Frontend Dashboards)  

---

## 1. Frontend

| Attribute | Selected Technology | Version / Detail |
| :--- | :--- | :--- |
| **Framework** | React | 19.x |
| **Language** | TypeScript | 5.x / 6.x |
| **Build Tool** | Vite | 8.x |
| **Icons & UI** | Lucide React | `lucide-react` |
| **Linter** | Oxlint | Fast Rust-based linter |
| **Styling Approach** | Modular / Vanilla CSS | Clean, responsive, dark-mode ready dashboards |
| **State Management** | React Context API (`AuthContext`, etc.) | Lightweight, resilient, zero boilerplate |
| **API Communication** | Centralized API client (`lib/api.ts`) | Automatic Bearer JWT injection, structured error envelopes |
| **Real-Time Communication** | Native WebSocket API | Connected to `ws://localhost:8000/api/v1/realtime/ws?token=<jwt>` with auto-reconnect |

**Dashboards Implemented:**
1. Hospital Trauma Dashboard (Intake, Live Tracking, Allocation Explanation)
2. Blood Bank Management Dashboard (FEFO stock, quarantine, dispatch orders)
3. Donor Emergency App (Availability toggle, active alerts, 1-tap accept/decline)
4. Emergency Operations Center (City-wide priority queue, SLA metrics, manual overrides)
5. System Admin Portal (Audits, compliance logs, demo resets)

---

## 2. Backend

| Attribute | Selected Technology | Version / Detail |
| :--- | :--- | :--- |
| **Framework** | FastAPI | >= 0.110.0, < 1.0.0 (Python async/await) |
| **Language** | Python | 3.12 / 3.13 |
| **API Specification** | REST (JSON) + WebSocket | 28 versioned endpoints under `/api/v1/` |
| **Validation** | Pydantic v2 | >= 2.6.4, < 3.0.0 |
| **Settings Management** | pydantic-settings | Environment-based configuration with production safeguards |
| **ASGI Server** | Uvicorn | Horizontal multi-worker capable with Redis backplane |
| **Authentication** | OAuth2 Password Flow + JWT | python-jose[cryptography], HS256, configurable expiry |
| **Authorization** | Declarative RBAC Guards | FastAPI `require_roles(*roles)` dependency factory |
| **Password Hashing** | bcrypt via passlib | Salted, secure password storage |
| **Idempotency** | Custom Redis Caching Layer | `Idempotency-Key` header prevents duplicate writes |
| **Rate Limiting** | Sliding-Window Token Bucket | Redis sorted-set limiter (60 req/min auth, 30 req/min dispatch) |
| **Tracing** | Correlation ID Middleware | Injects / propagates `X-Request-ID` across logs and queues |

---

## 3. Database & Spatial Persistence

| Attribute | Selected Technology | Version / Detail |
| :--- | :--- | :--- |
| **Database Engine** | PostgreSQL | 16 (`postgis/postgis:16-3.4` Docker image) |
| **Spatial Extension** | PostGIS | 3.4 (SRID 4326 Geography types) |
| **Spatial Indexing** | PostGIS GiST Indexes | Applied on `donors`, `hospitals`, and `blood_banks` locations |
| **Query Optimization** | Filtered Partial B-Tree Index | `idx_inventory_active_search` on `AVAILABLE` units |
| **ORM** | SQLAlchemy 2.0 (async mode) | Async engine, sessionmaker (`expire_on_commit=False`) |
| **Async Driver** | asyncpg | High-performance asynchronous PostgreSQL driver |
| **Spatial ORM** | GeoAlchemy2 & Shapely | Seamless spatial mapping to WKB geometry elements |
| **Migration Tool** | Alembic | 3 applied revisions: `0001_initial_schema`, `0002_add_request_code`, `0003_enterprise_indexes` |

---

## 4. Distributed Concurrency, Caching & Real-Time

| Attribute | Selected Technology | Purpose & Mechanism |
| :--- | :--- | :--- |
| **Cache & Lock Store** | Redis 7.2 (`redis:7.2-alpine`) | Sub-millisecond distributed lock store and pub/sub bus |
| **Slot Claiming** | Atomic Lua Script (`LUA_CLAIM_SLOT`) | Single-round-trip $O(1)$ compare-and-swap over $0 \dots N-1$ unit slots |
| **Alert Zones** | Enumerable Redis SETs | `lock:soft:req:{id}:donors` with 180s TTL for targeted stand-downs |
| **Real-Time Backplane** | Redis Pub/Sub (`smartblood:ws:events`) | Enables multi-process Uvicorn horizontal WebSocket fanout |
| **Connection Manager** | In-Process + Pub/Sub Hybrid | Channel routing (`user:{id}`, `role:{role}`, `entity:{id}`) |

---

## 5. Two-Tier Background Processing & Worker Engine

| Layer | Technology | Execution & Responsibilities |
| :--- | :--- | :--- |
| **Tier 1 (In-Process)** | FastAPI `BackgroundTasks` | Audit log writing, local connection manager dispatches, telemetry pings |
| **Tier 2 (Dedicated Worker)** | Standalone process (`app.worker`) | Reliable push notification consumer with exponential retries |
| **Dead-Letter Queue** | Redis List (`queue:notifications:dlq`) | Isolation of permanently failing notifications for diagnostics |
| **Keyspace Expiration** | Redis Keyspace Notifications (`KEx`) | Automated listener triggering `handle_allocation_timeout` on 180s expiry |
| **Inventory Sweeper** | Async Scheduled Loop | Hourly scan warning of inventory expiring within 24 hours (T-24h) |

---

## 6. Mobile Application

| Attribute | Selected Technology | Version / Detail |
| :--- | :--- | :--- |
| **Platform** | Android Native | API Level 26+ (Android 8.0 Oreo and above) |
| **Language** | Kotlin | Coroutines, Flow, Modern Android architecture |
| **UI Framework** | Jetpack Compose | Declarative Material 3 design |
| **Networking** | Retrofit 2 + OkHttp 4 | REST client with Bearer auth interceptor |
| **Real-Time Client** | OkHttp WebSocket | Persistent streaming client for dispatch alerts and telemetry |

---

## 7. Security & Auditing Tools

| Tool | Scope | Result / Standard |
| :--- | :--- | :--- |
| **Bandit** | Static Security Linter for Python | **0 High, 0 Medium** vulnerabilities detected across 5,364 LOC |
| **Oxlint** | Static Linter for Frontend TypeScript | Clean frontend rules enforcement |
| **Audit Log Trail** | PostgreSQL `allocation_audit_logs` | Immutable records detailing mathematical scores and decision rationale |
