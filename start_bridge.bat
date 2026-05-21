@echo off
chcp 65001 >nul
echo.
echo ============================================================
echo   POS 電文驗証工具 - ADB WebSocket Bridge
echo   請確認 adb_bridge.py 與此檔案放在同一資料夾
echo ============================================================
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Python，請先安裝 Python 3.9 以上版本
    echo        下載: https://www.python.org/downloads/
    pause
    exit /b 1
)

if not exist "adb_bridge.py" (
    echo [錯誤] 找不到 adb_bridge.py
    echo        請將此 bat 與 adb_bridge.py 放在同一資料夾
    pause
    exit /b 1
)

python -c "import websockets" >nul 2>&1
if %errorlevel% neq 0 (
    echo [安裝] 正在安裝 websockets 套件...
    pip install websockets
)

:: 從協議 URL 取出 port 參數 (e.g. pos-bridge-runner://run?port=8767)
set "PORT=8765"
if not "%~1"=="" (
    for /f "delims=" %%p in ('powershell -NoProfile -Command "if ('%~1' -match 'port=(\d+)') { $Matches[1] } else { '' }"') do (
        if not "%%p"=="" set "PORT=%%p"
    )
)

echo [啟動] 正在開啟 Bridge 視窗，Port=%PORT%...
echo        請保持彈出的視窗開啟，關掉後 Bridge 就會停止。
echo.
start "POS ADB Bridge - Port %PORT%" cmd /k python adb_bridge.py --port %PORT%
