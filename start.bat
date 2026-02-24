@echo off
title Akara AI - Launcher
echo.
echo  ========================================
echo   Akara AI - Smart Assistant
echo   Powered by Ollama Llama 3.1
echo  ========================================
echo.
echo  Starting server in a separate window...
echo  Chat UI:    http://localhost:3000
echo.

:: Start the server in a separate console window for log monitoring
start "Akara AI - Backend Logs" cmd /k "cd /d %~dp0 && bun run src/server.ts"

:: Wait a moment then open the browser
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo  ✓ Server started in separate window.
echo  ✓ Browser opened.
echo.
echo  You can close this window now.
echo  To stop the server, run: .\stop
echo  ========================================
