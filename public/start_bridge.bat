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

echo [啟動] 正在啟動 Bridge，請保持此視窗開啟...
echo        開啟瀏覽器後，Header 右上角應顯示「Bridge 已連線」
echo.
python adb_bridge.py
pause
