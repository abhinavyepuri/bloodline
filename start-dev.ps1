#!/usr/bin/env pwsh
# Quick Start Script for Bloodline Development Environment

Write-Host "🩸 Bloodline - Smart Blood & Emergency Donor Network" -ForegroundColor Red
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

# Check if Docker is running
Write-Host "📦 Checking Docker..." -ForegroundColor Cyan
try {
    $dockerVersion = docker version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker is not running!" -ForegroundColor Red
        Write-Host "   Please start Docker Desktop and try again." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not installed or not running!" -ForegroundColor Red
    Write-Host "   Please install Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "🚀 Starting PostgreSQL and Redis..." -ForegroundColor Cyan
docker compose up db redis -d

Write-Host ""
Write-Host "⏳ Waiting for services to be healthy (10 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check if services are running
Write-Host ""
Write-Host "🔍 Checking service status..." -ForegroundColor Cyan
$services = docker compose ps --format json | ConvertFrom-Json

$dbRunning = $false
$redisRunning = $false

foreach ($service in $services) {
    if ($service.Service -eq "db" -and $service.State -eq "running") {
        $dbRunning = $true
        Write-Host "✅ PostgreSQL is running on port 5432" -ForegroundColor Green
    }
    if ($service.Service -eq "redis" -and $service.State -eq "running") {
        $redisRunning = $true
        Write-Host "✅ Redis is running on port 6379" -ForegroundColor Green
    }
}

if (-not $dbRunning) {
    Write-Host "❌ PostgreSQL failed to start!" -ForegroundColor Red
    Write-Host "   Check logs: docker compose logs db" -ForegroundColor Yellow
    exit 1
}

if (-not $redisRunning) {
    Write-Host "❌ Redis failed to start!" -ForegroundColor Red
    Write-Host "   Check logs: docker compose logs redis" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host "✅ Database services are ready!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Initialize database (first time only):" -ForegroundColor White
Write-Host "      cd backend" -ForegroundColor Gray
Write-Host "      python -m app.init_db" -ForegroundColor Gray
Write-Host "      python -m app.seed" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Start the backend:" -ForegroundColor White
Write-Host "      cd backend" -ForegroundColor Gray
Write-Host "      uvicorn app.main:app --reload --port 8000" -ForegroundColor Gray
Write-Host ""
Write-Host "   3. Start the frontend (in a new terminal):" -ForegroundColor White
Write-Host "      cd frontend" -ForegroundColor Gray
Write-Host "      npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "   4. Open browser: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "📖 Full documentation: START_SERVICES.md" -ForegroundColor Cyan
Write-Host "🛑 To stop services: docker compose down" -ForegroundColor Yellow
Write-Host "=" * 60 -ForegroundColor Gray
