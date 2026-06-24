#!/usr/bin/env python3
"""
POS 電文驗証工具 - ADB WebSocket Bridge
功能：
1. 透過 WebSocket 串流 ADB logcat 輸出
2. 管理 pos_rules.json 規格設定檔
3. 列出已連接的 ADB 設備

使用方式:
    pip install websockets
    python adb_bridge.py           # 預設 Port 8765
    python adb_bridge.py --port 9000  # 自訂 Port
"""

import asyncio
import json
import subprocess
import websockets
import sys
import os
import re
import shutil
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8765, help='WebSocket 監聽埠號')
args = parser.parse_args()
LISTEN_PORT = args.port
RULES_FILE = os.path.join(os.path.dirname(__file__), "pos_rules.json")

connected_clients: set = set()
logcat_process = None

# ─── ADB 路徑偵測 ───────────────────────────────────────────────────────────────

def find_adb() -> str:
    """偵測 ADB 可執行檔的完整路徑"""
    # 1. 先查 PATH
    found = shutil.which('adb')
    if found:
        return found

    # 2. 常見安裝位置（Windows）
    candidates = []
    userprofile = os.environ.get('USERPROFILE', '')
    localappdata = os.environ.get('LOCALAPPDATA', '')
    if userprofile:
        candidates += [
            os.path.join(userprofile, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
        ]
    if localappdata:
        candidates += [
            os.path.join(localappdata, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
        ]
    # Android Studio 預設路徑
    candidates += [
        r'C:\Users\{}\AppData\Local\Android\Sdk\platform-tools\adb.exe'.format(os.environ.get('USERNAME', '')),
        r'C:\Android\platform-tools\adb.exe',
        r'C:\Program Files\Android\platform-tools\adb.exe',
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c

    return 'adb'  # 最後回退，讓 subprocess 自己找

ADB_PATH = find_adb()

# ISO 電文關鍵字過濾
# 注意：使用短字串匹配，不依賴 = 號數量，避免版本差異導致漏抓
INCLUDE_PATTERNS = [
    'REAL SEND DATA Pack',  # REQ 區塊 START / END
    'RECEIVE DATA UnPack',  # RSP 區塊 START / END
    'Field',                # ISO Field 行
    'Tag',                  # EMV Tag 行
    ':[',                   # 補抓沒有 Field/Tag 前綴的 Sub-field 行 (如 M6:[1]Y)
]

DEFAULT_RULES = {
    "預設銀行": {
        "一般銷售 (Sale)": {
            "type": "multi-step",
            "steps": [
                {
                    "step_name": "主交易",
                    "mti": "0200",
                    "fields": [
                        {"id": "REQ_3",  "name": "Processing Code",    "expected": "000000"},
                        {"id": "REQ_4",  "name": "Amount",             "expected": "NOT_NULL"},
                        {"id": "REQ_25", "name": "POS Condition Code", "expected": "99"},
                        {"id": "RSP_39", "name": "Response Code",      "expected": "00"}
                    ]
                }
            ]
        },
        "晶片一般銷售": {
            "type": "multi-step",
            "steps": [
                {
                    "step_name": "主交易",
                    "mti": "0200",
                    "fields": [
                        {"id": "REQ_3",  "name": "Processing Code",    "expected": "000000"},
                        {"id": "REQ_4",  "name": "Amount",             "expected": "NOT_NULL"},
                        {"id": "REQ_25", "name": "POS Condition Code", "expected": "99"},
                        {"id": "REQ_55", "name": "Chip data",          "expected": "NOT_NULL"},
                        {"id": "RSP_39", "name": "Response Code",      "expected": "00"}
                    ]
                },
                {
                    "step_name": "TC Upload (0220)",
                    "mti": "0220",
                    "fields": [
                        {"id": "REQ_3",  "name": "Processing Code", "expected": "250000"},
                        {"id": "REQ_55", "name": "Chip data",       "expected": "NOT_NULL"},
                        {"id": "RSP_39", "name": "Response Code",   "expected": "00"}
                    ]
                }
            ]
        }
    }
}


# ─── 規格檔管理 ───────────────────────────────────────────────────────────────

def load_rules() -> dict:
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] 讀取規格檔失敗: {e}，使用預設值")
    save_rules(DEFAULT_RULES)
    return DEFAULT_RULES


def save_rules(rules: dict) -> None:
    content = json.dumps(rules, ensure_ascii=False, indent=4)
    with open(RULES_FILE, 'w', encoding='utf-8') as f:
        f.write(content)


# ─── ADB 工具 ─────────────────────────────────────────────────────────────────

def get_devices() -> list[str]:
    try:
        result = subprocess.run(
            [ADB_PATH, 'devices'],
            capture_output=True, text=True, timeout=5
        )
        devices = []
        for line in result.stdout.strip().split('\n')[1:]:
            parts = line.strip().split()
            if len(parts) == 2 and parts[1] == 'device':
                devices.append(parts[0])
        return devices
    except Exception as e:
        print(f"[WARN] ADB devices error: {e}")
        return []


# ─── Logcat 串流 ──────────────────────────────────────────────────────────────

async def start_logcat(device_id: str = '') -> None:
    global logcat_process

    # 先關掉舊的
    if logcat_process:
        try:
            logcat_process.terminate()
            await asyncio.sleep(0.3)
        except Exception:
            pass
        logcat_process = None

    cmd = [ADB_PATH]
    if device_id:
        cmd += ['-s', device_id]
    cmd += ['logcat', '-v', 'threadtime']

    try:
        logcat_process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        print(f"[INFO] Logcat 開始 (device: {device_id or 'default'})")

        while True:
            if logcat_process is None:
                break
            line = await logcat_process.stdout.readline()
            if not line:
                break

            decoded = line.decode('utf-8', errors='ignore').strip()
            if decoded and any(p in decoded for p in INCLUDE_PATTERNS):
                await broadcast(json.dumps({'type': 'logcat', 'message': decoded}))

    except Exception as e:
        print(f"[ERROR] Logcat error: {e}")
        await broadcast(json.dumps({'type': 'error', 'message': str(e)}))


async def stop_logcat() -> None:
    global logcat_process
    if logcat_process:
        try:
            logcat_process.terminate()
        except Exception:
            pass
        logcat_process = None
    print("[INFO] Logcat 已停止")


# ─── WebSocket ────────────────────────────────────────────────────────────────

async def broadcast(message: str) -> None:
    if not connected_clients:
        return
    dead = set()
    for client in connected_clients:
        try:
            await client.send(message)
        except Exception:
            dead.add(client)
    connected_clients.difference_update(dead)


async def handle_client(websocket, path=None) -> None:
    connected_clients.add(websocket)
    print(f"[INFO] 客戶端連線 ({len(connected_clients)} 個)")

    # 送出歡迎訊息 + 初始資料
    await websocket.send(json.dumps({
        'type': 'status', 'status': 'connected',
        'message': 'ADB Bridge 已連線'
    }))
    await websocket.send(json.dumps({
        'type': 'rules', 'data': load_rules()
    }))
    loop = asyncio.get_event_loop()
    devs = await loop.run_in_executor(None, get_devices)
    await websocket.send(json.dumps({
        'type': 'devices', 'data': devs
    }))

    try:
        async for raw in websocket:
            try:
                data = json.loads(raw)
                cmd = data.get('command', '')

                if cmd != 'ping':
                    print(f"[CMD] 收到指令: {cmd}")

                if cmd == 'get_devices':
                    loop = asyncio.get_event_loop()
                    devs = await loop.run_in_executor(None, get_devices)
                    await websocket.send(json.dumps({
                        'type': 'devices', 'data': devs
                    }))

                elif cmd == 'get_rules':
                    await websocket.send(json.dumps({
                        'type': 'rules', 'data': load_rules()
                    }))

                elif cmd == 'save_rules':
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, save_rules, data.get('data', {}))
                    await websocket.send(json.dumps({
                        'type': 'rules_saved', 'message': '規格已儲存'
                    }))

                elif cmd == 'start_logcat':
                    device = data.get('device', '')
                    asyncio.create_task(start_logcat(device))
                    await websocket.send(json.dumps({
                        'type': 'logcat_started', 'device': device
                    }))

                elif cmd == 'stop_logcat':
                    await stop_logcat()
                    await websocket.send(json.dumps({
                        'type': 'logcat_stopped'
                    }))

                elif cmd == 'ping':
                    await websocket.send(json.dumps({'type': 'pong'}))

            except json.JSONDecodeError:
                pass
            except Exception as e:
                print(f"[ERROR] 處理命令失敗: {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[INFO] 客戶端離線 ({len(connected_clients)} 個)")


# ─── Port 檢測 ────────────────────────────────────────────────────────────────

def is_port_in_use(port: int) -> bool:
    """檢測指定 port 是否被佔用"""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except OSError:
            return True


def find_available_port(start_port: int, max_tries: int = 10) -> int:
    """從 start_port 開始找可用的 port"""
    for i in range(max_tries):
        port = start_port + i
        if not is_port_in_use(port):
            return port
    return -1


# ─── 主程式 ───────────────────────────────────────────────────────────────────

async def main() -> None:
    global LISTEN_PORT
    
    # 檢測 port 是否被佔用
    if is_port_in_use(LISTEN_PORT):
        print(f"[警告] Port {LISTEN_PORT} 已被佔用！")
        print("       可能是之前的 Bridge 還在運行。")
        print()
        
        # 嘗試找下一個可用的 port
        new_port = find_available_port(LISTEN_PORT + 1)
        if new_port > 0:
            print(f"[提示] 找到可用的 Port: {new_port}")
            user_input = input(f"       是否使用 Port {new_port}？(Y/N，預設 Y): ").strip().upper()
            if user_input != 'N':
                LISTEN_PORT = new_port
            else:
                print("[提示] 請手動關閉佔用 Port 的程式後重試。")
                print("       可嘗試: taskkill /F /IM python.exe")
                input("按 Enter 結束...")
                return
        else:
            print("[錯誤] 找不到可用的 Port，請手動關閉佔用的程式。")
            print("       可嘗試: taskkill /F /IM python.exe")
            input("按 Enter 結束...")
            return
    
    print("=" * 50)
    print("  POS 電文驗証工具 - ADB WebSocket Bridge")
    print(f"  監聽埠: ws://127.0.0.1:{LISTEN_PORT}")
    print(f"  規格檔: {RULES_FILE}")
    print(f"  ADB   : {ADB_PATH}")
    # 檢測 ADB 是否可用
    try:
        r = subprocess.run([ADB_PATH, 'version'], capture_output=True, text=True, timeout=5)
        ver_line = r.stdout.split('\n')[0].strip()
        print(f"  {ver_line}")
        devs = get_devices()
        print(f"  目前債測到設備: {devs if devs else '(無)'} ")
    except FileNotFoundError:
        print("  [WARN] 找不到 adb，請確認 Android SDK platform-tools 已加入 PATH")
    print("=" * 50)
    print("按 Ctrl+C 停止服務\n")

    async with websockets.serve(
        handle_client, '127.0.0.1', LISTEN_PORT,
        ping_interval=20,   # 每 20 秒發一次 WS 協定層 ping
        ping_timeout=10,    # 10 秒內沒收到 pong 就強制關閉連線
    ):
        await asyncio.Future()  # 永久執行


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[INFO] 服務已停止")
