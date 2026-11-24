@echo off
REM Safely terminate the PVT Administrative Management System server on Windows
echo Stopping PVT Administrative Management System...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /PID %%a /F
)
echo Server stopped.
