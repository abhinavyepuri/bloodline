# 🚀 Quick Start Guide - Bloodline Application

## Problem: Database Not Running

You're seeing these errors because **PostgreSQL and Redis are not running**:
```
[Errno 10061] Connect call failed ('127.0.0.1', 5432)  # PostgreSQL
[Errno 10061] Connect call failed ('127.0.0.1', 6379)  # Redis
```

## Solution: Start the Required Services

### Option 1: Using Docker Compose (Recommended)

#### Start Only Database and Redis:
```powershell
# Navigate to project directory
cd C:\Users\ryoku\Documents\projects\bloodline

# Start PostgreSQL and Redis in the background
docker compose up db redis -d
```

#### Verify Services Are Running:
```powershell
docker compose ps
```

You should see:
```
NAME                   STATUS      PORTS
smartblood_postgres    Up          0.0.0.0:5432->5432/tcp
smartblood_redis       Up          0.0.0.0:6379->6379/tcp
```

#### Then Start Backend Manually:
```powershell
cd backend
uvicorn app.main:app --reload --port 8000
```

You should see:
```
INFO:     Connected to Redis (distributed locking and real-time alert zones).
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000
```

---

### Option 2: Start Everything with Docker Compose

This will start PostgreSQL, Redis, Backend, and Frontend all together:

```powershell
cd C:\Users\ryoku\Documents\projects\bloodline
docker compose up --build
```

Access:
- Frontend: http://localhost:8080
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/api/v1/docs

---

## Step-by-Step Setup (First Time)

### 1. Start Database Services
```powershell
cd C:\Users\ryoku\Documents\projects\bloodline
docker compose up db redis -d
```

**Wait for health checks** (about 10 seconds):
```powershell
docker compose ps
```

### 2. Initialize Database Schema
```powershell
cd backend
python -m app.init_db
```

Expected output:
```
INFO: Alembic migrations applied successfully.
INFO: Database schema is up to date.
```

### 3. Seed Initial Data (Optional)
```powershell
python -m app.seed
```

This creates test users, hospitals, donors, and inventory.

### 4. Start Backend
```powershell
uvicorn app.main:app --reload --port 8000
```

Expected output:
```
✅ Connected to Redis
✅ Connected to PostgreSQL
INFO: Application startup complete.
```

### 5. Start Frontend (in a new terminal)
```powershell
cd C:\Users\ryoku\Documents\projects\bloodline\frontend
npm install  # First time only
npm run dev
```

Expected output:
```
VITE ready in xxx ms
➜  Local:   http://localhost:5173/
```

### 6. Access the Application
Open browser: **http://localhost:5173**

---

## Test Login Credentials (After Seeding)

After running `python -m app.seed`, you can login with:

### Hospital User:
- Email: `hospital@example.com`
- Password: `password123`

### Blood Bank User:
- Email: `bloodbank@example.com`
- Password: `password123`

### Coordinator User:
- Email: `coordinator@example.com`
- Password: `password123`

### Donor User:
- Email: `donor@example.com`
- Password: `password123`

---

## Common Commands

### Check if Services are Running:
```powershell
# Check Docker containers
docker compose ps

# Check PostgreSQL
docker compose exec db pg_isready -U postgres

# Check Redis
docker compose exec redis redis-cli ping
```

### View Logs:
```powershell
# All services
docker compose logs -f

# Specific service
docker compose logs -f db
docker compose logs -f redis
```

### Stop Services:
```powershell
# Stop all
docker compose down

# Stop specific services
docker compose stop db redis
```

### Restart Services:
```powershell
docker compose restart db redis
```

### Clean Up (Remove all data):
```powershell
docker compose down -v
```
⚠️ Warning: This deletes all database data!

---

## Troubleshooting

### Problem: "Cannot connect to PostgreSQL"
**Solution:**
```powershell
# Check if PostgreSQL is running
docker compose ps

# If not running, start it
docker compose up db -d

# Wait 10 seconds for health check
timeout /t 10

# Check connection
docker compose exec db pg_isready -U postgres
```

### Problem: "Cannot reach Redis"
**Solution:**
```powershell
# Check if Redis is running
docker compose ps

# If not running, start it
docker compose up redis -d

# Test connection
docker compose exec redis redis-cli ping
# Should return: PONG
```

### Problem: "Port 5432 already in use"
**Cause:** Another PostgreSQL instance is running

**Solution:**
```powershell
# Option 1: Stop other PostgreSQL instance
# Check what's using port 5432
netstat -ano | findstr :5432

# Option 2: Change port in docker-compose.yml
# Edit docker-compose.yml:
# ports:
#   - "5433:5432"  # Use 5433 instead

# Then update backend/.env:
# POSTGRES_PORT=5433
```

### Problem: "Port 6379 already in use"
**Cause:** Another Redis instance is running

**Solution:**
```powershell
# Check what's using port 6379
netstat -ano | findstr :6379

# Change port in docker-compose.yml if needed
```

### Problem: Backend starts but login fails
**Solution:**
```powershell
# Re-initialize database
cd backend
python -m app.init_db

# Seed test data
python -m app.seed
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│         Browser (localhost:5173)        │
│           React Frontend                │
└────────────────┬────────────────────────┘
                 │ HTTP/WebSocket
                 ▼
┌─────────────────────────────────────────┐
│      Backend API (localhost:8000)       │
│          FastAPI + Python               │
└─────┬──────────────────┬────────────────┘
      │                  │
      ▼                  ▼
┌──────────────┐   ┌──────────────┐
│  PostgreSQL  │   │    Redis     │
│    :5432     │   │    :6379     │
│   (PostGIS)  │   │  (PubSub)    │
└──────────────┘   └──────────────┘
```

---

## Current Status Check

Run this to verify everything:

```powershell
# 1. Check Docker services
docker compose ps

# 2. Check PostgreSQL
docker compose exec db psql -U postgres -d smartblood_db -c "SELECT 1;"

# 3. Check Redis
docker compose exec redis redis-cli ping

# 4. Check Backend health
curl http://localhost:8000/health

# 5. Check Frontend (if running)
curl http://localhost:5173
```

All should return success! ✅

---

## Next Steps After Fixing

1. ✅ Start PostgreSQL and Redis: `docker compose up db redis -d`
2. ✅ Initialize database: `cd backend && python -m app.init_db`
3. ✅ Seed test data: `python -m app.seed`
4. ✅ Start backend: `uvicorn app.main:app --reload`
5. ✅ Start frontend: `cd ../frontend && npm run dev`
6. ✅ Open browser: http://localhost:5173
7. ✅ Login with test credentials
8. ✅ Test all buttons and features!

---

**Last Updated:** 2024
**Status:** Ready to fix! Just start the Docker services 🚀
