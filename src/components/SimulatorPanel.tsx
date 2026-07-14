import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server, Wifi, WifiOff, Loader2, ChevronDown, ChevronRight,
  Trash2, ArrowDownLeft, ArrowUpRight, CircleDot, Zap, Copy,
  Check, Settings2, AlertTriangle, X, Download, Pencil,
  Terminal, CheckCircle2,
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
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (simStatus?.default_rc) setSelectedRC(simStatus.default_rc);
  }, [simStatus?.default_rc]);

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
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-1.5">
                  <p className="font-semibold text-[var(--fg)]">設定步驟（只需做一次）</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-[var(--fg-subtle)] ml-1">
                    <li>
                      確認 <code className="bg-[var(--surface-3)] px-1 rounded">host_simulator.py</code> 和{' '}
                      <code className="bg-[var(--surface-3)] px-1 rounded">start_simulator.bat</code> 在同一個資料夾。
                    </li>
                    <li>在該資料夾的<strong className="text-[var(--fg)]">網址列</strong>輸入 <code className="bg-[var(--surface-3)] px-1 rounded">powershell</code> 按 Enter。</li>
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

        {/* ── 回應碼設定面板 ────────────────────────────── */}
        {showConfig && (
          <div className="px-4 pb-3 border-t border-[var(--border)] pt-3">
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
            const indicatorClass = isError
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
                  <span className="text-xs text-[var(--fg-subtle)] font-mono w-16 flex-shrink-0">
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
                    isError ? 'badge-warning' : isApproved ? 'badge-success' : 'badge-error'
                  }`}>
                    {tx.response_code}
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
    </div>
  );
}
