import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, Wifi, WifiOff, Loader2, CheckCircle2, XCircle,
  AlertCircle, Smartphone, ChevronDown, ChevronRight, CreditCard,
  RotateCcw, Upload, Plus,
} from 'lucide-react';
import type {
  AutoTestScript, AutoTestStep, AutoStepResult, AutoRunStatus,
  AutoPosAction, AllRules, TransactionResult, PosBridgeStatus,
} from '../types';
import { PosBridge } from '../services/posBridge';
import { AdbBridge } from '../services/adbBridge';
import { AutoTestRunner } from '../services/autoTestRunner';

interface Props {
  rules: AllRules;
  adbBridge: AdbBridge | null;
  onTransaction: (tx: TransactionResult) => void;
}

const PRESET_SCRIPTS: AutoTestScript[] = [
  {
    id: 'chb-agg-basic',
    name: 'CHB 聚合支付 — 基本流程',
    description: '信用卡銷售 → 取消 → 銷售 → 退貨 → 結帳',
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
        id: 's4', name: '退貨 $200', bank: '彰銀CHB聚合支付', transType: '授權通知-退貨',
        posAction: {
          funcName: '退貨交易', amount: '200', payMethod: '信用卡',
          authRef: '{{sale2.authCode}}', txDateRef: '{{sale2.txDate}}',
        },
      },
      {
        id: 's5', name: '結帳', bank: '彰銀CHB聚合支付', transType: '結帳',
        posAction: { funcName: '結帳作業' },
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
          rrnRef: '{{cup_sale2.rrn}}',
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
        posAction: { funcName: '銷售交易', amount: '100', payMethod: 'SmartPay', transType: '一般交易' },
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

export default function AutoTestPanel({ rules, adbBridge, onTransaction }: Props) {
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
    bridge.connect();
    return () => bridge.disconnect();
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
    );
    runnerRef.current = runner;

    await runner.runScript(selectedScript);
    runnerRef.current = null;
  }, [selectedScript, adbBridge, rules, onTransaction]);

  const handleAbort = useCallback(() => {
    runnerRef.current?.abort();
  }, []);

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

        {!posStatus.connected && (
          <div className="text-xs text-[var(--fg-subtle)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
            請確認 <code className="bg-[var(--surface-3)] px-1 rounded">pos_auto_bridge.py</code> 正在執行（ws://localhost:8766）
          </div>
        )}

        {posStatus.connected && (
          <div className="flex items-center gap-2">
            <select
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              className="flex-1 h-8 px-2 rounded-lg text-sm"
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
              連接
            </button>
          </div>
        )}

        {posStatus.activeDevice && (
          <div className="mt-2 text-xs text-[var(--emerald-ink)]">
            ✅ 已連接：{posStatus.activeDevice}
          </div>
        )}
      </div>

      {/* 腳本選擇 */}
      <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--fg)]">測試腳本</h3>
          <button onClick={handleImportScript} className="toolbar-btn text-xs">
            <Upload className="w-3.5 h-3.5" /> 匯入腳本
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {allScripts.map(script => (
            <button
              key={script.id}
              onClick={() => {
                setSelectedScript(script);
                setStepResults([]);
                setLogs([]);
              }}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                selectedScript?.id === script.id
                  ? 'border-[var(--blue-line)] bg-[var(--blue-soft)] text-[var(--blue-ink)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:bg-[var(--surface-3)]'
              }`}
            >
              <div className="font-medium text-sm">{script.name}</div>
              {script.description && (
                <div className="text-xs mt-0.5 opacity-75">{script.description}</div>
              )}
              <div className="text-xs mt-1 opacity-60">{script.steps.length} 步驟</div>
            </button>
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
                  disabled={!posStatus.connected || !posStatus.activeDevice}
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
                        <div className={`mt-1 px-2 py-1 rounded ${result.transaction.pass ? 'bg-[var(--emerald-soft)] text-[var(--emerald-ink)]' : 'bg-[var(--red-soft)] text-[var(--red-ink)]'}`}>
                          電文驗證：{result.transaction.pass ? '通過' : '失敗'}
                          {result.transaction.steps.map((s, si) => (
                            <span key={si} className="ml-2">[{s.stepName}: {s.pass ? '✅' : '❌'}]</span>
                          ))}
                        </div>
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
    </div>
  );
}
