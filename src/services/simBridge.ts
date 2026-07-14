/**
 * SimBridge — WebSocket 客戶端，連接 Host Simulator (port 8001)
 */

export interface SimTransaction {
  tx_id: number;
  timestamp: string;
  mti: string;
  bank: string | null;
  tx_name: string | null;
  req_fields: Record<string, string>;
  resp_fields: Record<string, string>;
  response_code: string;
  req_hex: string;
  resp_hex: string;
}

export interface SimStatus {
  connected: boolean;
  tcp_port: number;
  has_tpdu: boolean;
  mti_encoding: string;
  default_rc: string;
  host_ip: string;
  delay: number;
  timeout_mode: string;
  field_overrides: Record<string, string>;
}

export interface SimConnection {
  address: string;
  action: 'connected' | 'disconnected';
}

interface SimBridgeCallbacks {
  onStatus: (status: 'connected' | 'connecting' | 'disconnected' | 'error') => void;
  onSimStatus: (s: SimStatus) => void;
  onTransaction: (tx: SimTransaction) => void;
  onConnection: (conn: SimConnection) => void;
  onConfigUpdated: (cfg: Record<string, unknown>) => void;
}

export class SimBridge {
  private ws: WebSocket | null = null;
  private callbacks: SimBridgeCallbacks;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTx: Map<number, Partial<SimTransaction>> = new Map();

  constructor(callbacks: SimBridgeCallbacks, url: string = 'ws://127.0.0.1:8001') {
    this.callbacks = callbacks;
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.callbacks.onStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.callbacks.onStatus('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.callbacks.onStatus('connected');
      this.startPing();
    };

    this.ws.onclose = () => {
      this.callbacks.onStatus('disconnected');
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.callbacks.onStatus('error');
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        this.handleMessage(data);
      } catch { /* ignore */ }
    };
  }

  disconnect() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onStatus('disconnected');
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ command: 'ping' });
    }, 25000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(data: Record<string, unknown>) {
    const type = data.type as string;

    if (type === 'sim_status') {
      this.callbacks.onSimStatus({
        connected: true,
        tcp_port: data.tcp_port as number,
        has_tpdu: data.has_tpdu as boolean,
        mti_encoding: data.mti_encoding as string,
        default_rc: data.default_rc as string,
        host_ip: (data.host_ip as string) || '127.0.0.1',
        delay: (data.delay as number) ?? 0.1,
        timeout_mode: (data.timeout_mode as string) ?? 'none',
        field_overrides: (data.field_overrides as Record<string, string>) ?? {},
      });
    } else if (type === 'request') {
      const txId = data.tx_id as number;
      this.pendingTx.set(txId, {
        tx_id: txId,
        timestamp: data.timestamp as string,
        mti: data.mti as string,
        bank: (data.bank as string) || null,
        tx_name: (data.tx_name as string) || null,
        req_fields: data.fields as Record<string, string>,
        req_hex: data.raw_hex as string,
      });
    } else if (type === 'response') {
      const txId = data.tx_id as number;
      const pending = this.pendingTx.get(txId);
      if (pending) {
        this.pendingTx.delete(txId);
        const tx: SimTransaction = {
          tx_id: pending.tx_id!,
          timestamp: pending.timestamp!,
          mti: pending.mti!,
          bank: pending.bank ?? null,
          tx_name: pending.tx_name ?? null,
          req_fields: pending.req_fields ?? {},
          resp_fields: data.fields as Record<string, string>,
          response_code: data.response_code as string,
          req_hex: pending.req_hex ?? '',
          resp_hex: data.raw_hex as string,
        };
        this.callbacks.onTransaction(tx);
      }
    } else if (type === 'connection') {
      this.callbacks.onConnection({
        address: data.address as string,
        action: data.action as 'connected' | 'disconnected',
      });
    } else if (type === 'config_updated') {
      this.callbacks.onConfigUpdated(data);
    } else if (type === 'error') {
      // parse error from simulator
      const partial: SimTransaction = {
        tx_id: data.tx_id as number,
        timestamp: new Date().toLocaleTimeString(),
        mti: '????',
        bank: null,
        tx_name: `[ERROR] ${data.message}`,
        req_fields: {},
        resp_fields: {},
        response_code: 'ERR',
        req_hex: (data.raw_hex as string) || '',
        resp_hex: '',
      };
      this.callbacks.onTransaction(partial);
    }
  }

  setResponseCode(code: string) {
    this.send({ command: 'set_response_code', code });
  }

  setOverride(key: string, code: string) {
    this.send({ command: 'set_override', key, code });
  }

  setDelay(delay: number) {
    this.send({ command: 'set_delay', delay });
  }

  setTimeout(mode: string, count?: number) {
    this.send({ command: 'set_timeout', mode, count: count ?? 1 });
  }

  setFieldOverrides(fields: Record<string, string>) {
    this.send({ command: 'set_field_overrides', fields });
  }
}
