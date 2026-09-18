# Technology Stack
# SmartBlood — Smart Blood & Emergency Donor Network

**Version:** 1.0  
**Status:** Selected and Implemented (Backend Core); Frontend Planned

> All technology choices listed here are **implemented decisions**, not aspirational selections, unless explicitly marked as "Implementation Decision" or "Planned".

---

## 1. Frontend

| Attribute | Selected Technology | Version / Detail |
|:----------|:--------------------|:-----------------|
| **Framework** | React | 18.x |
| **Language** | TypeScript | 5.x |
| **Build Tool** | Vite | 5.x |
| **UI Library** | Custom components with Vanilla CSS | No third-party component framework required for prototype |
| **Styling Approach** | Vanilla CSS (CSS modules or plain CSS files) | Prioritises simplicity and clarity for demonstration |
| **State Management** | React Context API + `useState` / `useEffect` | Lightweight; no Redux or Zustand required for prototype |
| **API Communication** | Native `fetch` API (or `axios` — Implementation Decision) | REST over HTTPS to FastAPI backend |
| **Real-Time Communication** | Browser native WebSocket API (`new WebSocket(url)`) | Connects to `ws://localhost:8000/api/v1/realtime/ws` |

**Frontend Base URL:** `http://localhost:8000/api/v1`  
**WebSocket URL:** `ws://localhost:8000/api/v1/realtime/ws`

> **Planned:** The React + Vite frontend is planned and to be implemented. The backend is complete. The frontend communicates with the backend exclusively via the documented REST and WebSocket APIs.

---

## 2. Backend

| Attribute | Selected Technology | Version / Detail |
|:----------|:--------------------|:-----------------|
| **Framework** | FastAPI | >= 0.110.0, < 1.0.0 |
| **Language** | Python | 3.12 (async/await throughout) |
| **API Style** | REST (JSON) | Versioned under `/api/v1/` |
| **Validation** | Pydantic v2 | >= 2.6.4, < 3.0.0 |
| **Settings Management** | pydantic-settings | >= 2.2.1 |
| **ASGI Server** | Uvicorn (with standard extras) | >= 0.28.0 |
| **Authentication** | OAuth2 Password Flow + JWT | python-jose[cryptography] >= 3.3.0 |
| **Authorization** | Custom RBAC dependency guards | Via FastAPI `Depends()` |
| **Password Hashing** | passlib[bcrypt] + bcrypt | passlib==1.7.4, bcrypt==4.0.1 |
| **HTTP Client (internal)** | httpx | >= 0.27.0 |
| **Multipart** | python-multipart | >= 0.0.9 |
| **Environment Config** | python-dotenv | >= 1.0.1 |
| **Email Validation** | email-validator | >= 2.0.0 |

---

## 3. Database

| Attribute | Selected Technology | Version / Detail |
|:----------|:--------------------|:-----------------|
| **Database Engine** | PostgreSQL | 16 |
| **Spatial Extension** | PostGIS | 3.4 (`postgis/postgis:16-3.4` Docker image) |
| **ORM** | SQLAlchemy (async mode) | >= 2.0.28, < 3.0.0 |
| **Async Driver** | asyncpg | >= 0.29.0 |
| **Spatial ORM Extension** | GeoAlchemy2 | >= 0.14.4 |
| **Geometry Processing** | Shapely | >= 2.0.3 |
| **Migration Tool** | Alembic | >= 1.13.1 |
| **Connection String** | `postgresql+asyncpg://user:password@localhost:5432/smartblood` | Configured via `.env` |

**Why PostgreSQL + PostGIS:**
- PostgreSQL provides ACID-compliant transactions essential for allocation consistency.
- PostGIS provides native spatial indexing (GIST) and functions (`ST_DWithin`, `ST_Distance`) for efficient proximity queries without a separate geospatial service.
- GeoAlchemy2 integrates PostGIS with SQLAlchemy without additional boilerplate.

---

## 4. Real-Time Communication

| Attribute | Selected Technology |
|:----------|:--------------------|
| **Protocol** | WebSocket (RFC 6455) |
| **Server-Side** | FastAPI native WebSocket support (`fastapi.WebSocket`) |
| **Client-Side** | Browser native WebSocket API |
| **Connection Manager** | Custom `ConnectionManager` class in `app/websocket/connection_manager.py` |
| **Endpoint** | `ws://localhost:8000/api/v1/realtime/ws` |
| **Python Library** | `websockets >= 12.0` (used by uvicorn/FastAPI) |

**Why WebSocket over SSE:**
- WebSocket provides full-duplex communication, which is appropriate for the donor accept/decline interaction pattern where the client also sends data.
- It is natively supported by FastAPI/uvicorn without additional dependencies.
- SSE would require a separate mechanism for donor-to-server responses.

**Limitations acknowledged:**
- In the prototype, all WebSocket connections are managed in a single in-process `ConnectionManager` dictionary. For multi-instance production deployments, this manager would need to be backed by Redis Pub/Sub to support broadcasting across instances.
- Missed events due to disconnection are not replayed from a persistent queue in the prototype.

---

## 5. Allocation Engine

| Attribute | Selection |
|:----------|:----------|
| **Language / Runtime** | Python 3.12 (same process as FastAPI backend) |
| **Algorithm Approach** | **Heuristic greedy weighted scoring** |
| **Algorithm Details** | Inventory path: FEFO (First Expired, First Out) ordering; Donor path: PostGIS distance ordering with reliability_score as secondary factor |
| **Concurrency Control** | Redis atomic SET NX (compare-and-swap for hard locks); Redis SETEX (soft locks with TTL) |
| **Explainability** | Deterministic; all candidate scores and selection rationale written to `AllocationAuditLog` per decision |
| **AI/ML** | **Not used for core allocation.** No AI/ML model is involved in the allocation decision path. The algorithm is deterministic and fully inspectable. |

**Why Heuristic Greedy (not Integer Programming or Global Optimizer):**
- A global integer programming solver would require formulating the full multi-patient, multi-resource allocation as an ILP, which adds significant complexity and a solver dependency (e.g., PuLP, OR-Tools) with potentially long solve times for edge cases.
- The heuristic greedy approach is sufficient to demonstrate the core requirement: multi-factor allocation that is not simply nearest-resource, FCFS, or blood-group-only matching.
- It is deterministic, traceable, and produces an auditable explanation for every decision.
- It can be upgraded to a more sophisticated solver later without changing the data model or API contract.

**Scoring Factors Used (Implementation Decision — weights are tunable in `allocation_service.py`):**

| Factor | Source | Applied To |
|:-------|:-------|:-----------|
| Compatibility (binary gate) | ABO/Rh matrix | All candidates |
| Urgency score (0-100) | Triage level + deadline time remaining | Request priority |
| FEFO order (expiry_date ASC) | InventoryUnit.expiry_date | Inventory candidates |
| Proximity score (0.0-1.0) | ST_Distance result / max_radius | All candidates |
| Donor reliability score (0.0-1.0) | Donor.reliability_score | Donor candidates |
| Quantity feasibility (binary gate) | units_requested vs available stock | Inventory candidates |
| Verification status (binary gate) | is_verified flag | All candidates |

---

## 6. Maps / Travel Time

| Attribute | Selection |
|:----------|:----------|
| **Location Storage** | PostGIS `Geography(Point, SRID=4326)` columns with float lat/lng mirrors |
| **Distance Calculation** | PostGIS `ST_Distance()` (returns metres; converted to km) |
| **Proximity Radius Query** | PostGIS `ST_DWithin()` with spatial GIST index |
| **Travel Time Estimation** | Mock: `estimated_transit_minutes = distance_km / assumed_average_speed_kmh * 60` |
| **Default Assumed Speed** | Implementation Decision; configurable in `core/config.py` |
| **Real Provider Integration** | Not implemented in prototype. Interface abstracted so a real routing provider (e.g., OSRM, Google Maps Distance Matrix) can be plugged in by replacing the mock calculation. |

**Why No External Map API for Prototype:**
- Avoids mandatory external API key configuration and internet dependency during demonstration.
- PostGIS straight-line distance + assumed average speed is sufficient to demonstrate location-based scoring.
- The proximity score function (`compute_proximity_score`) and distance calculation are isolated in `matching_service.py` for easy provider substitution.

---

## 7. Notifications

| Attribute | Selection |
|:----------|:----------|
| **Primary Mechanism** | WebSocket push events (in-app, real-time) |
| **Abstraction Layer** | `ConnectionManager` in `app/websocket/connection_manager.py` |
| **Email** | Not implemented in prototype; optional future integration |
| **SMS** | Not implemented in prototype; optional future integration |
| **Push Notifications (mobile)** | Not implemented in prototype; optional future integration |
| **Message Format** | JSON: `{"event_type": "...", "request_id": "...", "payload": {...}, "timestamp": "..."}` |

**Provider Independence:** The `ConnectionManager` abstraction separates event dispatch logic from transport. Adding an email or SMS provider means implementing an additional send method in a notification service class without modifying the allocation engine.

---

## 8. Authentication

| Attribute | Selection |
|:----------|:----------|
| **Flow** | OAuth2 Password Flow (username/email + password -> JWT token) |
| **Token Type** | JWT (JSON Web Token) — Bearer token |
| **Algorithm** | HS256 |
| **Library** | python-jose[cryptography] |
| **Password Hashing** | bcrypt via passlib |
| **Token Payload** | `sub` (user_id), `role`, `exp` |
| **Token Expiry** | Configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` in `.env` |
| **Refresh Tokens** | Not implemented in prototype (Implementation Decision) |
| **Session Storage (client)** | Implementation Decision — browser localStorage or sessionStorage for the web frontend |

---

## 9. Testing

| Test Type | Technology | Scope |
|:----------|:-----------|:------|
| **Unit Testing** | pytest + pytest-asyncio | Services: matching_service, allocation_service (compatibility matrix, urgency scoring, proximity scoring, lock logic) |
| **Integration Testing** | pytest + httpx AsyncClient | Full API endpoint testing with a test database |
| **API Testing** | FastAPI TestClient or httpx AsyncClient | REST endpoint request/response validation |
| **Frontend Testing** | Vitest + React Testing Library (Planned) | Component rendering, form submission |
| **End-to-End Testing** | Manual demonstration scenario (defined in Workflow.md Section 14) | Full allocation cycle including re-planning |

> **Planned:** Automated test suite (`backend/tests/`) is to be implemented. The test suite must cover the acceptance criteria defined in PRD.md Section 20.

**Test Data:** All tests use synthetic data. No real patient, donor, or hospital data is used.

---

## 10. Development Tools

| Tool | Technology | Purpose |
|:-----|:-----------|:--------|
| **Package Manager (Python)** | pip with `requirements.txt` | Dependency management |
| **Package Manager (Frontend)** | npm | Node package management |
| **Virtual Environment** | Python `venv` | Isolate Python dependencies |
| **Code Formatting (Python)** | `black` (Implementation Decision — not yet configured) | Consistent code style |
| **Linting (Python)** | `flake8` or `ruff` (Implementation Decision) | Static analysis |
| **Environment Configuration** | `.env` file + `pydantic-settings` | All secrets and URLs in environment variables; `.env.example` provided |
| **Containerisation** | Docker + Docker Compose | PostgreSQL + PostGIS, Redis, and Backend services orchestrated |
| **Database GUI** | pgAdmin or DBeaver (optional, developer choice) | Inspect PostgreSQL tables |
| **API Documentation** | FastAPI auto-generated Swagger UI and ReDoc | Available at `/api/v1/docs` and `/api/v1/redoc` |

### Docker Compose Services
| Service Name | Image | Port | Purpose |
|:-------------|:------|:-----|:--------|
| `smartblood_postgres` | `postgis/postgis:16-3.4` | 5432 | PostgreSQL + PostGIS database |
| `smartblood_redis` | `redis:7.2-alpine` | 6379 | Cache and distributed lock store |
| `smartblood_backend` (optional) | Built from `backend/Dockerfile` | 8000 | FastAPI application server |

---

## 11. Deployment

For the prototype, the deployment model is **local Docker Compose**.

### Local Development Setup
1. Clone the repository.
2. Copy `backend/.env.example` to `backend/.env` and fill in secrets.
3. Run `docker compose up db redis -d` to start PostgreSQL and Redis.
4. Run `cd backend && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt`.
5. Run `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` from the `backend/` directory.
6. Access Swagger UI at `http://localhost:8000/api/v1/docs`.

### Full Stack via Docker Compose
```bash
docker compose up --build
```

Starts all three services (PostgreSQL, Redis, Backend).

### Production Deployment (Future — not implemented in prototype)
A future production deployment could use:
- A cloud-managed PostgreSQL service with PostGIS extension.
- A cloud-managed Redis service.
- The FastAPI backend deployed as a container on a cloud compute platform.
- A CDN-served React build for the frontend.

No specific cloud provider is assumed or required.

---

## 12. Why This Stack

| Technology | Justification |
|:-----------|:--------------|
| **FastAPI (Python)** | Fastest development pace for REST + WebSocket APIs in Python. Native async support aligns with the real-time requirements. Auto-generated Swagger documentation aids demonstration. Strong ecosystem for the allocation logic (numpy, scipy available if needed). |
| **Python 3.12** | Mature async/await support; rich ecosystem; fast development cycle; team familiarity for competition prototypes. |
| **PostgreSQL 16** | ACID transactions essential for allocation consistency. Mature, reliable, well-understood. |
| **PostGIS 3.4** | Eliminates the need for a separate geospatial service. ST_DWithin with GIST index provides efficient proximity queries directly in the primary database. |
| **SQLAlchemy 2.0 (async)** | Type-safe ORM with async driver support. GeoAlchemy2 integration for PostGIS columns. |
| **Redis 7.2** | Sub-millisecond operations for soft/hard lock management. Atomic SET NX prevents double-allocation race conditions. Simple to set up and operate. |
| **Pydantic v2** | Input validation at API boundary with clear error messages. Settings management via pydantic-settings. |
| **JWT + bcrypt** | Stateless authentication; no server-side session storage needed. bcrypt provides strong password hashing. |
| **React 18 + TypeScript + Vite** | Fast development server; TypeScript provides type safety for API contracts; Vite provides fast HMR for development; React's component model maps cleanly to role-specific dashboards. |
| **Native WebSocket** | Supported by FastAPI + uvicorn without additional broker; appropriate for prototype; no external service dependency. |
| **Docker Compose** | Reproducible local setup; eliminates "works on my machine" problems for demonstration; single command to start all services. |
| **Heuristic Greedy Allocation** | Deterministic, explainable, computationally lightweight. Demonstrates multi-factor allocation without the complexity of an ILP solver. Audit trail provides full traceability. |

---

## 13. Alternatives Considered

| Technology | Alternative Considered | Reason Not Selected |
|:-----------|:----------------------|:--------------------|
| PostgreSQL | MongoDB | PostgreSQL's ACID transactions are essential for allocation consistency; MongoDB's eventual consistency model is less suitable for distributed lock scenarios. |
| PostGIS | Separate Redis GEO or Elasticsearch for spatial | PostGIS integrates directly with the primary database, avoiding a separate service for a prototype. |
| WebSocket | Server-Sent Events (SSE) | WebSocket provides bidirectional communication needed for the donor accept/decline flow; SSE is receive-only from the client. |
| Heuristic Greedy | OR-Tools / PuLP Integer Programming | ILP adds significant solver complexity and dependency; not warranted for demonstrating the prototype's core concepts. Can be added later. |
| FastAPI | Django REST Framework | FastAPI's native async support and auto-documentation are better suited to real-time WebSocket + REST combination. |
| Redis | PostgreSQL advisory locks | Redis provides sub-millisecond atomic operations across the network; PostgreSQL advisory locks are suitable but Redis is purpose-built for this pattern. |
| Docker Compose | Kubernetes | Kubernetes is unnecessary overhead for a local development prototype. |
