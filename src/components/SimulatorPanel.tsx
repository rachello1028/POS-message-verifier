import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server, Wifi, WifiOff, Loader2, ChevronDown, ChevronRight,
  Trash2, ArrowDownLeft, ArrowUpRight, CircleDot, Zap, Copy,
  Check, Settings2, AlertTriangle, X, Download, Pencil,
  Terminal, CheckCircle2, MonitorSmartphone, Timer, TimerOff,
  Plus, Minus,
} from 'lucide-react';
import type { SimTransaction, SimStatus, SimBridge } from '../services/simBridge';

interface Props {
  simBridge: SimBridge | null;
  simConnStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  simStatus: SimStatus | null;
  transactions: SimTransaction[];
  posConnections: string[];
  onClearTransactions: () => void;
  simTcpPort: string;
  simWsPort: string;
  onPortChange: (tcpPort: string, wsPort: string) => void;
}

const FIELD_NAMES: Record<string, string> = {
  '2': 'PAN', '3': 'Processing Code', '4': 'Amount',
  '11': 'STAN', '12': 'Time', '13': 'Date', '14': 'Exp Date',
  '22': 'Entry Mode', '24': 'NII', '25': 'POS Condition',
  '35': 'Track II', '37': 'RRN', '38': 'Auth Code',
  '39': 'Response Code', '41': 'Terminal ID', '42': 'Merchant ID',
  '48': 'Store Msg', '49': 'Currency', '52': 'PIN Block',
  '54': 'Add Amount', '55': 'ICC Data', '59': 'Private',
  '60': 'Batch No', '62': 'Invoice', '63': 'Totals',
};

const RC_PRESETS: { code: string; label: string }[] = [
  { code: '00', label: '00 - 核准' },
  { code: '01', label: '01 - 請聯絡發卡行' },
  { code: '03', label: '03 - 無效商店' },
  { code: '05', label: '05 - 不予授權' },
  { code: '12', label: '12 - 無效交易' },
  { code: '13', label: '13 - 無效金額' },
  { code: '14', label: '14 - 無效卡號' },
  { code: '51', label: '51 - 餘額不足' },
  { code: '54', label: '54 - 卡片過期' },
  { code: '55', label: '55 - PIN 錯誤' },
  { code: '61', label: '61 - 超過限額' },
  { code: '91', label: '91 - 主機無回應' },
  { code: '96', label: '96 - 系統異常' },
];

const SIM_PS_SCRIPT = `$dir = Get-Location
$batPath = Join-Path $dir "start_simulator.bat"
$regPath = "HKCU:\\Software\\Classes\\pos-host-sim"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:POS Host Simulator Protocol"
Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
$cmdPath = Join-Path $regPath "shell\\open\\command"
New-Item -Path $cmdPath -Force | Out-Null
Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value ('"{0}" "%1"' -f $batPath)
Write-Host "Done! Host Simulator protocol registered." -ForegroundColor Green`;

const AVAILABLE_BANKS_FALLBACK = ['台新TSB', '彰銀CHB電子簽單', '彰銀CHB聚合支付', 'AE', 'GP'];

export default function SimulatorPanel({
  simBridge, simConnStatus, simStatus, transactions, posConnections,
  onClearTransactions, simTcpPort, simWsPort, onPortChange,
}: Props) {
  const [expandedTx, setExpandedTx] = useState<Set<number>>(new Set());
  const [selectedRC, setSelectedRC] = useState(simStatus?.default_rc ?? '00');
  const [showConfig, setShowConfig] = useState(false);
  const [copiedHex, setCopiedHex] = useState<number | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [isEditingPort, setIsEditingPort] = useState(false);
  const [portDraft, setPortDraft] = useState({ tcp: simTcpPort, ws: simWsPort });
  const [showIpModal, setShowIpModal] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedIpCmd, setCopiedIpCmd] = useState(false);
  const [delayValue, setDelayValue] = useState(simStatus?.delay ?? 0.1);
  const [timeoutMode, setTimeoutMode] = useState(simStatus?.timeout_mode ?? 'none');
  const [timeoutCount, setTimeoutCount] = useState(1);
  const [fieldOverrides, setFieldOverrides] = useState<{ fid: string; val: string }[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeBank, setActiveBank] = useState<string | null>(simStatus?.active_bank ?? null);
  const [availableBanks, setAvailableBanks] = useState<string[]>(
    simStatus?.available_banks?.length ? simStatus.available_banks : AVAILABLE_BANKS_FALLBACK
  );
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (simStatus?.default_rc) setSelectedRC(simStatus.default_rc);
  }, [simStatus?.default_rc]);

  useEffect(() => {
    if (simStatus?.delay !== undefined) setDelayValue(simStatus.delay);
  }, [simStatus?.delay]);

  useEffect(() => {
    if (simStatus?.timeout_mode) setTimeoutMode(simStatus.timeout_mode);
  }, [simStatus?.timeout_mode]);

  useEffect(() => {
    if (simStatus?.field_overrides) {
      const entries = Object.entries(simStatus.field_overrides).map(([fid, val]) => ({ fid, val }));
      if (entries.length > 0) setFieldOverrides(entries);
    }
  }, [simStatus?.field_overrides]);

  useEffect(() => {
    if (simStatus?.active_bank !== undefined) setActiveBank(simStatus.active_bank);
  }, [simStatus?.active_bank]);

  useEffect(() => {
    if (simStatus?.available_banks?.length) setAvailableBanks(simStatus.available_banks);
  }, [simStatus?.available_banks]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transactions.length]);

  const toggleExpand = useCallback((txId: number) => {
    setExpandedTx(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  }, []);

  const handleRCChange = useCallback((code: string) => {
    setSelectedRC(code);
    simBridge?.setResponseCode(code);
  }, [simBridge]);

  const handleLaunch = useCallback(() => {
    setIsLaunching(true);
    const a = document.createElement('a');
    a.href = `pos-host-sim://run?port=${simTcpPort}&wsport=${simWsPort}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      setIsLaunching(false);
      setTimeout(() => {
        if (simConnStatus !== 'connected') {
          setShowSetupModal(true);
        }
      }, 3000);
    }, 2500);
  }, [simTcpPort, simWsPort, simConnStatus]);

  const handleConfirmPort = useCallback(() => {
    const tcp = portDraft.tcp.trim().replace(/\D/g, '');
    const ws = portDraft.ws.trim().replace(/\D/g, '');
    if (tcp && ws) {
      onPortChange(tcp, ws);
      setIsEditingPort(false);
    }
  }, [portDraft, onPortChange]);

  const copyScript = useCallback(() => {
    navigator.clipboard.writeText(SIM_PS_SCRIPT).then(() => {
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    }).catch(() => {});
  }, []);

  const copyHex = useCallback((text: string, txId: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedHex(txId);
      setTimeout(() => setCopiedHex(null), 1500);
    }).catch(() => {});
  }, []);

  const handleShowIp = useCallback(() => {
    setShowIpModal(true);
  }, []);

  const copyIpInfo = useCallback(() => {
    const ip = simStatus?.host_ip;
    if (!ip || ip === '127.0.0.1') return;
    navigator.clipboard.writeText(`${ip}:${simTcpPort}`).then(() => {
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    }).catch(() => {});
  }, [simStatus, simTcpPort]);

  const IP_CMD = `powershell -c "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notmatch 'Loopback'} | Select-Object -First 1).IPAddress"`;

  const copyIpCmd = useCallback(() => {
    navigator.clipboard.writeText(IP_CMD).then(() => {
      setCopiedIpCmd(true);
      setTimeout(() => setCopiedIpCmd(false), 2000);
    }).catch(() => {});
  }, [IP_CMD]);

  const handleDelayChange = useCallback((val: number) => {
    const clamped = Math.max(0, Math.round(val * 10) / 10);
    setDelayValue(clamped);
    simBridge?.setDelay(clamped);
  }, [simBridge]);

  const handleTimeoutChange = useCallback((mode: string, count?: number) => {
    setTimeoutMode(mode);
    if (count !== undefined) setTimeoutCount(count);
    simBridge?.setTimeout(mode, count ?? timeoutCount);
  }, [simBridge, timeoutCount]);

  const handleFieldOverrideApply = useCallback(() => {
    const map: Record<string, string> = {};
    for (const { fid, val } of fieldOverrides) {
      const trimmed = fid.trim();
      if (trimmed && val.trim()) map[trimmed] = val.trim();
    }
    simBridge?.setFieldOverrides(map);
  }, [simBridge, fieldOverrides]);

  const handleFieldOverrideClear = useCallback(() => {
    setFieldOverrides([]);
    simBridge?.setFieldOverrides({});
  }, [simBridge]);

  const handleBankChange = useCallback((bank: string) => {
    const value = bank === 'auto' ? null : bank;
    setActiveBank(value);
    simBridge?.setActiveBank(value);
  }, [simBridge]);

  const formatAmount = (raw: string): string => {
    if (!raw) return '?';
    const n = parseInt(raw, 10);
    if (isNaN(n)) return raw;
    return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  };

  const mtiLabel = (mti: string): string => {
    const map: Record<string, string> = {
      '0100': 'Auth REQ', '0110': 'Auth RSP',
      '0200': 'Sale REQ', '0210': 'Sale RSP',
      '0220': 'Advice REQ', '0230': 'Advice RSP',
      '0320': 'Batch REQ', '0330': 'Batch RSP',
      '0400': 'Reversal REQ', '0410': 'Reversal RSP',
      '0420': 'Reversal Adv REQ', '0430': 'Reversal Adv RSP',
      '0500': 'Settle REQ', '0510': 'Settle RSP',
      '0800': 'Network REQ', '0810': 'Network RSP',
    };
    return map[mti] ?? mti;
  };

  const hasSimIp = simStatus?.host_ip && simStatus.host_ip !== '127.0.0.1';

  const ipModalEl = showIpModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowIpModal(false)}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--fg)] flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-[var(--blue-ink)]" /> POS 連線位址
          </h2>
          <button onClick={() => setShowIpModal(false)} className="p-1 hover:bg-[var(--surface-3)] rounded-lg transition-colors text-[var(--fg-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[var(--fg-muted)]">請將 POS 端末機的主機連線位置改為：</p>

          {hasSimIp ? (
            <>
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-5 text-center space-y-3">
                <div className="text-2xl font-mono font-bold text-[var(--fg)] tracking-wide">
                  {simStatus!.host_ip}
                </div>
                <div className="text-base font-mono text-[var(--blue-ink)]">
                  Port: {simTcpPort}
                </div>
                <button onClick={copyIpInfo} className="btn-secondary text-xs flex items-center gap-1.5 mx-auto">
                  {copiedIp
                    ? <><Check className="w-3.5 h-3.5" /> 已複製！</>
                    : <><Copy className="w-3.5 h-3.5" /> 複製 IP:Port</>}
                </button>
              </div>
              <p className="text-xs text-[var(--emerald-ink)] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                IP 由 Host Simulator 自動偵測
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                <p className="text-sm text-[var(--fg)]">
                  啟動 Host Simulator 後會自動偵測並顯示本機 IP。
                </p>
                <p className="text-xs text-[var(--fg-subtle)]">
                  Port: <code className="bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono">{simTcpPort}</code>
                </p>
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                <p className="text-xs text-[var(--fg-muted)] font-medium">手動查詢本機 IP</p>
                <div className="relative">
                  <pre className="bg-[#0b0f19] text-[#38bdf8] p-3 rounded-lg text-[11px] font-mono overflow-x-auto border border-[#1e293b] pr-20">{IP_CMD}</pre>
                  <button
                    onClick={copyIpCmd}
                    className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-medium transition-colors bg-[#1e293b]/80 hover:bg-[#334155] text-slate-300"
                  >
                    {copiedIpCmd
                      ? <><Check className="w-3 h-3" /> 已複製</>
                      : <><Copy className="w-3 h-3" /> 複製</>}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--fg-subtle)]">
                  在終端機貼上執行，會印出本機 IPv4 位址
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end">
          <button onClick={() => setShowIpModal(false)} className="btn-secondary">關閉</button>
        </div>
      </div>
    </div>
  );

  // ── 未連線狀態 ────────────────────────────────────────────
  if (simConnStatus !== 'connected') {
    return (
      <div className="space-y-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--surface-3)] flex items-center justify-center">
            <Server className="w-8 h-8 text-[var(--fg-subtle)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--fg)]">Host Simulator 未連線</h3>
            <p className="text-sm text-[var(--fg-subtle)] mt-1">
              模擬銀行後台，接收 POS 端末機交易電文並自動回應
            </p>
          </div>

          {/* 啟動按鈕 */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleLaunch}
              disabled={isLaunching}
              className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLaunching
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 啟動中…</>
                : <><Zap className="w-4 h-4" /> 啟動 Host Simulator</>}
            </button>
            <button
              onClick={() => setShowSetupModal(true)}
              className="btn-secondary text-sm"
            >
              首次設定
            </button>
          </div>

          {/* 連線位址按鈕 */}
          <button
            onClick={handleShowIp}
            className="btn-secondary flex items-center gap-2 text-sm mx-auto"
          >
            <MonitorSmartphone className="w-4 h-4" /> POS 連線位址
          </button>

          {/* Port 資訊 */}
          <div className="flex items-center justify-center gap-4 text-xs text-[var(--fg-subtle)]">
            <span className="flex items-center gap-1">
              TCP Port:
              {isEditingPort ? (
                <>
                  <input type="text" inputMode="numeric" value={portDraft.tcp}
                    onChange={e => setPortDraft(p => ({ ...p, tcp: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleConfirmPort(); if (e.key === 'Escape') setIsEditingPort(false); }}
                    autoFocus
                    className="w-16 px-1.5 py-0.5 rounded text-xs font-mono text-center"
                  />
                </>
              ) : (
                <button onClick={() => { setPortDraft({ tcp: simTcpPort, ws: simWsPort }); setIsEditingPort(true); }}
                  className="font-mono text-[var(--fg)] underline decoration-dotted flex items-center gap-0.5">
                  {simTcpPort} <Pencil className="w-3 h-3" />
                </button>
              )}
            </span>
            <span className="flex items-center gap-1">
              WS Port:
              {isEditingPort ? (
                <>
                  <input type="text" inputMode="numeric" value={portDraft.ws}
                    onChange={e => setPortDraft(p => ({ ...p, ws: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleConfirmPort(); if (e.key === 'Escape') setIsEditingPort(false); }}
                    className="w-16 px-1.5 py-0.5 rounded text-xs font-mono text-center"
                  />
                  <button onClick={handleConfirmPort} className="text-[var(--emerald-ink)]">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <span className="font-mono text-[var(--fg)]">{simWsPort}</span>
              )}
            </span>
          </div>

          {simConnStatus === 'connecting' && (
            <div className="flex items-center justify-center gap-2 text-[var(--amber-ink)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 嘗試連線中…
            </div>
          )}

          {/* 替代方案 */}
          <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 text-left max-w-lg mx-auto">
            <p className="text-xs text-[var(--fg-muted)] font-medium mb-2">手動啟動（不需要註冊協定）</p>
            <code className="text-xs text-[var(--blue-ink)] font-mono block">
              python host_simulator.py --port {simTcpPort} --ws-port {simWsPort}
            </code>
          </div>
        </div>

        {/* ── 首次設定 Modal ────────────────────────────── */}
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowSetupModal(false)}>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <h2 className="text-base font-bold text-[var(--fg)] flex items-center gap-2">
                  <Server className="w-4 h-4 text-[var(--blue-ink)]" /> 首次設定：一鍵啟動 Host Simulator
                </h2>
                <button onClick={() => setShowSetupModal(false)} className="p-1 hover:bg-[var(--surface-3)] rounded-lg transition-colors text-[var(--fg-muted)]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-5 text-sm text-[var(--fg-muted)]">
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                  <p className="font-semibold text-[var(--fg)]">1. 下載檔案</p>
                  <p className="text-xs text-[var(--fg-subtle)]">將以下兩個檔案放在同一個資料夾：</p>
                  <div className="flex items-center gap-2">
                    <a href="/host_simulator.py" download className="btn-secondary text-xs flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> host_simulator.py
                    </a>
                    <a href="/start_simulator.bat" download className="btn-secondary text-xs flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> start_simulator.bat
                    </a>
                  </div>
                </div>

                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-1.5">
                  <p className="font-semibold text-[var(--fg)]">2. 註冊一鍵啟動協定（只需做一次）</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-[var(--fg-subtle)] ml-1">
                    <li>在檔案所在資料夾的<strong className="text-[var(--fg)]">網址列</strong>輸入 <code className="bg-[var(--surface-3)] px-1 rounded">powershell</code> 按 Enter。</li>
                    <li>在彈出的 PowerShell 視窗貼上以下指令，按 Enter。</li>
                  </ol>
                </div>

                <div className="relative group">
                  <pre className="bg-[#0b0f19] text-[#38bdf8] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-[#1e293b]">{SIM_PS_SCRIPT}</pre>
                  <button
                    onClick={copyScript}
                    className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[#1e293b]/80 hover:bg-[#334155] text-slate-300"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedScript ? '已複製！' : '複製指令'}
                  </button>
                </div>

                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                  <p className="text-[var(--amber-ink)] font-medium mb-1">POS 端末機設定</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-[var(--fg-subtle)] ml-1">
                    <li>將 POS 的<strong className="text-[var(--fg)]">主機 IP</strong> 改為本機 IP（同一網段）</li>
                    <li>將 POS 的<strong className="text-[var(--fg)]">主機 Port</strong> 改為 <code className="bg-[var(--surface-3)] px-1 rounded font-mono">{simTcpPort}</code></li>
                    <li>儲存後即可發送交易，Simulator 會自動回應</li>
                  </ol>
                </div>

                <p className="text-xs text-[var(--emerald-ink)] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  設定完成後，關閉此視窗即可從按鈕直接啟動 Simulator。
                </p>
              </div>

              <div className="p-4 border-t border-[var(--border)] flex justify-end">
                <button onClick={() => setShowSetupModal(false)} className="btn-secondary">
                  關閉
                </button>
              </div>
            </div>
          </div>
        )}
        {ipModalEl}
      </div>
    );
  }

  // ── 已連線 UI ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── 狀態列 + 控制 ────────────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl">
        <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[var(--emerald-ink)] text-sm font-medium">
              <Wifi className="w-4 h-4" /> Simulator 已連線
            </div>
            {simStatus && (
              <span className="text-xs text-[var(--fg-subtle)]">
                TCP :{simStatus.tcp_port} &middot; {simStatus.has_tpdu ? 'TPDU' : 'No TPDU'} &middot; MTI {simStatus.mti_encoding.toUpperCase()}
              </span>
            )}
            {posConnections.length > 0 && (
              <span className="badge badge-info">
                <CircleDot className="w-3 h-3 inline mr-1" />
                {posConnections.length} POS 連線中
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleShowIp} className="toolbar-btn text-xs">
              <MonitorSmartphone className="w-3.5 h-3.5" /> 連線位址
            </button>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`toolbar-btn text-xs ${showConfig ? 'active' : ''}`}
            >
              <Settings2 className="w-3.5 h-3.5" /> 回應設定
            </button>
            {transactions.length > 0 && (
              <button onClick={onClearTransactions} className="toolbar-btn text-xs">
                <Trash2 className="w-3.5 h-3.5" /> 清除記錄
              </button>
            )}
          </div>
        </div>

        {/* ── 回應設定面板 ────────────────────────────── */}
        {showConfig && (
          <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
            {/* 銀行規格選擇 */}
            {availableBanks.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--fg-muted)] font-medium mb-2">回應規格</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => handleBankChange('auto')}
                    className={`ghost-chip ${activeBank === null ? 'selected' : ''}`}
                  >
                    自動匹配
                  </button>
                  {availableBanks.map(bank => (
                    <button
                      key={bank}
                      onClick={() => handleBankChange(bank)}
                      className={`ghost-chip ${activeBank === bank ? 'selected' : ''}`}
                    >
                      {bank}
                    </button>
                  ))}
                </div>
                {activeBank && (
                  <p className="text-[11px] text-[var(--blue-ink)] mt-1.5">
                    回應欄位將依「{activeBank}」規格產生
                  </p>
                )}
              </div>
            )}

            {/* 回應碼 */}
            <div className="px-4 py-3">
              <p className="text-xs text-[var(--fg-muted)] font-medium mb-2">預設回應碼</p>
              <div className="flex flex-wrap gap-1.5">
                {RC_PRESETS.map(rc => (
                  <button
                    key={rc.code}
                    onClick={() => handleRCChange(rc.code)}
                    className={`ghost-chip ${selectedRC === rc.code ? 'selected' : ''}`}
                  >
                    {rc.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 延遲 + Timeout */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-6 flex-wrap">
                {/* 回應延遲 */}
                <div className="flex items-center gap-2">
                  <Timer className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
                  <span className="text-xs text-[var(--fg-muted)] font-medium">回應延遲</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelayChange(delayValue - 0.1)}
                      disabled={delayValue <= 0}
                      className="toolbar-btn text-xs p-1 disabled:opacity-30"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="text"
                      value={delayValue.toFixed(1)}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) setDelayValue(v);
                      }}
                      onBlur={() => handleDelayChange(delayValue)}
                      onKeyDown={e => { if (e.key === 'Enter') handleDelayChange(delayValue); }}
                      className="w-12 px-1.5 py-0.5 rounded text-xs font-mono text-center bg-[var(--surface-2)] border border-[var(--border)]"
                    />
                    <button
                      onClick={() => handleDelayChange(delayValue + 0.1)}
                      className="toolbar-btn text-xs p-1"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <span className="text-xs text-[var(--fg-subtle)]">秒</span>
                  </div>
                </div>

                <div className="h-4 border-r border-[var(--border)]" />

                {/* Timeout 模式 */}
                <div className="flex items-center gap-2">
                  <TimerOff className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
                  <span className="text-xs text-[var(--fg-muted)] font-medium">Timeout</span>
                  <div className="flex items-center gap-1.5">
                    {(['none', 'all', 'next', 'random'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => handleTimeoutChange(mode, mode === 'next' ? timeoutCount : undefined)}
                        className={`ghost-chip text-xs ${timeoutMode === mode ? 'selected' : ''} ${
                          mode === 'all' && timeoutMode === 'all' ? '!border-[var(--red-ink)] !text-[var(--red-ink)]' : ''
                        }`}
                      >
                        {{ none: '關閉', all: '全部', next: '下 N 筆', random: '隨機 30%' }[mode]}
                      </button>
                    ))}
                    {timeoutMode === 'next' && (
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={timeoutCount}
                        onChange={e => {
                          const n = parseInt(e.target.value) || 1;
                          setTimeoutCount(n);
                          handleTimeoutChange('next', n);
                        }}
                        className="w-10 px-1 py-0.5 rounded text-xs font-mono text-center bg-[var(--surface-2)] border border-[var(--border)]"
                      />
                    )}
                  </div>
                </div>
              </div>
              {timeoutMode === 'all' && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--red-ink)]">
                  <AlertTriangle className="w-3.5 h-3.5" /> 所有交易將不回應（POS 會 timeout）
                </div>
              )}
            </div>

            {/* 自訂回應欄位 */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] font-medium hover:text-[var(--fg)]"
                >
                  {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  自訂回應欄位
                  {fieldOverrides.length > 0 && (
                    <span className="badge badge-info text-[10px] py-0 ml-1">{fieldOverrides.length}</span>
                  )}
                </button>
                {fieldOverrides.length > 0 && showAdvanced && (
                  <button onClick={handleFieldOverrideClear} className="text-xs text-[var(--red-ink)] hover:underline">
                    全部清除
                  </button>
                )}
              </div>
              {showAdvanced && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--fg-subtle)]">
                    覆蓋回應電文的特定欄位值（如 Field 38 授權碼、Field 55 EMV Tag）
                  </p>
                  {fieldOverrides.map((fo, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--fg-muted)] w-5">F</span>
                      <input
                        type="text"
                        placeholder="欄位"
                        value={fo.fid}
                        onChange={e => {
                          const next = [...fieldOverrides];
                          next[idx] = { ...fo, fid: e.target.value };
                          setFieldOverrides(next);
                        }}
                        className="w-14 px-1.5 py-1 rounded text-xs font-mono bg-[var(--surface-2)] border border-[var(--border)]"
                      />
                      <input
                        type="text"
                        placeholder="值"
                        value={fo.val}
                        onChange={e => {
                          const next = [...fieldOverrides];
                          next[idx] = { ...fo, val: e.target.value };
                          setFieldOverrides(next);
                        }}
                        className="flex-1 px-2 py-1 rounded text-xs font-mono bg-[var(--surface-2)] border border-[var(--border)]"
                      />
                      <button
                        onClick={() => setFieldOverrides(fieldOverrides.filter((_, i) => i !== idx))}
                        className="toolbar-btn text-xs p-1 text-[var(--red-ink)]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFieldOverrides([...fieldOverrides, { fid: '', val: '' }])}
                      className="toolbar-btn text-xs flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> 新增欄位
                    </button>
                    {fieldOverrides.length > 0 && (
                      <button onClick={handleFieldOverrideApply} className="btn-primary text-xs px-3 py-1">
                        套用
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 交易記錄 ────────────────────────────────────── */}
      {transactions.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-12 text-center">
          <Zap className="w-10 h-10 text-[var(--fg-subtle)] mx-auto mb-3 opacity-40" />
          <p className="text-sm text-[var(--fg-subtle)]">
            等待 POS 端末機發送交易…
          </p>
          <p className="text-xs text-[var(--fg-subtle)] mt-1 opacity-60">
            將 POS 的主機 IP 設定為本機，Port 設為 {simStatus?.tcp_port ?? 8000}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-[var(--fg-subtle)]">
              共 {transactions.length} 筆交易
            </span>
          </div>
          {transactions.map(tx => {
            const isExpanded = expandedTx.has(tx.tx_id);
            const isApproved = tx.response_code === '00';
            const isError = tx.response_code === 'ERR';
            const isTimeout = tx.response_code === 'TIMEOUT';
            const indicatorClass = isError || isTimeout
              ? 'card-indicator-warning'
              : isApproved
                ? 'card-indicator-success'
                : 'card-indicator-error';

            return (
              <div key={tx.tx_id} className={`card-indicator ${indicatorClass}`}>
                {/* ── 摘要列 ────────────────────────────── */}
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 text-left"
                  onClick={() => toggleExpand(tx.tx_id)}
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-[var(--fg-subtle)] flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-[var(--fg-subtle)] flex-shrink-0" />
                  }
                  <span className="text-xs text-[var(--fg-subtle)] font-mono w-24 flex-shrink-0">
                    {tx.timestamp}
                  </span>
                  <span className="badge badge-info text-[10px] py-0.5 flex-shrink-0">
                    {tx.mti}
                  </span>
                  <span className="text-sm text-[var(--fg)] font-medium truncate flex-1">
                    {tx.tx_name ?? mtiLabel(tx.mti)}
                  </span>
                  {tx.bank && (
                    <span className="text-xs text-[var(--fg-subtle)] flex-shrink-0">
                      {tx.bank}
                    </span>
                  )}
                  <span className="text-xs text-[var(--fg-muted)] font-mono flex-shrink-0">
                    {formatAmount(tx.req_fields['4'])}
                  </span>
                  <span className={`badge text-[10px] py-0.5 flex-shrink-0 ${
                    isError || isTimeout ? 'badge-warning' : isApproved ? 'badge-success' : 'badge-error'
                  }`}>
                    {isTimeout ? 'TIMEOUT' : tx.response_code}
                  </span>
                </button>

                {/* ── 展開詳情 ──────────────────────────── */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[var(--border)]">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
                      {/* Request 欄位 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <ArrowDownLeft className="w-3.5 h-3.5 text-[var(--blue-ink)]" />
                          <span className="text-xs font-semibold text-[var(--blue-ink)]">
                            REQUEST ({tx.mti})
                          </span>
                        </div>
                        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th className="w-12">F#</th>
                                <th className="w-28">Name</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(tx.req_fields)
                                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                .map(([fid, val]) => (
                                  <tr key={fid}>
                                    <td className="font-mono text-[var(--fg-muted)]">{fid}</td>
                                    <td className="text-[var(--fg-subtle)] text-xs">
                                      {FIELD_NAMES[fid] ?? ''}
                                    </td>
                                    <td className="font-mono text-xs break-all">{val}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {tx.req_hex && (
                          <div className="mt-2">
                            <button
                              onClick={() => copyHex(tx.req_hex, tx.tx_id * 10)}
                              className="text-[10px] text-[var(--fg-subtle)] hover:text-[var(--fg-muted)] flex items-center gap-1"
                            >
                              {copiedHex === tx.tx_id * 10
                                ? <><Check className="w-3 h-3" /> Copied</>
                                : <><Copy className="w-3 h-3" /> Copy REQ HEX</>}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Response 欄位 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <ArrowUpRight className="w-3.5 h-3.5 text-[var(--emerald-ink)]" />
                          <span className="text-xs font-semibold text-[var(--emerald-ink)]">
                            RESPONSE ({tx.mti ? String(parseInt(tx.mti) + 10).padStart(4, '0') : '?'})
                          </span>
                        </div>
                        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th className="w-12">F#</th>
                                <th className="w-28">Name</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(tx.resp_fields)
                                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                .map(([fid, val]) => (
                                  <tr key={fid}>
                                    <td className="font-mono text-[var(--fg-muted)]">{fid}</td>
                                    <td className="text-[var(--fg-subtle)] text-xs">
                                      {FIELD_NAMES[fid] ?? ''}
                                    </td>
                                    <td className={`font-mono text-xs break-all ${
                                      fid === '39'
                                        ? val === '00'
                                          ? 'text-[var(--emerald-ink)] font-semibold'
                                          : 'text-[var(--red-ink)] font-semibold'
                                        : ''
                                    }`}>
                                      {val}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {tx.resp_hex && (
                          <div className="mt-2">
                            <button
                              onClick={() => copyHex(tx.resp_hex, tx.tx_id * 10 + 1)}
                              className="text-[10px] text-[var(--fg-subtle)] hover:text-[var(--fg-muted)] flex items-center gap-1"
                            >
                              {copiedHex === tx.tx_id * 10 + 1
                                ? <><Check className="w-3 h-3" /> Copied</>
                                : <><Copy className="w-3 h-3" /> Copy RSP HEX</>}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={logEndRef} />
        </div>
      )}
      {ipModalEl}
    </div>
  );
}
