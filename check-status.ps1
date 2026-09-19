#!/usr/bin/env pwsh
# Check Status of All Bloodline Services

Write-Host "🩸 Bloodline Service Status Check" -ForegroundColor Red
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

# Check Docker
Write-Host "1️⃣  Docker Status" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    docker version | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Docker is running" -ForegroundColor Green
    } else {
        Write-Host "❌ Docker is not running" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Docker is not installed" -ForegroundColor Red
}

Write-Host ""

# Check Docker Compose Services
Write-Host "2️⃣  Docker Compose Services" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    $services = docker compose ps --format json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $servicesList = $services | ConvertFrom-Json
        if ($servicesList.Count -eq 0) {
            Write-Host "⚠️  No services running" -ForegroundColor Yellow
            Write-Host "   Start with: docker compose up db redis -d" -ForegroundColor Gray
        } else {
            foreach ($service in $servicesList) {
                $status = $service.State
                $name = $service.Service
                $icon = if ($status -eq "running") { "✅" } else { "❌" }
                $color = if ($status -eq "running") { "Green" } else { "Red" }
                Write-Host "$icon $name - $status" -ForegroundColor $color
            }
        }
    }
} catch {
    Write-Host "❌ Could not check Docker services" -ForegroundColor Red
}

Write-Host ""

# Check PostgreSQL
Write-Host "3️⃣  PostgreSQL Database" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    $result = docker compose exec -T db pg_isready -U postgres 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ PostgreSQL is accepting connections on port 5432" -ForegroundColor Green
    } else {
        Write-Host "❌ PostgreSQL is not responding" -ForegroundColor Red
        Write-Host "   Start with: docker compose up db -d" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Could not connect to PostgreSQL" -ForegroundColor Red
    Write-Host "   Start with: docker compose up db -d" -ForegroundColor Gray
}

Write-Host ""

# Check Redis
Write-Host "4️⃣  Redis Cache" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    $result = docker compose exec -T redis redis-cli ping 2>&1
    if ($result -match "PONG") {
        Write-Host "✅ Redis is responding on port 6379" -ForegroundColor Green
    } else {
        Write-Host "❌ Redis is not responding" -ForegroundColor Red
        Write-Host "   Start with: docker compose up redis -d" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Could not connect to Redis" -ForegroundColor Red
    Write-Host "   Start with: docker compose up redis -d" -ForegroundColor Gray
}

Write-Host ""

# Check Backend API
Write-Host "5️⃣  Backend API" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        Write-Host "✅ Backend is running on http://127.0.0.1:8000" -ForegroundColor Green
        Write-Host "   Service: $($data.service)" -ForegroundColor Gray
        Write-Host "   Environment: $($data.environment)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Backend is not running" -ForegroundColor Red
    Write-Host "   Start with: cd backend && uvicorn app.main:app --reload" -ForegroundColor Gray
}

Write-Host ""

# Check Frontend
Write-Host "6️⃣  Frontend" -ForegroundColor Cyan
Write-Host "-" * 60 -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Frontend is running on http://localhost:5173" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Frontend is not running" -ForegroundColor Red
    Write-Host "   Start with: cd frontend && npm run dev" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

# Summary
$allGood = $true
Write-Host "📊 Summary:" -ForegroundColor Cyan
Write-Host ""

try {
    docker version | Out-Null
    $dockerRunning = ($LASTEXITCODE -eq 0)
    $services = docker compose ps --format json 2>&1 | ConvertFrom-Json
    $dbRunning = ($services | Where-Object { $_.Service -eq "db" -and $_.State -eq "running" }) -ne $null
    $redisRunning = ($services | Where-Object { $_.Service -eq "redis" -and $_.State -eq "running" }) -ne $null
    
    $backendResponse = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    $backendRunning = $backendResponse.StatusCode -eq 200
    
    $frontendResponse = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    $frontendRunning = $frontendResponse.StatusCode -eq 200

    if ($dockerRunning -and $dbRunning -and $redisRunning -and $backendRunning -and $frontendRunning) {
        Write-Host "🎉 All services are running! Ready to develop!" -ForegroundColor Green
        Write-Host "   Open: http://localhost:5173" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️  Some services need attention:" -ForegroundColor Yellow
        Write-Host ""
        if (-not $dockerRunning) { Write-Host "   • Start Docker Desktop" -ForegroundColor Gray }
        if (-not $dbRunning -or -not $redisRunning) { 
            Write-Host "   • Run: .\start-dev.ps1" -ForegroundColor Gray 
            Write-Host "     or: docker compose up db redis -d" -ForegroundColor Gray
        }
        if (-not $backendRunning) { 
            Write-Host "   • Start backend: cd backend && uvicorn app.main:app --reload" -ForegroundColor Gray 
        }
        if (-not $frontendRunning) { 
            Write-Host "   • Start frontend: cd frontend && npm run dev" -ForegroundColor Gray 
        }
    }
} catch {
    Write-Host "⚠️  Could not determine full status" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "💡 Quick commands:" -ForegroundColor Cyan
Write-Host "   Start services:    .\start-dev.ps1" -ForegroundColor Gray
Write-Host "   View logs:         docker compose logs -f" -ForegroundColor Gray
Write-Host "   Stop services:     docker compose down" -ForegroundColor Gray
Write-Host ""
