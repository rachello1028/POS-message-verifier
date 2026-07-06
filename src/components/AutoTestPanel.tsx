import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, Wifi, WifiOff, Loader2, CheckCircle2, XCircle,
  AlertCircle, Smartphone, ChevronDown, ChevronRight, CreditCard,
  RotateCcw, Upload, Plus, Pencil, Circle, Download,
} from 'lucide-react';
import type {
  AutoTestScript, AutoTestStep, AutoStepResult, AutoRunStatus,
  AutoPosAction, AllRules, TransactionResult, PosBridgeStatus,
} from '../types';
import { PosBridge } from '../services/posBridge';
import { AdbBridge } from '../services/adbBridge';
import { AutoTestRunner } from '../services/autoTestRunner';
import { transactionsToScript } from '../services/scriptConverter';
import ScriptEditor from './ScriptEditor';

interface Props {
  rules: AllRules;
  adbBridge: AdbBridge | null;
  onTransaction: (tx: TransactionResult) => void;
  autoTxListenerRef: React.MutableRefObject<((tx: TransactionResult) => void) | null>;
  pendingScript?: AutoTestScript | null;
  onPendingScriptHandled?: () => void;
}

const PRESET_SCRIPTS: AutoTestScript[] = [
  {
    id: 'chb-agg-basic',
    name: 'CHB 聚合支付 — 信用卡基本流程',
    description: '信用卡銷售 → 取消 → 銷售 → 退貨',
    steps: [
      {
        id: 's1', name: '信用卡銷售 $100', bank: '彰銀CHB聚合支付', transType: '授權通知-一般銷售',
        saveResultAs: 'sale1',
        posAction: { funcName: '銷售交易', amount: '100', payMethod: '信用卡', transType: '一般交易' },
      },
      {
        id: 's2', name: '取消銷售', bank: '彰銀CHB聚合支付', transType: '授權通知-取消銷售',
        posAction: { funcName: '取消交易', traceRef: '{{sale1.traceNumber}}' },
      },
      {
        id: 's3', name: '信用卡銷售 $200', bank: '彰銀CHB聚合支付', transType: '授權通知-一般銷售',
        saveResultAs: 'sale2',
        posAction: { funcName: '銷售交易', amount: '200', payMethod: '信用卡', transType: '一般交易' },
      },
      {
        id: 's4', name: '信用卡退貨 $200', bank: '彰銀CHB聚合支付', transType: '授權通知-退貨',
        posAction: {
          funcName: '退貨交易', amount: '200', payMethod: '信用卡',
          authRef: '{{sale2.authCode}}', txDateRef: '{{sale2.txDate}}',
        },
      },
    ],
  },
  {
    id: 'chb-agg-cup',
    name: 'CHB 聚合支付 — 銀聯卡',
    description: '銀聯卡銷售 → 取消 → 銷售 → 退貨',
    steps: [
      {
        id: 'c1', name: '銀聯銷售 $100', bank: '彰銀CHB聚合支付', transType: '授權通知-一般銷售_銀聯',
        saveResultAs: 'cup_sale1',
        posAction: { funcName: '銷售交易', amount: '100', payMethod: '銀聯卡', transType: '一般交易' },
      },
      {
        id: 'c2', name: '取消銀聯銷售', bank: '彰銀CHB聚合支付', transType: '授權通知-取消銷售',
        posAction: { funcName: '取消交易', traceRef: '{{cup_sale1.traceNumber}}' },
      },
      {
        id: 'c3', name: '銀聯銷售 $200', bank: '彰銀CHB聚合支付', transType: '授權通知-一般銷售_銀聯',
        saveResultAs: 'cup_sale2',
        posAction: { funcName: '銷售交易', amount: '200', payMethod: '銀聯卡', transType: '一般交易' },
      },
      {
        id: 'c4', name: '銀聯退貨 $200', bank: '彰銀CHB聚合支付', transType: '授權通知-銀聯退貨',
        posAction: {
          funcName: '退貨交易', amount: '200', payMethod: '銀聯卡',
          txDateRef: '{{cup_sale2.txDate}}', traceRef: '{{cup_sale2.traceNumber}}', authRef: '{{cup_sale2.authCode}}',
        },
      },
    ],
  },
  {
    id: 'chb-agg-smartpay',
    name: 'CHB 聚合支付 — SmartPay',
    description: 'SmartPay 銷售 → 取消',
    steps: [
      {
        id: 'sp1', name: 'SmartPay 銷售 $100', bank: '彰銀CHB聚合支付', transType: '授權通知-SmartPay',
        saveResultAs: 'sp_sale',
        posAction: { funcName: '銷售交易', amount: '100', payMethod: '晶片金融卡', transType: 'SmartPay' },
      },
      {
        id: 'sp2', name: 'SmartPay 取消', bank: '彰銀CHB聚合支付', transType: '授權通知-取消銷售',
        posAction: { funcName: '取消交易', traceRef: '{{sp_sale.traceNumber}}' },
      },
    ],
  },
];

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <div className="w-5 h-5 rounded-full border-2 border-[var(--border-strong)]" />,
  running: <Loader2 className="w-5 h-5 animate-spin text-[var(--blue-ink)]" />,
  waiting_card: <CreditCard className="w-5 h-5 text-[var(--amber-ink)] animate-pulse" />,
  passed: <CheckCircle2 className="w-5 h-5 text-[var(--emerald-ink)]" />,
  failed: <XCircle className="w-5 h-5 text-[var(--red-ink)]" />,
  skipped: <AlertCircle className="w-5 h-5 text-[var(--fg-subtle)]" />,
};

export default function AutoTestPanel({
  rules, adbBridge, onTransaction, autoTxListenerRef,
  pendingScript, onPendingScriptHandled,
}: Props) {
  const [posStatus, setPosStatus] = useState<PosBridgeStatus>({ connected: false, devices: [] });
  const [selectedDevice, setSelectedDevice] = useState('');
  const [runStatus, setRunStatus] = useState<AutoRunStatus>('idle');
  const [selectedScript, setSelectedScript] = useState<AutoTestScript | null>(null);
  const [stepResults, setStepResults] = useState<AutoStepResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [customScripts, setCustomScripts] = useState<AutoTestScript[]>(() => {
    try {
      const saved = localStorage.getItem('pos-auto-scripts');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [editingScript, setEditingScript] = useState<AutoTestScript | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [noVirtualKeypad, setNoVirtualKeypad] = useState(() => {
    try { return localStorage.getItem('pos-no-virtual-keypad') === 'true'; } catch { return false; }
  });
  const recordedTxRef = useRef<TransactionResult[]>([]);

  const posBridgeRef = useRef<PosBridge | null>(null);
  const runnerRef = useRef<AutoTestRunner | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = new PosBridge({
      onStatus: (s) => setPosStatus(s),
      onStepProgress: () => {},
      onStepResult: () => {},
      onError: (msg) => setLogs(prev => [...prev, `❌ POS Bridge: ${msg}`]),
    });
    posBridgeRef.current = bridge;
    return () => bridge.disconnect();
  }, []);

  // Handle pending script from TestPanel export
  useEffect(() => {
    if (pendingScript) {
      setEditingScript(pendingScript);
      onPendingScriptHandled?.();
    }
  }, [pendingScript, onPendingScriptHandled]);

  const handleConnectBridge = useCallback(() => {
    posBridgeRef.current?.connect();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('pos-auto-scripts', JSON.stringify(customScripts));
  }, [customScripts]);

  const handleConnectDevice = useCallback(() => {
    if (selectedDevice && posBridgeRef.current) {
      posBridgeRef.current.connectDevice(selectedDevice);
    }
  }, [selectedDevice]);

  const handleRun = useCallback(async () => {
    if (!selectedScript || !posBridgeRef.current || !adbBridge) return;

    setStepResults(selectedScript.steps.map(s => ({
      stepId: s.id, stepName: s.name, status: 'pending', progressMessages: [],
    })));
    setLogs([]);
    setExpandedSteps(new Set());

    const runner = new AutoTestRunner(
      posBridgeRef.current,
      adbBridge,
      rules,
      {
        onStatusChange: setRunStatus,
        onStepUpdate: (idx, result) => {
          setStepResults(prev => {
            const next = [...prev];
            next[idx] = result;
            return next;
          });
          if (result.status === 'running' || result.status === 'waiting_card') {
            setExpandedSteps(prev => new Set(prev).add(idx));
          }
        },
        onTransaction: (tx) => {
          onTransaction(tx);
          runner.feedTransaction(tx);
        },
        onLog: (msg) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} ${msg}`]),
      },
      { noVirtualKeypad },
    );
    runnerRef.current = runner;
    autoTxListenerRef.current = (tx) => runner.feedTransaction(tx);

    await runner.runScript(selectedScript);
    autoTxListenerRef.current = null;
    runnerRef.current = null;
  }, [selectedScript, adbBridge, rules, onTransaction, autoTxListenerRef, noVirtualKeypad]);

  const handleAbort = useCallback(() => {
    runnerRef.current?.abort();
  }, []);

  const handleRunSingle = useCallback(async (idx: number) => {
    if (!selectedScript || !posBridgeRef.current || !adbBridge) return;

    const step = selectedScript.steps[idx];
    setStepResults(prev => {
      const next = [...prev];
      while (next.length <= idx) next.push({ stepId: '', stepName: '', status: 'pending', progressMessages: [] });
      next[idx] = { stepId: step.id, stepName: step.name, status: 'pending', progressMessages: [] };
      return next;
    });
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} ▶ 單步執行：${step.name}`]);
    setExpandedSteps(prev => new Set(prev).add(idx));

    const runner = new AutoTestRunner(
      posBridgeRef.current,
      adbBridge,
      rules,
      {
        onStatusChange: setRunStatus,
        onStepUpdate: (stepIdx, result) => {
          setStepResults(prev => {
            const next = [...prev];
            next[stepIdx] = result;
            return next;
          });
          if (result.status === 'running' || result.status === 'waiting_card') {
            setExpandedSteps(prev => new Set(prev).add(stepIdx));
          }
        },
        onTransaction: (tx) => {
          onTransaction(tx);
          runner.feedTransaction(tx);
        },
        onLog: (msg) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} ${msg}`]),
      },
      { noVirtualKeypad },
    );
    runnerRef.current = runner;
    autoTxListenerRef.current = (tx) => runner.feedTransaction(tx);

    await runner.runSingleStep(idx, step, stepResults, selectedScript.steps);
    autoTxListenerRef.current = null;
    runnerRef.current = null;
  }, [selectedScript, adbBridge, rules, onTransaction, autoTxListenerRef, stepResults, noVirtualKeypad]);

  const handleImportScript = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const script = JSON.parse(text) as AutoTestScript;
        if (!script.id || !script.name || !script.steps) {
          setLogs(prev => [...prev, '❌ 無效的腳本格式']);
          return;
        }
        setCustomScripts(prev => [...prev.filter(s => s.id !== script.id), script]);
        setLogs(prev => [...prev, `✅ 已匯入腳本：${script.name}`]);
      } catch {
        setLogs(prev => [...prev, '❌ JSON 解析失敗']);
      }
    };
    input.click();
  }, []);

  const handleNewScript = useCallback(() => {
    setEditingScript({
      id: `custom-${Date.now()}`,
      name: '新腳本',
      description: '',
      steps: [],
    });
  }, []);

  const handleEditScript = useCallback((script: AutoTestScript) => {
    setEditingScript(structuredClone(script));
  }, []);

  const handleSaveScript = useCallback((script: AutoTestScript) => {
    setCustomScripts(prev => {
      const exists = prev.findIndex(s => s.id === script.id);
      if (exists >= 0) {
        const next = [...prev];
        next[exists] = script;
        return next;
      }
      return [...prev, script];
    });
    setEditingScript(null);
    setSelectedScript(script);
    setLogs(prev => [...prev, `✅ 腳本已儲存：${script.name}`]);
  }, []);

  const handleDeleteScript = useCallback((scriptId: string) => {
    setCustomScripts(prev => prev.filter(s => s.id !== scriptId));
    if (selectedScript?.id === scriptId) {
      setSelectedScript(null);
      setStepResults([]);
    }
  }, [selectedScript]);

  // ── Recording mode ──────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(() => {
    if (!adbBridge) return;
    recordedTxRef.current = [];
    setIsRecording(true);
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} 🔴 開始錄製 — 請在 POS 上操作，電文會自動收集`]);

    autoTxListenerRef.current = (tx) => {
      recordedTxRef.current.push(tx);
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} 📝 錄製到交易：${tx.bank} · ${tx.transactionType}`]);
    };
  }, [adbBridge, autoTxListenerRef]);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    autoTxListenerRef.current = null;

    const recorded = recordedTxRef.current;
    if (recorded.length === 0) {
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} ⚠️ 錄製結束，沒有收到任何交易`]);
      return;
    }

    setLogs(prev => [...prev, `${new Date().toLocaleTimeString('zh-TW')} ⏹️ 錄製結束，共 ${recorded.length} 筆交易，正在產生腳本...`]);
    const script = transactionsToScript(recorded, `錄製腳本 ${new Date().toLocaleString('zh-TW')}`);
    setEditingScript(script);
  }, [autoTxListenerRef]);

  const handleExportJson = useCallback((script: AutoTestScript) => {
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.name.replace(/[^\w一-鿿]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const allScripts = [...PRESET_SCRIPTS, ...customScripts];

  const toggleStep = (idx: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const summary = stepResults.length > 0 ? {
    total: stepResults.length,
    passed: stepResults.filter(r => r.status === 'passed').length,
    failed: stepResults.filter(r => r.status === 'failed').length,
    running: stepResults.filter(r => r.status === 'running' || r.status === 'waiting_card').length,
  } : null;

  const isPreset = (id: string) => PRESET_SCRIPTS.some(s => s.id === id);

  return (
    <div className="space-y-4">
      {/* POS Bridge 連線狀態 */}
      <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--fg)] flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            POS Auto Bridge
          </h3>
          <div className="flex items-center gap-2">
            {posStatus.connected
              ? <span className="badge badge-success flex items-center gap-1"><Wifi className="w-3 h-3" /> 已連線</span>
              : <span className="badge badge-error flex items-center gap-1"><WifiOff className="w-3 h-3" /> 未連線</span>
            }
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <code className="text-xs text-[var(--fg-muted)] bg-[var(--surface-2)] px-2 py-1 rounded">ws://127.0.0.1:8766</code>
          {posStatus.connected ? (
            <button
              onClick={() => posBridgeRef.current?.disconnect()}
              className="btn-danger text-xs px-3 py-1.5"
            >
              斷線
            </button>
          ) : (
            <button
              onClick={handleConnectBridge}
              className="btn-primary text-xs px-3 py-1.5"
            >
              連線
            </button>
          )}
        </div>

        {!posStatus.connected && (
          <div className="text-xs text-[var(--fg-subtle)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
            請先啟動 <code className="bg-[var(--surface-3)] px-1 rounded">pos_auto_bridge.py</code>，再點「連線」
          </div>
        )}

        {posStatus.connected && (
          <div className="flex items-center gap-2">
            <select
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              className="flex-1 h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
            >
              <option value="">選擇 POS 設備</option>
              {posStatus.devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={() => posBridgeRef.current?.listDevices()} className="toolbar-btn text-xs">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleConnectDevice}
              disabled={!selectedDevice}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              連接設備
            </button>
          </div>
        )}

        {posStatus.activeDevice && (
          <div className="mt-2 text-xs text-[var(--emerald-ink)]">
            ✅ 已連接設備：{posStatus.activeDevice}
          </div>
        )}

        {/* 無虛擬鍵盤模式 */}
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={noVirtualKeypad}
            onChange={e => {
              setNoVirtualKeypad(e.target.checked);
              localStorage.setItem('pos-no-virtual-keypad', String(e.target.checked));
            }}
            className="rounded border-[var(--border-strong)]"
          />
          無虛擬鍵盤（跳過按鈕偵測，直接用 keyevent 輸入）
        </label>
      </div>

      {/* 錄製控制 */}
      <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg)] flex items-center gap-2">
            <Circle className={`w-4 h-4 ${isRecording ? 'text-red-500 fill-red-500 animate-pulse' : 'text-[var(--fg-subtle)]'}`} />
            交易錄製
          </h3>
          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <span className="text-xs text-red-400 animate-pulse">錄製中… 已收集 {recordedTxRef.current.length} 筆</span>
                <button
                  onClick={handleStopRecording}
                  className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" /> 停止錄製
                </button>
              </>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={!adbBridge || runStatus === 'running'}
                className="toolbar-btn text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                title="開始錄製：在 POS 上操作交易，電文自動收集為腳本"
              >
                <Circle className="w-3.5 h-3.5 text-red-400" /> 開始錄製
              </button>
            )}
          </div>
        </div>
        {!isRecording && (
          <p className="text-xs text-[var(--fg-subtle)] mt-2">
            錄製模式會監聽 ADB Bridge 的交易電文，自動產生自動化腳本。請確保 ADB Bridge 已連線並選好監聽設備。
          </p>
        )}
      </div>

      {/* 腳本選擇 */}
      <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--fg)]">測試腳本</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleNewScript} className="toolbar-btn text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> 新建腳本
            </button>
            <button onClick={handleImportScript} className="toolbar-btn text-xs flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" /> 匯入 JSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {allScripts.map(script => (
            <div
              key={script.id}
              className={`group relative text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                selectedScript?.id === script.id
                  ? 'border-[var(--blue-line)] bg-[var(--blue-soft)] text-[var(--blue-ink)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:bg-[var(--surface-3)]'
              }`}
              onClick={() => {
                setSelectedScript(script);
                setStepResults([]);
                setLogs([]);
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{script.name}</div>
                  {script.description && (
                    <div className="text-xs mt-0.5 opacity-75">{script.description}</div>
                  )}
                  <div className="text-xs mt-1 opacity-60">
                    {script.steps.length} 步驟
                    {isPreset(script.id) && <span className="ml-2 opacity-50">· 預設</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleEditScript(script)}
                    className="p-1.5 rounded hover:bg-[var(--surface-3)] text-[var(--fg-muted)]"
                    title="編輯"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleExportJson(script)}
                    className="p-1.5 rounded hover:bg-[var(--surface-3)] text-[var(--fg-muted)]"
                    title="匯出 JSON"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {!isPreset(script.id) && (
                    <button
                      onClick={() => handleDeleteScript(script.id)}
                      className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red-ink)]"
                      title="刪除"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 執行控制 */}
      {selectedScript && (
        <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--fg)]">
              {selectedScript.name}
            </h3>
            <div className="flex items-center gap-2">
              {summary && (
                <div className="flex items-center gap-3 text-xs mr-2">
                  <span className="text-[var(--emerald-ink)]">✅ {summary.passed}</span>
                  <span className="text-[var(--red-ink)]">❌ {summary.failed}</span>
                  {summary.running > 0 && <span className="text-[var(--blue-ink)]">⏳ {summary.running}</span>}
                  <span className="text-[var(--fg-subtle)]">共 {summary.total}</span>
                </div>
              )}
              {runStatus === 'idle' || runStatus === 'completed' || runStatus === 'aborted' ? (
                <button
                  onClick={handleRun}
                  disabled={!posStatus.connected || !posStatus.activeDevice || isRecording}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" /> 開始執行
                </button>
              ) : (
                <button
                  onClick={handleAbort}
                  className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" /> 中止
                </button>
              )}
            </div>
          </div>

          {/* 步驟列表 */}
          <div className="space-y-1.5">
            {selectedScript.steps.map((step, idx) => {
              const result = stepResults[idx];
              const expanded = expandedSteps.has(idx);
              const statusKey = result?.status ?? 'pending';

              return (
                <div key={step.id} className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleStep(idx)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-3)] transition-colors"
                  >
                    {STATUS_ICON[statusKey]}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--fg)] truncate">
                        {idx + 1}. {step.name}
                      </div>
                      {step.description && (
                        <div className="text-xs text-[var(--fg-subtle)] truncate">{step.description}</div>
                      )}
                    </div>
                    <div className="text-xs text-[var(--fg-subtle)]">
                      {step.posAction.funcName}
                      {step.posAction.amount ? ` $${step.posAction.amount}` : ''}
                      {step.posAction.payMethod ? ` · ${step.posAction.payMethod}` : ''}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRunSingle(idx); }}
                      disabled={runStatus === 'running' || !posStatus.connected || !posStatus.activeDevice}
                      className="p-1 rounded hover:bg-[var(--blue-soft)] text-[var(--blue-ink)] disabled:opacity-30 disabled:cursor-not-allowed"
                      title="單步執行此步驟"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    {expanded ? <ChevronDown className="w-4 h-4 text-[var(--fg-subtle)]" /> : <ChevronRight className="w-4 h-4 text-[var(--fg-subtle)]" />}
                  </button>

                  {expanded && result && (
                    <div className="border-t border-[var(--border)] px-3 py-2 bg-[var(--surface-2)] text-xs space-y-1.5">
                      {result.status === 'waiting_card' && (
                        <div className="flex items-center gap-2 text-[var(--amber-ink)] font-medium animate-pulse">
                          <CreditCard className="w-4 h-4" /> 等待刷卡 / 插卡 / 感應...
                        </div>
                      )}
                      {result.authCode && (
                        <div className="text-[var(--fg-muted)]">授權碼：{result.authCode} | RRN：{result.rrn} | 調閱：{result.traceNumber}</div>
                      )}
                      {result.screenshot && (
                        <details className="mt-1">
                          <summary className="text-[var(--fg-subtle)] cursor-pointer hover:text-[var(--fg-muted)]">
                            POS 截圖
                          </summary>
                          <img
                            src={`data:image/png;base64,${result.screenshot}`}
                            alt="POS screenshot"
                            className="mt-1 rounded border border-[var(--border)] max-w-[240px]"
                          />
                        </details>
                      )}
                      {result.error && (
                        <div className="text-[var(--red-ink)]">❌ {result.error}</div>
                      )}
                      {result.progressMessages.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-[var(--fg-subtle)] cursor-pointer hover:text-[var(--fg-muted)]">
                            進度訊息 ({result.progressMessages.length})
                          </summary>
                          <pre className="mt-1 p-2 bg-[var(--surface)] rounded text-[10px] leading-relaxed max-h-32 overflow-y-auto font-mono text-[var(--fg-subtle)]">
                            {result.progressMessages.join('\n')}
                          </pre>
                        </details>
                      )}
                      {result.transaction && (
                        <>
                          <div className={`mt-1 px-2 py-1 rounded ${result.transaction.pass ? 'bg-[var(--emerald-soft)] text-[var(--emerald-ink)]' : 'bg-[var(--red-soft)] text-[var(--red-ink)]'}`}>
                            電文驗證：{result.transaction.pass ? '通過' : '失敗'}
                            {result.transaction.steps.map((s, si) => (
                              <span key={si} className="ml-2">[{s.stepName}: {s.pass ? '✅' : '❌'}]</span>
                            ))}
                          </div>
                          {result.transaction.steps.some(s => s.rawLog) && (
                            <details className="mt-1">
                              <summary className="text-[var(--fg-subtle)] cursor-pointer hover:text-[var(--fg-muted)]">
                                電文 Raw Data
                              </summary>
                              <pre className="mt-1 p-2 bg-[var(--surface)] rounded text-[10px] leading-relaxed max-h-48 overflow-y-auto font-mono text-[var(--fg-subtle)] whitespace-pre-wrap break-all">
                                {result.transaction.steps.map((s, si) => (
                                  s.rawLog ? `── ${s.stepName} (MTI: ${s.mti}) ──\n${s.rawLog}\n\n` : ''
                                )).join('')}
                              </pre>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 執行日誌 */}
      {logs.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--fg)] mb-2">執行日誌</h3>
          <pre className="text-xs font-mono text-[var(--fg-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 max-h-48 overflow-y-auto leading-relaxed">
            {logs.join('\n')}
          </pre>
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Script Editor Modal */}
      {editingScript && (
        <ScriptEditor
          script={editingScript}
          rules={rules}
          onSave={handleSaveScript}
          onCancel={() => setEditingScript(null)}
        />
      )}
    </div>
  );
}
