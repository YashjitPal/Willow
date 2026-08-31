@echo off
title Willow ^& Sub2API Launcher

echo ===================================================
echo Stopping any existing servers...
echo ===================================================
:: Kill any Windows processes on ports 3000, 5173
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
:: Kill any old Sub2API processes inside WSL
wsl -u root bash -c "pkill -f sub2api_linux 2>/dev/null; true"

echo.
echo Starting Sub2API Server in background...
start "Sub2API Server" cmd /k "wsl -u root bash /mnt/c/Users/'%USERNAME%'/Workspace/Sub2API/backend/start_backend.sh"

echo.
echo Opening Dashboards in browser...
start http://localhost:3000
start http://localhost:34567

echo.
echo Starting Willow Dev Server at http://localhost:3000...
cd /d "%~dp0apps\studio"
call npm run dev

pause
