@echo off
chcp 65001 >nul
title Smart Class Scheduling System (Offline)

set NODE_EXE=
if exist "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" set NODE_EXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe
if not defined NODE_EXE (
    where node >nul 2>nul && set NODE_EXE=node
)
if not defined NODE_EXE (
    echo [ERROR] Node.js not found. Please install Node.js 18+ first.
    pause
    exit /b 1
)

echo ==============================================
echo   Smart Class Scheduling System - Offline
echo   Starting server at http://localhost:8080
echo   Close this window to stop the server.
echo ==============================================
start "" http://localhost:8080
"%NODE_EXE%" "%~dp0server.js"
pause
