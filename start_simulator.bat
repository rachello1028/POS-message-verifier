@echo off
chcp 65001 >nul
title POS Host Simulator
echo ============================================
echo   POS Host Simulator
echo   Usage: start_simulator.bat [TCP_PORT]
echo ============================================
echo.

set PORT=%1
if "%PORT%"=="" set PORT=8000

python "%~dp0host_simulator.py" --port %PORT%

if errorlevel 1 (
    echo.
    echo [ERROR] Python or dependencies missing
    echo   pip install websockets
    echo.
    pause
)
