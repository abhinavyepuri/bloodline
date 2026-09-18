# PS-1: Smart Blood & Emergency Donor Network

A dynamic resource-allocation and emergency blood network connecting hospitals, blood banks, and verified donors with real-time proximity geofencing, first-ack atomic locking, and continuous re-planning.

---

## 🏗️ System Architecture & Cross-Platform Flow

```text
                 ┌──────────────────────────┐
                 │   Android Mobile App     │
                 │   Kotlin / Jetpack       │
                 └────────────┬─────────────┘
                              │ HTTPS / WSS
                              │
                 ┌────────────▼─────────────┐
                 │      FASTAPI BACKEND     │
                 │      Python 3.11+        │
                 └────────────┬─────────────┘
                              │
                 ┌────────────▼─────────────┐
                 │      API / v1 Router     │
                 └────────────┬─────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
   Auth Service         Request Service        Donor Service
   JWT + RBAC           Triage & Intake        Eligibility & Proximity
        │                     │                     │
        ├─────────────────────┼─────────────────────┤
        │                     │                     │
        ▼                     ▼                     ▼
 Matching Engine       Allocation Engine      Inventory Service
 Priority Scoring      Proximity Broadcast    Blood Bank Units
 Compatibility         Atomic Hard Lock       FEFO Expiry Rules
        │                     │                     │
        └──────────────┬──────┴─────────────────────┘
                       ▼
             PostgreSQL 16 + PostGIS
             (Spatial Indexing & Queries)
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
           Redis 7         WebSocket Gateway
         Locks & PubSub    Live Queue Sync
             │                   │
             └─────────┬─────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
   Android App (Kotlin)          React Web (Vite + TS)
```

---

## 📁 Repository Structure

```text
yarin/
├── ARCHITECTURE.md                  # Comprehensive System & Software Architecture Doc
├── docker-compose.yml               # PostgreSQL+PostGIS, Redis, Backend orchestration
├── README.md                        # Quickstart & setup guide
│
├── backend/                         # Production-grade FastAPI backend
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py                  # App entry point, CORS & Lifespan
│       ├── core/                    # Config, DB async engine, Redis lock manager, Security
│       │   ├── config.py
│       │   ├── database.py
│       │   ├── redis.py
│       │   ├── security.py
│       │   ├── permissions.py
│       │   └── exceptions.py
│       ├── models/                  # SQLAlchemy PostGIS ORM models
│       │   ├── user.py
│       │   ├── donor.py
│       │   ├── hospital.py
│       │   ├── blood_bank.py
│       │   ├── inventory.py
│       │   ├── request.py
│       │   ├── allocation.py
│       │   └── audit.py
│       ├── schemas/                 # Pydantic v2 schemas
│       ├── repositories/            # Data access layer (PostGIS spatial queries, row locks)
│       ├── services/                # Business logic (Matching, Proximity Geofence, Allocation)
│       ├── api/                     # Versioned REST APIs (v1)
│       │   ├── v1/
│       │   │   ├── auth.py
│       │   │   ├── requests.py
│       │   │   ├── donors.py
│       │   │   ├── inventory.py
│       │   │   └── audit.py
│       │   └── deps.py
│       └── websocket/               # Real-time WebSocket connection manager & routes
│
├── frontend/                        # React + TypeScript + Vite Dashboard
└── mobile-android/                  # Kotlin Android Mobile App
```

---

## 🚀 How to Run

### Option 1: Full Stack via Docker Compose (Recommended)

1. **Start Database, Redis & Backend:**
   ```bash
   docker compose up --build
   ```
2. **Access Interactive API Docs:**
   - Swagger UI: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
   - ReDoc: [http://localhost:8000/api/v1/redoc](http://localhost:8000/api/v1/redoc)
   - Health check: [http://localhost:8000/health](http://localhost:8000/health)

---

### Option 2: Running Backend Locally (Python)

1. **Create and activate virtual environment:**
   ```bash
   cd backend
   python -m venv venv
   # Windows:
   .\venv\Scripts\activate
   # Linux/macOS:
   source venv/bin/activate
   ```
2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```
4. **Start PostgreSQL & Redis (e.g. via Docker):**
   ```bash
   docker compose up db redis -d
   ```
5. **Run FastAPI Server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

---

### 📱 Connecting Android App (Kotlin) & React Web

* **Android App (Kotlin Emulator)**:
  - Base URL for Android Emulator to access local backend: `http://10.0.2.2:8000/api/v1`
  - WebSocket URL: `ws://10.0.2.2:8000/api/v1/realtime/ws`
* **React Web Frontend**:
  - Base URL: `http://localhost:8000/api/v1`
  - WebSocket URL: `ws://localhost:8000/api/v1/realtime/ws`
