@echo off
REM PVT Reservoir Fluids Division — Windows LAN Server Startup Script
setlocal
if "%HOST%"=="" set HOST=0.0.0.0
if "%PORT%"=="" set PORT=3000
set NODE_ENV=production

echo ===========================================================
echo  PVT Reservoir Fluids Division - Administrative System
echo  Running on http://%HOST%:%PORT% (Local Office LAN)
echo ===========================================================

if not exist dist (
  echo Building production assets...
  call npm run build
)

start "PVT-Admin-Server" /B npx tsx server.ts
echo Server started in background. Use stop_server.bat to stop safely.
endlocal
