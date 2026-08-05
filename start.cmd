@echo off
echo Stopping existing dev servers on port 3000 and 5173 (if any)...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo Killing process on port 3000 (PID %%a)...
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do (
    echo Killing process on port 5173 (PID %%a)...
    taskkill /f /pid %%a >nul 2>&1
)

cd /d "%~dp0"
echo Starting dev server at http://localhost:3000...
call npm run dev
pause
