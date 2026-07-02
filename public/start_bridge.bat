@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
echo.
echo ============================================================
echo   POS 電文驗証工具 - ADB WebSocket Bridge
echo   請確認 adb_bridge.py 與此檔案放在同一資料夾
echo ============================================================
echo.

cd /d "%~dp0"

:: ─── 檢查 Python ───────────────────────────────────────────────────────────
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Python，請先安裝 Python 3.9 以上版本
    echo        下載: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [OK] Python 已安裝

if not exist "adb_bridge.py" (
    echo [錯誤] 找不到 adb_bridge.py
    echo        請將此 bat 與 adb_bridge.py 放在同一資料夾
    pause
    exit /b 1
)

:: ─── 檢查並安裝 websockets ─────────────────────────────────────────────────
python -c "import websockets" >nul 2>&1
if %errorlevel% neq 0 (
    echo [安裝] 正在安裝 websockets 套件...
    pip install websockets
) else (
    echo [OK] websockets 套件已安裝
)

:: ─── 檢查 ADB ──────────────────────────────────────────────────────────────
where adb >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [警告] 找不到 ADB，正在嘗試常見路徑...
    
    :: 嘗試常見的 ADB 路徑
    set "ADB_FOUND="
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_FOUND=%LOCALAPPDATA%\Android\Sdk\platform-tools"
    )
    if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_FOUND=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools"
    )
    
    if defined ADB_FOUND (
        echo [提示] 找到 ADB 在: !ADB_FOUND!
        echo        建議將此路徑加入系統 PATH 環境變數
        set "PATH=!ADB_FOUND!;%PATH%"
        echo [OK] 已暫時加入 PATH，本次執行可用
    ) else (
        echo.
        echo [錯誤] 找不到 ADB，請選擇：
        echo        1. 從 Android Studio 安裝 SDK Platform-Tools
        echo        2. 下載獨立版: https://developer.android.com/tools/releases/platform-tools
        echo.
        echo        安裝後請將 platform-tools 資料夾路徑加入系統 PATH
        echo.
        choice /C YN /M "是否繼續啟動 Bridge（無 ADB 將無法讀取設備）"
        if errorlevel 2 (
            exit /b 1
        )
    )
) else (
    echo [OK] ADB 已安裝
)

:: ─── 從協議 URL 取出 port 參數 ─────────────────────────────────────────────
set "PORT=9999"
if not "%~1"=="" (
    for /f "delims=" %%p in ('powershell -NoProfile -Command "if ('%~1' -match 'port=(\d+)') { $Matches[1] } else { '' }"') do (
        if not "%%p"=="" set "PORT=%%p"
    )
)

echo.
echo [啟動] 正在開啟 Bridge 視窗，Port=%PORT%...
echo        請保持彈出的視窗開啟，關掉後 Bridge 就會停止。
echo.
start "POS ADB Bridge - Port %PORT%" cmd /k python adb_bridge.py --port %PORT%
