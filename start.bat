@echo off
cd /d "%~dp0"

REM Free port 3000 if a previous run is still holding it
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 .*LISTENING"') do (
  echo [start.bat] Port 3000 is in use by PID %%a - freeing it...
  taskkill /F /PID %%a >nul 2>&1
)

if not exist node_modules (
  echo [start.bat] Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Make sure Node.js 18+ is installed and on your PATH.
    pause
    exit /b 1
  )
)

REM Open the default browser to the local server URL after a short delay
REM so node has time to bind port 3000. Spawned in a minimised PowerShell
REM window so it doesn't block this script — the window auto-closes once
REM Start-Process fires.
start "HeroQuest browser launcher" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
