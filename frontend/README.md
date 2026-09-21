# Bloodline — Web Frontend Application

The web frontend for **Bloodline** is an enterprise emergency blood coordination and voluntary donor dispatch portal built with **React 19**, **TypeScript**, and **Vite 8**.

---

## 🚀 Features & Operational Dashboards

The application provides five dedicated, role-specific operational dashboards synchronized with the backend via REST and real-time WebSockets:

1. **Hospital Trauma Portal (`HOSPITAL`)**:
   - Emergency blood request intake with short codes (e.g. `REQ-8492`), urgency scoring, and triage level selection.
   - Live tracking view with honest coverage reporting ("$K$ of $N$ units covered").
   - Detailed allocation explainability view breaking down compatibility, FEFO batch selection, and proximity factors.
   - High-priority trauma bay alerts when incoming donors are within 500m of the hospital.

2. **Blood Bank Console (`BLOOD_BANK`)**:
   - Real-time cold-chain inventory management sorted by First-Expired, First-Out (FEFO).
   - Instant unit registration and status transitions (`AVAILABLE`, `LOCKED_RESERVE`, `DISPATCHED`, `QUARANTINED`).
   - Quarantine actions that trigger self-healing backend re-planning.
   - Incoming hospital dispatch orders and courier handover confirmation.

3. **Voluntary Donor Portal (`DONOR`)**:
   - Availability toggle and location synchronization with the backend PostGIS matching engine.
   - Real-time emergency dispatch alert feed with countdown timer.
   - 1-tap contextual emergency response (`ACCEPT` / `DECLINE`).

4. **Emergency Operations Center (`COORDINATOR`)**:
   - City-wide live queue sorted by computed urgency score (0-100).
   - Real-time clinical SLA metrics: Mean Time to Sourcing (MTTS), donor conversion rate, and replan frequency.
   - Manual allocation override tools and live event telemetry ticker.
   - Built-in **Section 14 End-to-End Synthetic Demo Controller**.

5. **System Administrator Console (`ADMIN`)**:
   - Network-wide overview of verified hospitals, blood banks, and donors.
   - Full immutable audit log trail of every allocation decision.
   - Development database reset and re-seeding controls.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | React 19 | Core UI components and state management |
| **Language** | TypeScript 5 / 6 | Strict typing across API contracts and schemas |
| **Build Tool** | Vite 8 | Ultra-fast development server with HMR |
| **Icons** | Lucide React | High-contrast clinical and operational iconography |
| **Linter** | Oxlint | High-performance Rust-based static analyzer |
| **State** | React Context API | `AuthContext` managing JWT persistence and session state |
| **Networking** | Central API Client (`lib/api.ts`) | Unified Bearer authentication, request tracing, and error envelopes |
| **Real-Time** | Native WebSocket | Persistent connection to `/api/v1/realtime/ws?token=<jwt>` with auto-reconnect |

---

## ⚙️ Configuration & Environment

Configuration is managed via `.env` in the `frontend/` directory.

Copy the example configuration:
```bash
cp .env.example .env
```

Default variables:
```env
# Base URL for REST API
VITE_API_BASE_URL=http://localhost:8000/api/v1

# URL for Real-Time WebSocket Bus
VITE_WS_URL=ws://localhost:8000/api/v1/realtime/ws
```

---

## 🏃 Running the Application

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** in your browser.

### 3. Linting
```bash
npm run lint
```

### 4. Production Build
```bash
npm run build
```

---

## 👥 Demo Personas (One-Click Sign-In)

In development mode (`npm run dev`), the navigation bar features instant **SWITCH VIEW** buttons for testing:

- **Admin**: `admin@smartblood.org`
- **Hospital**: `hospital@smartblood.org`
- **Blood Bank**: `bloodbank@smartblood.org`
- **Donor (D1)**: `alice@donor.org`
- **Coordinator**: `coordinator@smartblood.org`

All accounts use the password: `password123`.
