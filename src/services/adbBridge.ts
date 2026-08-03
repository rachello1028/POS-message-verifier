import type { AllRules, ConnectionStatus, TransactionResult, TransactionStep, StepResult } from '../types';
import { parseIsoLog, verifyMessage } from './isoVerifier';

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:9999';

export interface BridgeCallbacks {
  onStatus: (status: ConnectionStatus, msg?: string) => void;
  onDevices: (devices: string[]) => void;
  onRules: (rules: AllRules) => void;
  onRulesSaved: () => void;
  onTransaction: (tx: TransactionResult) => void;
  onError: (msg: string) => void;
  onLogcatExited?: () => void;
}

const HEARTBEAT_INTERVAL_MS = 25_000;  // 每 25 秒送一次 ping
const HEARTBEAT_TIMEOUT_MS  = 10_000;  // 等不到 pong 就強制重連
const RECONNECT_DELAY_MS    =  3_000;

export class AdbBridge {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: BridgeCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount = 0;
  private static readonly MAX_RECONNECTS = 3;

  // 多段式交易狀態
  private pendingSteps: TransactionStep[] = [];
  private currentStepIdx = 0;
  private accumulatedStepResults: StepResult[] = [];
  private txCounter = 0;
  private currentBank = '';
  private currentTransType = '';

  // Log 緩衝（收集一段完整電文 REQ+RSP）
  private logBuffer: string[] = [];
  private isCapturing = false;

  constructor(callbacks: BridgeCallbacks, url?: string) {
    this.callbacks = callbacks;
    this.url = url ?? DEFAULT_BRIDGE_URL;
  }

  connect(probe = false): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.reconnectCount = 0;
    if (!probe) this.callbacks.onStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.callbacks.onStatus('connected', 'ADB Bridge 連線成功');
        this.startHeartbeat();
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (probe) {
          this.callbacks.onStatus('disconnected');
        } else {
          this.callbacks.onStatus('disconnected', '連線已中斷');
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.stopHeartbeat();
        if (!probe) {
          this.callbacks.onStatus('error', '無法連線至 ADB Bridge (請確認 python adb_bridge.py 已執行)');
        }
      };

      this.ws.onmessage = (e) => this.handleMessage(e);
    } catch (err) {
      if (!probe) this.callbacks.onStatus('error', String(err));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectCount++;
    if (this.reconnectCount > AdbBridge.MAX_RECONNECTS) {
      this.callbacks.onStatus('error', `重連失敗 ${AdbBridge.MAX_RECONNECTS} 次，已停止自動重連`);
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.callbacks.onStatus('connecting');
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectCount = 0;
          this.callbacks.onStatus('connected', 'ADB Bridge 連線成功');
          this.startHeartbeat();
        };
        this.ws.onclose = () => {
          this.stopHeartbeat();
          this.callbacks.onStatus('disconnected', '連線已中斷');
          this.scheduleReconnect();
        };
        this.ws.onerror = () => {
          this.stopHeartbeat();
          // onclose 會緊接著觸發，由 onclose 負責呼叫 scheduleReconnect
        };
        this.ws.onmessage = (e) => this.handleMessage(e);
      } catch (err) {
        this.callbacks.onStatus('error', String(err));
      }
    }, RECONNECT_DELAY_MS);
  }

  // ── 心跳 (防殭屍連線) ───────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }
      // 送出 JSON ping
      this.ws.send(JSON.stringify({ command: 'ping' }));
      // 若 10 秒內沒收到 pong → 視為殭屍連線，強制關閉重連
      this.pongTimer = setTimeout(() => {
        console.warn('[Bridge] Heartbeat timeout — 強制重連');
        this.ws?.close();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.pongTimer)      { clearTimeout(this.pongTimer);       this.pongTimer = null; }
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ── 公開命令 ────────────────────────────────────────────────────────────────

  refreshDevices(): void {
    this.send({ command: 'get_devices' });
  }

  startLogcat(device: string): void {
    this.send({ command: 'start_logcat', device });
  }

  stopLogcat(): void {
    this.send({ command: 'stop_logcat' });
  }

  saveRules(rules: AllRules): void {
    this.send({ command: 'save_rules', data: rules });
  }

  setTxCounter(n: number): void {
    this.txCounter = n;
  }

  /** 設定要監測的交易（告知 bridge 當前銀行/交易種類及步驟） */
  setTestTarget(bank: string, transType: string, steps: TransactionStep[]): void {
    this.currentBank = bank;
    this.currentTransType = transType;
    this.pendingSteps = steps;
    // 全部重置，避免舊次殘留狀態影響新一次
    this.currentStepIdx = 0;
    this.accumulatedStepResults = [];
    this.logBuffer = [];
    this.isCapturing = false;
  }

  resetTransaction(): void {
    this.currentStepIdx = 0;
    this.accumulatedStepResults = [];
    this.logBuffer = [];
    this.isCapturing = false;
  }

  // ── 訊息處理 ────────────────────────────────────────────────────────────────

  private handleMessage(e: MessageEvent): void {
    try {
      const data = JSON.parse(e.data as string);

      switch (data.type) {
        case 'status':
          this.callbacks.onStatus(data.status as ConnectionStatus, data.message as string);
          break;
        case 'devices':
          this.callbacks.onDevices(data.data as string[]);
          break;
        case 'rules':
          this.callbacks.onRules(data.data as AllRules);
          break;
        case 'rules_saved':
          this.callbacks.onRulesSaved();
          break;
        case 'pong':
          // 收到 pong：清除 pongTimer，心跳正常
          if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
          break;
        case 'logcat_started':
          console.log('[Bridge] Logcat started on device:', data.device);
          break;
        case 'logcat_stopped':
          console.log('[Bridge] Logcat stopped');
          break;
        case 'logcat_exited':
          console.warn('[Bridge] Logcat process exited unexpectedly');
          this.callbacks.onLogcatExited?.();
          break;
        case 'logcat':
          this.processLogLine(data.message as string);
          break;
        case 'error':
          this.callbacks.onError(data.message as string);
          break;
      }
    } catch {
      // 非 JSON 訊息，忽略
    }
  }

  /**
   * 逐行處理 logcat
   * 對齊原始 Python 邏輯：一個 buffer 從 REAL SEND DATA Pack START
   * 一直收集到 RECEIVE DATA UnPack END 才 flush，包含 REQ+RSP 兩個區塊
   */
  private processLogLine(line: string): void {
    if (line.includes('REAL SEND DATA Pack START')) {
      this.isCapturing = true;
      this.logBuffer = [line];
      return;
    }

    if (this.isCapturing) {
      this.logBuffer.push(line);

      if (line.includes('RECEIVE DATA UnPack END')) {
        this.isCapturing = false;
        const rawLog = this.logBuffer.join('\n');
        const parsed = parseIsoLog(rawLog);
        this.logBuffer = [];
        this.evaluateBuffer(parsed, rawLog);
      }
    }
  }

  private evaluateBuffer(parsed: Record<string, string>, rawLog?: string): void {
    if (this.pendingSteps.length === 0) return;
    const actualMti = (parsed['REQ_.MTI'] ?? '').replace('0x', '').trim();
    const expectedStep = this.pendingSteps[this.currentStepIdx];
    const expectedMti = expectedStep.mti.trim();

    // MTI 不符合這一步
    if (actualMti && !actualMti.includes(expectedMti)) {
      // 檢查是否是新的一筆交易開始（MTI 符合第一步驟）
      const firstStepMti = this.pendingSteps[0].mti.trim();
      if (actualMti.includes(firstStepMti)) {
        // 如果之前有累積的結果，先輸出為未完成的交易
        if (this.accumulatedStepResults.length > 0) {
          this.txCounter++;
          const tx: TransactionResult = {
            id: this.txCounter,
            timestamp: new Date().toLocaleTimeString('zh-TW'),
            bank: this.currentBank,
            transactionType: this.currentTransType,
            pass: false,
            steps: [...this.accumulatedStepResults],
          };
          this.callbacks.onTransaction(tx);
        }
        // 重置並重新評估
        this.currentStepIdx = 0;
        this.accumulatedStepResults = [];
        // 遞迴呼叫自己來處理這筆新交易
        this.evaluateBuffer(parsed, rawLog);
        return;
      }
      return;
    }

    const { pass, results } = verifyMessage(parsed, expectedStep.fields);

    const pan = parsed['REQ_2'] ?? parsed['2'] ?? '';
    const rawEntryMode = parsed['REQ_62_TAG_01'] ?? parsed['REQ_62_01'] ?? parsed['REQ_22'] ?? parsed['22'] ?? '';
    const rawCardType = parsed['REQ_62_TAG_02'] ?? parsed['REQ_62_02'] ?? '';
    const stepResult: StepResult = {
      stepName: expectedStep.step_name,
      mti: actualMti || expectedMti,
      pass,
      fields: results,
      auth: parsed['RSP_38'] ?? parsed['38'] ?? '—',
      rrn: parsed['RSP_37'] ?? parsed['37'] ?? '—',
      trace: this.extractTrace(parsed),
      pcode: parsed['REQ_3'] ?? parsed['3'] ?? '',
      entryMode: this.normalizeEntryMode(this.parseHexLabel(rawEntryMode)),
      cardBrand: rawCardType
        ? this.mapCardType(this.parseHexLabel(rawCardType))
        : this.detectCardBrand(pan, this.currentTransType),
      rawLog: rawLog ?? '',
    };

    this.accumulatedStepResults.push(stepResult);
    this.currentStepIdx++;

    // 所有步驟都完成
    if (this.currentStepIdx >= this.pendingSteps.length) {
      this.txCounter++;
      const allPass = this.accumulatedStepResults.every(s => s.pass);

      const tx: TransactionResult = {
        id: this.txCounter,
        timestamp: new Date().toLocaleTimeString('zh-TW'),
        bank: this.currentBank,
        transactionType: this.currentTransType,
        pass: allPass,
        steps: [...this.accumulatedStepResults],
      };

      this.callbacks.onTransaction(tx);

      // 重置，等待下一筆交易
      this.currentStepIdx = 0;
      this.accumulatedStepResults = [];
    }
  }

  private parseHexLabel(raw: string): string {
    const m = raw.match(/\(([^)]+)\)/);
    return m ? m[1] : raw;
  }

  private normalizeEntryMode(raw: string): string {
    if (/^[A-Z]$/i.test(raw)) return raw;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 3) {
      const panMode = digits.substring(digits.length - 3, digits.length - 1);
      const modeMap: Record<string, string> = {
        '01': 'M', '02': 'S', '05': 'C', '07': 'W',
        '51': 'W', '80': 'F', '90': 'S', '91': 'W',
      };
      if (modeMap[panMode]) return modeMap[panMode];
    }
    return raw;
  }

  private mapCardType(code: string): string {
    const map: Record<string, string> = {
      V: 'V', M: 'M', J: 'J', A: 'AMEX',
      U: 'CUP', D: 'Discover', N: 'NCC',
    };
    return map[code] ?? code;
  }

  private detectCardBrand(pan: string, transType?: string): string {
    if (transType) {
      if (/smartpay/i.test(transType)) return 'SP';
      if (/銀聯/.test(transType)) return 'CUP';
    }
    const p = pan.replace(/\s/g, '');
    if (!p || p.length < 4) return '';
    if (p.startsWith('4')) return 'V';
    const two = parseInt(p.substring(0, 2), 10);
    if (two >= 51 && two <= 55) return 'M';
    const four = parseInt(p.substring(0, 4), 10);
    if (four >= 2221 && four <= 2720) return 'M';
    if (p.startsWith('35')) return 'J';
    if (p.startsWith('34') || p.startsWith('37')) return 'AMEX';
    if (p.startsWith('62') || p.startsWith('81')) return 'CUP';
    return '';
  }

  private extractTrace(parsed: Record<string, string>): string {
    const tagKey = Object.keys(parsed).find(k =>
      /^REQ_62_TAG_04\b/.test(k) || /^REQ_62_04\b/.test(k)
    );
    if (tagKey) {
      const raw = parsed[tagKey];
      const m = raw.match(/\(([^)]+)\)/);
      if (m) return m[1];
      return raw;
    }
    const f11 = parsed['REQ_11'] ?? parsed['11'];
    if (f11) return f11;
    return '—';
  }
}
