import React, { useState } from 'react';
import {
  Play, Square, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Wifi, WifiOff, Loader2, AlertCircle,
  Trash2, Smartphone, Building2, FileText
} from 'lucide-react';
import type { AllRules, TransactionResult, ConnectionStatus, TransactionStep } from '../types';

interface Props {
  rules: AllRules;
  devices: string[];
  connStatus: ConnectionStatus;
  transactions: TransactionResult[];
  isMonitoring: boolean;
  onRefreshDevices: () => void;
  onStartMonitor: (device: string, bank: string, transType: string, steps: TransactionStep[]) => void;
  onStopMonitor: () => void;
  onClearResults: () => void;
}

export default function TestPanel({
  rules, devices, connStatus, transactions, isMonitoring,
  onRefreshDevices, onStartMonitor, onStopMonitor, onClearResults,
}: Props) {
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedBank, setSelectedBank] = useState('');
  const [selectedTrans, setSelectedTrans] = useState('');
  const [expandedTx, setExpandedTx] = useState<Set<number>>(new Set());

  const bankList = Object.keys(rules);
  const transList = selectedBank ? Object.keys(rules[selectedBank] ?? {}) : [];

  // 當銀行切換時自動選第一個交易
  const handleBankChange = (bank: string) => {
    setSelectedBank(bank);
    const firstTrans = Object.keys(rules[bank] ?? {})[0] ?? '';
    setSelectedTrans(firstTrans);
  };

  const getSteps = (bank: string, trans: string): TransactionStep[] => {
    const cfg = rules[bank]?.[trans];
    if (!cfg) return [];
    if (cfg.steps) return cfg.steps;
    // 向下相容舊版單段式格式
    return [{ step_name: '主交易', mti: cfg.mti ?? '0200', fields: cfg.fields ?? [] }];
  };

  const handleStart = () => {
    if (!selectedBank || !selectedTrans) return;
    const steps = getSteps(selectedBank, selectedTrans);
    const deviceArg = selectedDevice === '__auto__' ? '' : selectedDevice;
    onStartMonitor(deviceArg, selectedBank, selectedTrans, steps);
  };

  const toggleExpand = (id: number) => {
    setExpandedTx(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const statusConfig: Record<ConnectionStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    connected:    { icon: <Wifi className="w-4 h-4" />,     text: 'Bridge 已連線',   cls: 'text-emerald-400 bg-emerald-950/50 border-emerald-800' },
    connecting:   { icon: <Loader2 className="w-4 h-4 animate-spin" />, text: '連線中…', cls: 'text-amber-400 bg-amber-950/50 border-amber-800' },
    disconnected: { icon: <WifiOff className="w-4 h-4" />,  text: 'Bridge 未連線',   cls: 'text-slate-400 bg-slate-800/50 border-slate-700' },
    error:        { icon: <AlertCircle className="w-4 h-4" />, text: '連線錯誤',      cls: 'text-red-400 bg-red-950/50 border-red-800' },
  };
  const sc = statusConfig[connStatus];

  const passCount  = transactions.filter(t => t.pass).length;
  const failCount  = transactions.filter(t => !t.pass).length;

  return (
    <div className="space-y-6">
      {/* ── 狀態列 ─────────────────────────────────────────── */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium ${sc.cls}`}>
        {sc.icon}
        <span>{sc.text}</span>
        {connStatus === 'error' && (
          <span className="ml-2 text-xs opacity-70">請確認 <code className="font-mono bg-black/30 px-1 rounded">python adb_bridge.py</code> 已在背景執行</span>
        )}
      </div>

      {/* ── 控制面板 ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 設備選擇 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5 font-medium">
            <Smartphone className="w-3.5 h-3.5" /> 測試設備
          </label>
          <div className="flex gap-2">
            <select
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 請選擇設備 —</option>
              <option value="__auto__">⚡ 自動偵測（第一台連線設備）</option>
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={onRefreshDevices}
              title="重新偵測設備"
              className="p-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>

        {/* 銀行選擇 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5 font-medium">
            <Building2 className="w-3.5 h-3.5" /> 銀行 / 客戶
          </label>
          <select
            value={selectedBank}
            onChange={e => handleBankChange(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— 請選擇銀行 —</option>
            {bankList.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* 交易類別 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5 font-medium">
            <FileText className="w-3.5 h-3.5" /> 交易類別
          </label>
          <select
            value={selectedTrans}
            onChange={e => setSelectedTrans(e.target.value)}
            disabled={!selectedBank}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— 請選擇交易 —</option>
            {transList.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* 步驟預覽 */}
      {selectedBank && selectedTrans && (() => {
        const steps = getSteps(selectedBank, selectedTrans);
        return (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500">監測步驟：</span>
            {steps.map((s, i) => (
              <span key={i} className="text-xs px-2 py-0.5 bg-blue-950/60 text-blue-300 border border-blue-800/50 rounded-full">
                {i + 1}. {s.step_name} <span className="font-mono text-blue-400">({s.mti})</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* 按鈕 */}
      <div className="flex gap-3">
        {!isMonitoring ? (
          <button
            onClick={handleStart}
            disabled={!selectedDevice || !selectedBank || !selectedTrans || connStatus !== 'connected'}
            title={!selectedDevice ? '請選擇設備或「自動偵測」' : undefined}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" /> 開始監聽
          </button>
        ) : (
          <button
            onClick={onStopMonitor}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors"
          >
            <Square className="w-4 h-4" /> 停止監聽
          </button>
        )}
        {transactions.length > 0 && (
          <button
            onClick={onClearResults}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" /> 清除結果
          </button>
        )}
      </div>

      {/* 監聽中指示 */}
      {isMonitoring && (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-sm text-emerald-300 font-medium">
            正在監聽 <span className="font-mono text-emerald-200">{selectedDevice === '__auto__' ? '自動偵測設備' : selectedDevice}</span>
            　→　{selectedBank} / {selectedTrans}
          </span>
        </div>
      )}

      {/* 統計 */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-100">{transactions.length}</div>
            <div className="text-xs text-slate-400 mt-0.5">總交易數</div>
          </div>
          <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{passCount}</div>
            <div className="text-xs text-emerald-500 mt-0.5">通過</div>
          </div>
          <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{failCount}</div>
            <div className="text-xs text-red-500 mt-0.5">失敗</div>
          </div>
        </div>
      )}

      {/* 交易結果列表 */}
      <div className="space-y-3">
        {transactions.slice().reverse().map(tx => {
          const isExpanded = expandedTx.has(tx.id);
          return (
            <div
              key={tx.id}
              className={`rounded-xl border overflow-hidden ${
                tx.pass
                  ? 'border-emerald-800/60 bg-emerald-950/20'
                  : 'border-red-800/60 bg-red-950/20'
              }`}
            >
              {/* 卡片標題 */}
              <button
                onClick={() => toggleExpand(tx.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                {tx.pass
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-100">交易 #{tx.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tx.pass ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'
                    }`}>
                      {tx.pass ? '✅ 完美通過' : '❌ 驗証失敗'}
                    </span>
                    <span className="text-xs text-slate-500">{tx.timestamp}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {tx.bank} · {tx.transactionType}
                    {tx.steps[0] && ` · 授權碼: ${tx.steps[0].auth} · 序號: ${tx.steps[0].rrn}`}
                  </div>
                </div>
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                }
              </button>

              {/* 展開內容 */}
              {isExpanded && (
                <div className="border-t border-slate-700/50 divide-y divide-slate-800/50">
                  {tx.steps.map((step, si) => (
                    <div key={si} className="px-4 py-3">
                      <div className={`flex items-center gap-2 mb-3 text-sm font-semibold ${
                        step.pass ? 'text-emerald-300' : 'text-red-300'
                      }`}>
                        {step.pass
                          ? <CheckCircle2 className="w-4 h-4" />
                          : <XCircle className="w-4 h-4" />
                        }
                        {step.stepName}
                        <span className="font-mono text-xs opacity-70 font-normal">[{step.mti}]</span>
                        <div className="ml-auto flex gap-3 text-xs font-normal text-slate-400">
                          <span>授權碼: <span className="text-slate-200 font-mono">{step.auth}</span></span>
                          <span>序號: <span className="text-slate-200 font-mono">{step.rrn}</span></span>
                          <span>調編: <span className="text-slate-200 font-mono">{step.trace}</span></span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {step.fields.map((f, fi) => (
                          <div
                            key={fi}
                            className={`flex items-start gap-2 px-3 py-1.5 rounded-lg text-xs ${
                              f.pass
                                ? 'bg-emerald-950/30 text-emerald-300'
                                : 'bg-red-950/30 text-red-300'
                            }`}
                          >
                            <span className="flex-shrink-0 mt-0.5">{f.pass ? '✅' : '❌'}</span>
                            <span className="flex-1">{f.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
