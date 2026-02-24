@echo off
echo.
echo  ========================================
echo   Stopping Akara AI Server...
echo  ========================================
echo.

:: Find and kill bun processes running on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo  Killing process PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: Also kill any remaining bun.exe processes from server.ts
taskkill /F /IM bun.exe /FI "WINDOWTITLE eq Akara AI - Backend Logs" >nul 2>&1

echo.
echo  ✓ Server stopped.
echo  ========================================
echo.
