# SmartBlood (Yarin) — Project Status

**Last Updated:** September 18, 2026  
**Current Phase:** Backend Core & API Implementation Completed, Server Operational  

---

## 1. Project Overview
SmartBlood (Yarin) is an intelligent, real-time emergency blood allocation and donor dispatch platform. It bridges hospitals, blood banks, and voluntary donors with geospatial proximity matching, automated compatibility checks, distributed concurrency locks, and live WebSocket updates.

---

## 2. Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Backend Framework** | FastAPI (Python 3.12, Async/Await) |
| **Database & GIS** | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) |
| **Cache & Concurrency** | Redis 7.2 (`redis:7.2-alpine`) + hiredis |
| **ORM & Migrations** | SQLAlchemy 2.0 (Async), GeoAlchemy2, Shapely, Alembic |
| **Authentication** | OAuth2 + JWT (python-jose), Passlib (bcrypt) |
| **Real-Time Layer** | WebSockets (Native FastAPI Connection Manager) |
| **Containerization** | Docker Compose |

---

## 3. Completed Components & Features

### 🐳 Infrastructure & Environment
- [x] **Docker Compose Configuration (`docker-compose.yml`)**:
  - `smartblood_postgres`: PostGIS database container on port `5432` with persistent volumes.
  - `smartblood_redis`: Redis 7.2 cache & pub/sub broker on port `6379`.
- [x] **Python Virtual Environment (`backend/venv`)**:
  - Configured with all dependencies (`fastapi`, `uvicorn`, `pydantic-settings`, `sqlalchemy`, `asyncpg`, `geoalchemy2`, `redis`, `email-validator`, etc.).
- [x] **Environment Configuration (`.env.example` & `.env`)**:
  - Configured database URLs, Redis URLs, JWT secrets, and token expiration parameters.

---

### 🗄️ Database Models (`app/models`)
- [x] **`User` (`user.py`)**: User authentication and roles (`HOSPITAL_ADMIN`, `BLOOD_BANK_STAFF`, `DONOR`, `SYSTEM_ADMIN`).
- [x] **`Hospital` (`hospital.py`)**: Hospital metadata with PostGIS `Point` geometry for precise latitude/longitude.
- [x] **`BloodBank` (`blood_bank.py`)**: Blood bank entity with PostGIS `Point` location and operational contact details.
- [x] **`Donor` (`donor.py`)**: Donor profile with blood group, Rh factor, availability status, last donation date, and PostGIS location coordinates.
- [x] **`Inventory` (`inventory.py`)**: Real-time blood unit tracking categorized by blood group, component type (Whole, RBC, Platelets, Plasma), expiry date, and status (`AVAILABLE`, `RESERVED`, `DISPATCHED`, `EXPIRED`).
- [x] **`Request` (`request.py`)**: Emergency & routine blood requests with urgency levels (`CRITICAL`, `URGENT`, `ROUTINE`), units needed, status tracking, and recipient location.
- [x] **`Allocation` (`allocation.py`)**: Fulfillment records mapping requests to specific inventory units with status (`PENDING`, `DISPATCHED`, `DELIVERED`, `CANCELLED`).
- [x] **`AuditLog` (`audit.py`)**: Immutable audit trail logging actor, action, timestamp, and metadata for regulatory compliance.

---

### 🛡️ Core Utilities & Security (`app/core`)
- [x] **Database Engine (`database.py`)**: Async SQLAlchemy session maker (`asyncpg`) and declarative base.
- [x] **Redis & Distributed Locks (`redis.py`)**: Async Redis client with distributed lock helper (`acquire_lock`) to prevent race conditions during high-concurrency blood unit allocations.
- [x] **Security & JWT (`security.py`)**: Bcrypt password hashing, verification, and JWT access token creation/decoding.
- [x] **Role-Based Access Control (`permissions.py` & `deps.py`)**: Role dependency guards and current user injection for endpoints.
- [x] **Custom Exceptions (`exceptions.py`)**: Unified exception handling for business logic errors (insufficient stock, unauthorized access, concurrency lock timeouts).

---

### 🔍 Repositories & Data Access (`app/repositories`)
- [x] **Base Repository (`base.py`)**: Generic async CRUD repository.
- [x] **Donor Repository (`donor_repo.py`)**: Geospatial radius queries (`ST_DWithin`) to find compatible donors within a specified kilometer radius.
- [x] **Inventory Repository (`inventory_repo.py`)**: Inventory queries with status filtering, expiry checks, and stock aggregation.

---

### 🧠 Business Logic & Allocation Engine (`app/services`)
- [x] **Matching Service (`matching_service.py`)**:
  - Full ABO and Rh compatibility matrix (Whole Blood, RBC, Platelets, Plasma).
  - Geospatial distance calculation using PostGIS `ST_Distance`.
- [x] **Allocation Service (`allocation_service.py`)**:
  - Automated blood matching & allocation prioritizing nearest blood banks with compatible units.
  - Redis distributed locking on unit reservations to eliminate double-allocation race conditions.
  - Automated emergency donor broadcast trigger when inventory falls short.
  - Comprehensive audit logging for all allocation actions.

---

### 🌐 REST API Endpoints (`app/api/v1`)
- [x] **`/api/v1/auth`**: User registration, login, and JWT token issuing.
- [x] **`/api/v1/donors`**: Donor registration, profile management, and proximity-based search.
- [x] **`/api/v1/inventory`**: Stock creation, querying available units, and threshold inspection.
- [x] **`/api/v1/requests`**: Emergency blood request submission and automatic triggering of the allocation engine.
- [x] **`/api/v1/audit`**: Read-only compliance audit trail endpoints.

---

### ⚡ Real-Time WebSocket Layer (`app/websocket`)
- [x] **Connection Manager (`connection_manager.py`)**: Multi-channel WebSocket connection manager supporting broadcasts to hospitals, blood banks, and donors.
- [x] **WebSocket Route (`routes.py`)**: `/ws` endpoint for live event subscriptions (emergency broadcasts, live dispatch tracking, stock threshold alerts).

---

## 4. Current System Status

- **Database & Cache**: PostGIS and Redis containers are running healthy via Docker.
- **FastAPI Reloader**: Server starts cleanly on `http://127.0.0.1:8000`.
- **API Docs**: Interactive Swagger documentation available at `http://127.0.0.1:8000/docs`.

---

## 5. Next Steps & Roadmap

1. **Database Migrations (Alembic)**: Generate initial schema migration scripts and apply tables to PostgreSQL/PostGIS.
2. **Seed Data**: Create initial seed script for hospitals, blood banks, sample donors, and inventory.
3. **Frontend Application**: Develop the web dashboard (Hospital emergency portal, Blood Bank inventory management, Donor dispatch tracking).
4. **Automated Testing**: Unit and integration test suite covering compatibility matching, concurrency locks, and API routes.
