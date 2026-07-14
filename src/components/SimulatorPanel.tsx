import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server, Wifi, WifiOff, Loader2, ChevronDown, ChevronRight,
  Trash2, ArrowDownLeft, ArrowUpRight, CircleDot, Zap, Copy,
  Check, Settings2, AlertTriangle,
} from 'lucide-react';
import type { SimTransaction, SimStatus, SimBridge } from '../services/simBridge';

interface Props {
  simBridge: SimBridge | null;
  simConnStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  simStatus: SimStatus | null;
  transactions: SimTransaction[];
  posConnections: string[];
  onClearTransactions: () => void;
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

export default function SimulatorPanel({
  simBridge, simConnStatus, simStatus, transactions, posConnections,
  onClearTransactions,
}: Props) {
  const [expandedTx, setExpandedTx] = useState<Set<number>>(new Set());
  const [selectedRC, setSelectedRC] = useState(simStatus?.default_rc ?? '00');
  const [showConfig, setShowConfig] = useState(false);
  const [copiedHex, setCopiedHex] = useState<number | null>(null);
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
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--surface-3)] flex items-center justify-center">
            <Server className="w-8 h-8 text-[var(--fg-subtle)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--fg)]">Host Simulator 未連線</h3>
            <p className="text-sm text-[var(--fg-subtle)] mt-1">
              {simConnStatus === 'connecting'
                ? '正在連線 WebSocket 監控通道…'
                : '請先啟動 Host Simulator'}
            </p>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 text-left max-w-md mx-auto">
            <p className="text-xs text-[var(--fg-muted)] font-medium mb-2">啟動方式</p>
            <code className="text-xs text-[var(--blue-ink)] font-mono block mb-1">
              python host_simulator.py
            </code>
            <code className="text-xs text-[var(--fg-subtle)] font-mono block">
              python host_simulator.py --port 8000 --response-code 00
            </code>
          </div>
          {simConnStatus === 'connecting' && (
            <div className="flex items-center justify-center gap-2 text-[var(--amber-ink)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 嘗試連線中…
            </div>
          )}
        </div>
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
