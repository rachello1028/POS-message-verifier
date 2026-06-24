import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Wifi, WifiOff, Loader2, AlertCircle,
  Trash2, Smartphone, Building2, FileText, Camera, FileSpreadsheet, FileJson,
  FolderOpen, Table
} from 'lucide-react';
import type { AllRules, TransactionResult, ConnectionStatus, TransactionStep } from '../types';
import { downloadReport } from '../services/reportGenerator';
import { captureElement, pickSaveDirectory, hasSaveDirectory, getSaveDirName, autoCaptureTxCard } from '../services/screenshotService';

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
  onUpdateTestTarget?: (bank: string, transType: string, steps: TransactionStep[]) => void;
}

export default function TestPanel({
  rules, devices, connStatus, transactions, isMonitoring,
  onRefreshDevices, onStartMonitor, onStopMonitor, onClearResults, onUpdateTestTarget,
}: Props) {
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedBank, setSelectedBank] = useState('');
  const [selectedTrans, setSelectedTrans] = useState('');
  const [expandedTx, setExpandedTx] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [saveDirName, setSaveDirName] = useState(getSaveDirName());
  const [screenshotNames, setScreenshotNames] = useState<Map<number, string>>(new Map());
  const resultsRef = useRef<HTMLDivElement>(null);
  const txCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastAutoCapId = useRef(0);

  const handlePickDir = useCallback(async () => {
    const ok = await pickSaveDirectory();
    if (ok) setSaveDirName(getSaveDirName());
  }, []);

  const handleExport = useCallback((format: 'html' | 'csv' | 'json' | 'excel' | 'caselist') => {
    if (transactions.length === 0) return;
    downloadReport(format, transactions, { bank: selectedBank, transType: selectedTrans }, screenshotNames);
  }, [transactions, selectedBank, selectedTrans, screenshotNames]);

  const handleScreenshot = useCallback(async () => {
    if (!resultsRef.current || transactions.length === 0) return;
    setIsExporting(true);
    try {
      await captureElement(resultsRef.current, `pos-report-${selectedBank}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.png`);
    } catch (err) {
      console.error('截圖失敗:', err);
    } finally {
      setIsExporting(false);
    }
  }, [transactions, selectedBank]);

  useEffect(() => {
    if (transactions.length === 0) return;
    const latest = transactions[transactions.length - 1];
    if (latest.id <= lastAutoCapId.current) return;
    lastAutoCapId.current = latest.id;

    // 先展開卡片，再截圖
    setExpandedTx(prev => new Set(prev).add(latest.id));

    requestAnimationFrame(() => {
      setTimeout(async () => {
        const el = txCardRefs.current.get(latest.id);
        if (!el) return;
        try {
          const name = await autoCaptureTxCard(el, selectedBank, selectedTrans, latest.id);
          setScreenshotNames(prev => new Map(prev).set(latest.id, name));
        } catch (err) {
          console.error('自動截圖失敗:', err);
        }
      }, 800);
    });
  }, [transactions, selectedBank, selectedTrans]);

  const bankList = Object.keys(rules).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  
  // 交易類別排序：依優先權 + 中文自然排序
  const transList = selectedBank
    ? Object.keys(rules[selectedBank] ?? {}).sort((a, b) => {
        // 定義優先順序關鍵字（越前面優先權越高）
        const priority = ['一般銷售', '銷售', '預授權', '取消', '退貨', '退款', '結帳', '查詢'];
        const getPriority = (name: string) => {
          const idx = priority.findIndex(p => name.includes(p));
          return idx === -1 ? priority.length : idx;
        };
        const pa = getPriority(a);
        const pb = getPriority(b);
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b, 'zh-TW');
      })
    : [];

  const getSteps = (bank: string, trans: string): TransactionStep[] => {
    const cfg = rules[bank]?.[trans];
    if (!cfg) return [];
    if (cfg.steps) return cfg.steps;
    // 向下相容舊版單段式格式
    return [{ step_name: '主交易', mti: cfg.mti ?? '0200', fields: cfg.fields ?? [] }];
  };

  // 監聽中切換交易類型時，自動同步到 bridge
  useEffect(() => {
    if (isMonitoring && selectedBank && selectedTrans && onUpdateTestTarget) {
      const steps = getSteps(selectedBank, selectedTrans);
      onUpdateTestTarget(selectedBank, selectedTrans, steps);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring, selectedBank, selectedTrans]);

  // 當銀行切換時自動選第一個交易
  const handleBankChange = (bank: string) => {
    setSelectedBank(bank);
    const firstTrans = Object.keys(rules[bank] ?? {})[0] ?? '';
    setSelectedTrans(firstTrans);
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
    connected:    { icon: <Wifi className="w-4 h-4" />,     text: 'Bridge 已連線',   cls: 'text-[var(--emerald-ink)] bg-transparent border-[var(--emerald-line)]/30' },
    connecting:   { icon: <Loader2 className="w-4 h-4 animate-spin" />, text: '連線中…', cls: 'text-[var(--amber-ink)] bg-[var(--amber-soft)] border-[var(--amber-line)]' },
    disconnected: { icon: <WifiOff className="w-4 h-4" />,  text: 'Bridge 未連線',   cls: 'text-[var(--fg-subtle)] bg-[var(--surface)] border-[var(--border)]' },
    error:        { icon: <AlertCircle className="w-4 h-4" />, text: '連線錯誤',      cls: 'text-[var(--red-ink)] bg-[var(--red-soft)] border-[var(--red-line)]' },
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
          <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] mb-1.5 font-medium">
            <Smartphone className="w-3.5 h-3.5" /> 測試設備
          </label>
          <div className="flex gap-2">
            <select
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              className="flex-1 bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="">— 請選擇設備 —</option>
              <option value="__auto__">⚡ 自動偵測（第一台連線設備）</option>
              {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={onRefreshDevices}
              title="重新偵測設備"
              className="toolbar-btn p-2"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 銀行選擇 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] mb-1.5 font-medium">
            <Building2 className="w-3.5 h-3.5" /> 銀行 / 客戶
          </label>
          <select
            value={selectedBank}
            onChange={e => handleBankChange(e.target.value)}
            className="w-full bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="">— 請選擇銀行 —</option>
            {bankList.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* 交易類別 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] mb-1.5 font-medium">
            <FileText className="w-3.5 h-3.5" /> 交易類別
          </label>
          <select
            value={selectedTrans}
            onChange={e => setSelectedTrans(e.target.value)}
            disabled={!selectedBank}
            className="w-full bg-[var(--surface-2)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--fg)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
            <span className="text-xs text-[var(--fg-subtle)]">監測步驟：</span>
            {steps.map((s, i) => (
              <span key={i} className="badge badge-info">
                {i + 1}. {s.step_name} <span className="font-mono opacity-80">({s.mti})</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* 截圖目錄 + 按鈕 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handlePickDir}
          className={`toolbar-btn flex items-center gap-1.5 text-xs px-3 py-2 ${
            saveDirName ? 'border-[var(--emerald-line)]/50 text-[var(--emerald-ink)]' : ''
          }`}
          title="選擇截圖自動存放的目錄"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {saveDirName ? `📂 ${saveDirName}` : '選擇截圖目錄'}
        </button>

        {!isMonitoring ? (
          <button
            onClick={handleStart}
            disabled={!selectedDevice || !selectedBank || !selectedTrans || connStatus !== 'connected'}
            title={!selectedDevice ? '請選擇設備或「自動偵測」' : undefined}
            className="btn-success flex items-center gap-2 px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
          >
            <Play className="w-4 h-4" /> 開始監聽
          </button>
        ) : (
          <button
            onClick={onStopMonitor}
            className="btn-danger flex items-center gap-2 px-5 py-2.5 font-semibold"
          >
            <Square className="w-4 h-4" /> 停止監聽
          </button>
        )}
        {transactions.length > 0 && (
          <button
            onClick={onClearResults}
            className="btn-secondary flex items-center gap-2 px-4 py-2.5"
          >
            <Trash2 className="w-4 h-4" /> 清除結果
          </button>
        )}
      </div>

      {/* 監聽中指示 */}
      {isMonitoring && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-[var(--emerald-line)]/30 bg-transparent">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-sm text-[var(--fg-muted)] font-medium">
            正在監聽 <span className="font-mono text-[var(--fg)]">{selectedDevice === '__auto__' ? '自動偵測設備' : selectedDevice}</span>
            <span className="mx-1.5 text-[var(--fg-subtle)]">→</span>
            <span className="text-[var(--emerald-ink)]">{selectedBank} / {selectedTrans}</span>
          </span>
        </div>
      )}

      {/* 統計 */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-[var(--fg)]">{transactions.length}</div>
            <div className="text-xs text-[var(--fg-muted)] mt-0.5">總交易數</div>
          </div>
          <div className="bg-[var(--emerald-soft)] border border-[var(--emerald-line)] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-[var(--emerald-ink)]">{passCount}</div>
            <div className="text-xs text-[var(--emerald-ink)] mt-0.5 opacity-70">通過</div>
          </div>
          <div className="bg-[var(--red-soft)] border border-[var(--red-line)] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-[var(--red-ink)]">{failCount}</div>
            <div className="text-xs text-[var(--red-ink)] mt-0.5 opacity-70">失敗</div>
          </div>
        </div>
      )}

      {/* 匯出工具列 */}
      {transactions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--fg-subtle)] mr-1">匯出：</span>
          <button
            onClick={handleScreenshot}
            disabled={isExporting}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            截圖
          </button>
          <button
            onClick={() => handleExport('html')}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <FileText className="w-3.5 h-3.5" /> HTML 報告
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5 text-[var(--emerald-ink)]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={() => handleExport('caselist')}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <Table className="w-3.5 h-3.5" /> 案例清單
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV 詳細
          </button>
          <button
            onClick={() => handleExport('json')}
            className="toolbar-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <FileJson className="w-3.5 h-3.5" /> JSON
          </button>
        </div>
      )}

      {/* 交易結果列表 */}
      <div ref={resultsRef} className="space-y-3">
        {transactions.slice().reverse().map(tx => {
          const isExpanded = expandedTx.has(tx.id);
          return (
            <div
              key={tx.id}
              ref={el => { if (el) txCardRefs.current.set(tx.id, el); }}
              className={`card-indicator rounded-xl overflow-hidden ${
                tx.pass
                  ? 'card-indicator-success'
                  : 'card-indicator-error'
              }`}
            >
              {/* 卡片標題 */}
              <button
                onClick={() => toggleExpand(tx.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-3)]/50 transition-colors"
              >
                {tx.pass
                  ? <CheckCircle2 className="w-5 h-5 text-[var(--emerald-ink)] flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-[var(--red-ink)] flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[var(--fg)]">交易 #{tx.id}</span>
                    <span className={`badge ${
                      tx.pass ? 'badge-success' : 'badge-error'
                    }`}>
                      {tx.pass ? '✅ 完美通過' : '❌ 驗証失敗'}
                    </span>
                    <span className="text-xs text-[var(--fg-subtle)]">{tx.timestamp}</span>
                  </div>
                  <div className="text-xs text-[var(--fg-muted)] mt-0.5">
                    {tx.bank} · {tx.transactionType}
                    {tx.steps[0] && ` · 授權碼: ${tx.steps[0].auth} · 序號: ${tx.steps[0].rrn}`}
                  </div>
                </div>
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-[var(--fg-muted)] flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-[var(--fg-muted)] flex-shrink-0" />
                }
              </button>

              {/* 展開內容 */}
              {isExpanded && (
                <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
                  {tx.steps.map((step, si) => (
                    <div key={si} className="px-4 py-3">
                      <div className={`flex items-center gap-2 mb-3 text-sm font-semibold ${
                        step.pass ? 'text-[var(--emerald-ink)]' : 'text-[var(--red-ink)]'
                      }`}>
                        {step.pass
                          ? <CheckCircle2 className="w-4 h-4" />
                          : <XCircle className="w-4 h-4" />
                        }
                        {step.stepName}
                        <span className="font-mono text-xs opacity-70 font-normal">[{step.mti}]</span>
                        <div className="ml-auto flex gap-3 text-xs font-normal text-[var(--fg-muted)]">
                          <span>授權碼: <span className="text-[var(--fg)] font-mono">{step.auth}</span></span>
                          <span>序號: <span className="text-[var(--fg)] font-mono">{step.rrn}</span></span>
                          <span>調編: <span className="text-[var(--fg)] font-mono">{step.trace}</span></span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {step.fields.map((f, fi) => (
                          <div
                            key={fi}
                            className={`flex items-start gap-2 px-3 py-1.5 rounded text-xs font-mono ${
                              f.pass
                                ? 'bg-[var(--surface-2)] border border-transparent text-[var(--fg-muted)]'
                                : 'bg-[var(--red-soft)] border border-[var(--red-line)] text-[var(--red-ink)] font-semibold shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                            }`}
                          >
                            <span className={`flex-shrink-0 mt-0.5 ${f.pass ? 'opacity-50' : ''}`}>{f.pass ? '✓' : '✗'}</span>
                            <span className="flex-1">
                              {f.pass ? (
                                <>{f.message.split('：').slice(0, 1).join('')}：<span className="text-[var(--emerald-ink)]">{f.message.split('：').slice(1).join('：')}</span></>
                              ) : (
                                f.message
                              )}
                            </span>
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
