@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: --- Check Python ---
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.9+
    pause
    exit /b 1
)

if not exist "host_simulator.py" (
    echo [ERROR] host_simulator.py not found in %~dp0
    pause
    exit /b 1
)

:: --- Check websockets ---
python -c "import websockets" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INSTALL] Installing websockets...
    pip install websockets
)

:: --- Parse port from protocol URL ---
set "PORT=8000"
set "WS_PORT=8001"
if not "%~1"=="" (
    for /f "delims=" %%p in ('powershell -NoProfile -Command "if ('%~1' -match 'port=(\d+)') { $Matches[1] } else { '' }"') do (
        if not "%%p"=="" set "PORT=%%p"
    )
    for /f "delims=" %%w in ('powershell -NoProfile -Command "if ('%~1' -match 'wsport=(\d+)') { $Matches[1] } else { '' }"') do (
        if not "%%w"=="" set "WS_PORT=%%w"
    )
)

:: --- Launch ---
echo [START] Host Simulator on TCP port %PORT%, WS port %WS_PORT%
start "POS Host Simulator - Port %PORT%" cmd /k python host_simulator.py --port %PORT% --ws-port %WS_PORT%
