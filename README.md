# SmartBlood (Yarin) — Real-Time Emergency Blood & Donor Network

A real-time emergency blood coordination and voluntary donor dispatch platform connecting hospitals, blood banks, and verified voluntary donors with geospatial proximity geofencing, first-expiring-first-out (FEFO) cold-chain allocation, atomic first-ack hard locking, and automated re-planning upon resource failure.

---

## 🏗️ Architecture & Real-Time Flow

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                React 18 Web App (Vite + TS)                 │
       │    Hospital Intake | Blood Bank Stock | Donor Dispatch      │
       │                 Coordinator Live Queue                      │
       └──────────────────────────────┬──────────────────────────────┘
                                      │ HTTP / WSS
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                       FASTAPI BACKEND                       │
       │            API v1 Gateway + Real-Time WebSocket             │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
   Auth & RBAC                 Request Service               Donor Service
  (JWT Tokens)              (Triage & Urgency)           (Proximity Geofence)
         │                            │                            │
         ├────────────────────────────┼────────────────────────────┤
         ▼                            ▼                            ▼
   Matching Matrix            Allocation Engine            Inventory Service
  (ABO/Rh Blood/Plasma)     (FEFO + First-Ack Lock)      (Cold-Chain Batches)
         │                            │                            │
         └─────────────────────┬──────┴────────────────────────────┘
                               ▼
                    PostgreSQL 16 + PostGIS
                 (Spatial Queries: ST_DWithin)
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
            Redis 7.2                  WebSocket Manager
     (Atomic Distributed Locks)      (Multi-Client Push Bus)
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

# 4. Verify/Initialize Database Tables
python -m app.init_db

# 5. Seed Synthetic Demo Data (Section 14 Scenario)
python -m app.seed

# 6. Start the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
*Backend endpoints:*
- REST API: `http://localhost:8000/api/v1`
- Swagger Documentation: `http://localhost:8000/api/v1/docs`
- Real-Time WebSocket: `ws://localhost:8000/api/v1/realtime/ws`
- Health Check: `http://localhost:8000/health`

---

#### Step 3: Setup and Start Frontend (React + Vite)
Open a second terminal in `frontend/`:
```bash
cd frontend

# 1. Install npm dependencies
npm install

# 2. Start the Vite development server
npm run dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** in your web browser.

---

## 👥 Pre-Configured Demo Accounts

All accounts use the password: `password123`

| Role | Email | Profile / Scenario Details |
| :--- | :--- | :--- |
| **Hospital Admin** | `hospital@smartblood.org` | Metro General Hospital (Emergency Intake & Live Tracking) |
| **Blood Bank Staff** | `bloodbank@smartblood.org` | Metro Blood Services (~0.9km away; stock units `BB-001`, `BB-002`) |
| **Donor Alice (D1)** | `alice@donor.org` | O- Donor (~2.1km away, reliability score 98%) |
| **Donor Bob (D2)** | `bob@donor.org` | O- Donor (~3.8km away, reliability score 92%) |
| **Coordinator** | `coordinator@smartblood.org` | Emergency Operations Center (City-wide Queue & Demo Controller) |

> 💡 **Tip:** Use the instant **"SWITCH VIEW"** pills in the top header of the web app to switch between roles with a single click.

---

## 🧪 Testing & Verification

### Run Backend Unit Tests (Pytest)
```bash
cd backend
.\venv\Scripts\python.exe -m pytest -v tests/
```
*Tests cover biological ABO/Rh compatibility, clinical urgency calculation, geospatial proximity scoring, and automated inventory reservation.*

### Run End-to-End Section 14 Demo Automation
```bash
cd backend
.\venv\Scripts\python.exe verify_demo.py
```
*Executes the full 10-step lifecycle (Request RA multi-unit reservation, Request RB donor broadcast, Unit BB-001 contamination failure, and Donor D1 First-Ack re-planning recovery).*

---

## 🎬 How to Run the Live Interactive Demo

1. Open **[http://localhost:5173/](http://localhost:5173/)**
2. In the **Coordinator Ops** view, locate the **Section 14 End-to-End Synthetic Demo Controller** at the top.
3. Click **`▶ Run Full Section 14 Flow`** to watch the automated sequence execute with live commentary.
4. Watch the real-time reactions across the live queue and the event telemetry ticker!
