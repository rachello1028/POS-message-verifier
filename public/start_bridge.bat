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

if not exist "adb_bridge.py" (
    echo [ERROR] adb_bridge.py not found in %~dp0
    pause
    exit /b 1
)

:: --- Check websockets ---
python -c "import websockets" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INSTALL] Installing websockets...
    pip install websockets
)

:: --- Check ADB ---
where adb >nul 2>&1
if %errorlevel% neq 0 (
    set "ADB_FOUND="
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_FOUND=%LOCALAPPDATA%\Android\Sdk\platform-tools"
    )
    if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_FOUND=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools"
    )
    if defined ADB_FOUND (
        set "PATH=!ADB_FOUND!;%PATH%"
        echo [OK] ADB found at !ADB_FOUND!
    ) else (
        echo [WARN] ADB not found. Bridge may not work without ADB.
        choice /C YN /M "Continue anyway?"
        if errorlevel 2 exit /b 1
    )
)

:: --- Parse port from protocol URL ---
set "PORT=9999"
if not "%~1"=="" (
    for /f "delims=" %%p in ('powershell -NoProfile -Command "if ('%~1' -match 'port=(\d+)') { $Matches[1] } else { '' }"') do (
        if not "%%p"=="" set "PORT=%%p"
    )
)

:: --- Launch ---
echo [START] ADB Bridge on port %PORT%
start "POS ADB Bridge - Port %PORT%" cmd /k python adb_bridge.py --port %PORT%
