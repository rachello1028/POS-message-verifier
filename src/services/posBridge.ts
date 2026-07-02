import type { PosBridgeStatus } from '../types';

const DEFAULT_POS_BRIDGE_URL = 'ws://127.0.0.1:8766';

export interface PosBridgeCallbacks {
  onStatus: (status: PosBridgeStatus) => void;
  onStepProgress: (stepId: string, stage: string, message: string) => void;
  onStepResult: (result: PosStepResult) => void;
  onError: (msg: string) => void;
}

export interface PosStepResult {
  success: boolean;
  msg?: string;
  authCode: string;
  rrn: string;
  traceNumber: string;
  txDate: string;
  logData: Record<string, string>;
  verifyResults: Array<{ rule: string; expected: string; actual: string; passed: boolean }>;
  screenshot: string | null;
  logVerified: boolean;
}

export class PosBridge {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: PosBridgeCallbacks;
  private status: PosBridgeStatus = { connected: false, devices: [] };

  constructor(callbacks: PosBridgeCallbacks, url?: string) {
    this.callbacks = callbacks;
    this.url = url ?? DEFAULT_POS_BRIDGE_URL;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.status = { ...this.status, connected: true };
        this.callbacks.onStatus(this.status);
        this.send({ command: 'list_devices' });
      };
      this.ws.onclose = () => {
        this.status = { connected: false, devices: [] };
        this.callbacks.onStatus(this.status);
      };
      this.ws.onerror = () => {
        this.callbacks.onError('無法連線 POS Auto Bridge (ws://localhost:8766)');
      };
      this.ws.onmessage = (e) => this.handleMessage(e);
    } catch (err) {
      this.callbacks.onError(String(err));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  listDevices(): void {
    this.send({ command: 'list_devices' });
  }

  connectDevice(serial: string): void {
    this.send({ command: 'connect_device', serial });
  }

  executePosStep(stepId: string, action: Record<string, unknown>): void {
    this.send({
      command: 'execute_pos_step',
      stepId,
      data: action,
    });
  }

  stopStep(stepId: string): void {
    this.send({ command: 'stop_step', stepId });
  }

  private handleMessage(e: MessageEvent): void {
    try {
      const data = JSON.parse(e.data as string);

      switch (data.type) {
        case 'devices':
          this.status = { ...this.status, devices: data.data ?? [] };
          this.callbacks.onStatus(this.status);
          break;
        case 'device_connected':
          this.status = { ...this.status, activeDevice: data.serial };
          this.callbacks.onStatus(this.status);
          break;
        case 'step_progress':
          this.callbacks.onStepProgress(
            data.stepId ?? '',
            data.stage ?? '',
            data.message ?? '',
          );
          break;
        case 'step_result':
          this.callbacks.onStepResult({
            success: data.success ?? false,
            msg: data.msg,
            authCode: data.authCode ?? '',
            rrn: data.rrn ?? '',
            traceNumber: data.traceNumber ?? '',
            txDate: data.txDate ?? '',
            logData: data.logData ?? {},
            verifyResults: data.verifyResults ?? [],
            screenshot: data.screenshot ?? null,
            logVerified: data.logVerified ?? true,
          });
          break;
        case 'pong':
          break;
        case 'error':
          this.callbacks.onError(data.message ?? '未知錯誤');
          break;
      }
    } catch {
      // ignore non-JSON
    }
  }
}
