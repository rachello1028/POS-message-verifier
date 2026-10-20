@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title ECPay SCP Timeout Test

:: ===================================================================
::  ECPay SCP timeout / QueryTrade test (one-click)
::   1. Host Simulator on port 8000 (GenPaymentCode = hang, no reply)
::   2. Cloudflare quick tunnel -> public https URL (SCP rejects http
::      and self-signed certs, so a trusted https URL is required)
::  Usage:
::   start_ecpay_scp_test.bat            QueryTrade replies success
::   start_ecpay_scp_test.bat not_found  QueryTrade replies not found
:: ===================================================================

set "QUERY_MODE=success"
if /i "%~1"=="not_found" set "QUERY_MODE=not_found"

set "CF_DIR=D:\tool\cloudflared"
set "CF_EXE=%CF_DIR%\cloudflared.exe"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)

:: --- cloudflared (download once if missing) ---
if not exist "%CF_EXE%" (
    echo [SETUP] Downloading cloudflared ...
    if not exist "%CF_DIR%" mkdir "%CF_DIR%"
    curl -sSL -o "%CF_EXE%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    if not exist "%CF_EXE%" (
        echo [ERROR] cloudflared download failed.
        pause
        exit /b 1
    )
)

:: --- Host Simulator (skip if port 8000 is already in use) ---
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if %errorlevel% equ 0 (
    echo [WARN] Port 8000 is already in use - reusing the running simulator.
    echo        Its QueryTrade mode may differ from "%QUERY_MODE%".
    echo        Close that window and rerun this script to change the mode.
) else (
    echo [START] Host Simulator  ^(trade=hang, query=%QUERY_MODE%^)
    start "ECPay SCP Host Simulator" cmd /k python -u host_simulator.py --port 8000 --ws-port 8001 --ecpay-trade hang --ecpay-query %QUERY_MODE%
)

:: --- Cloudflare tunnel ---
:: one log per run, so a stale URL from the previous tunnel is never read
taskkill /im cloudflared.exe /f >nul 2>&1
ping -n 3 127.0.0.1 >nul
del /q "%CF_DIR%\tunnel*.log" >nul 2>&1
set "CF_LOG=%CF_DIR%\tunnel_%RANDOM%%RANDOM%.log"
echo [START] Cloudflare tunnel -^> http://127.0.0.1:8000
start "Cloudflare Tunnel (keep open)" /min cmd /c ""%CF_EXE%" tunnel --no-autoupdate --url http://127.0.0.1:8000 > "%CF_LOG%" 2>&1"

set "URL="
for /l %%i in (1,1,30) do (
    if not defined URL (
        ping -n 2 127.0.0.1 >nul
        for /f "delims=" %%u in ('powershell -NoProfile -Command "if (Test-Path '%CF_LOG%') { (Select-String -Path '%CF_LOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value }"') do set "URL=%%u"
    )
)

if not defined URL (
    echo [ERROR] Tunnel URL not found. See %CF_LOG%
    pause
    exit /b 1
)

echo !URL!/| clip
echo.
echo ===================================================================
echo   Set the terminal (SCP) host URL to:
echo.
echo       !URL!/
echo.
echo   ^(copied to clipboard^)
echo.
echo   Then run a scan-pay sale. Expected in the simulator window:
echo     GenPaymentCode -^> hang -^> SCP disconnects (~30s)
echo     -^> "QueryTrade" received -^> reply %QUERY_MODE%
echo.
echo   The URL changes every time this script runs.
echo   Restore the terminal host URL to ECPay stage after testing.
echo ===================================================================
echo.
pause
