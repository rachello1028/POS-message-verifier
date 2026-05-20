import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, FlaskConical, Settings, Wifi, WifiOff, Loader2, AlertTriangle, BookOpen } from 'lucide-react';
import TestPanel from './components/TestPanel';
import ConfigPanel from './components/ConfigPanel';
import HelpPanel from './components/HelpPanel';
import type { AllRules, ConnectionStatus, TransactionResult, TransactionStep } from './types';
import { AdbBridge } from './services/adbBridge';

const EMPTY_RULES: AllRules = {};

export default function App() {
  const [activeTab, setActiveTab] = useState<'test' | 'config' | 'help'>('test');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [connMsg, setConnMsg] = useState('');
  const [devices, setDevices] = useState<string[]>([]);
  const [rules, setRules] = useState<AllRules>(EMPTY_RULES);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const bridgeRef = useRef<AdbBridge | null>(null);

  // ── 初始化 Bridge ──────────────────────────────────────────────────────────

  useEffect(() => {
    const bridge = new AdbBridge({
      onStatus: (status, msg) => {
        setConnStatus(status);
        if (msg) setConnMsg(msg);
      },
      onDevices: (list) => setDevices(list),
      onRules: (r) => setRules(r),
      onRulesSaved: () => {},
      onTransaction: (tx) => setTransactions(prev => [...prev, tx]),
      onError: (msg) => console.error('[Bridge Error]', msg),
    });
    bridgeRef.current = bridge;
    bridge.connect();

    return () => bridge.disconnect();
  }, []);

  // ── 控制函式 ──────────────────────────────────────────────────────────────

  const handleRefreshDevices = useCallback(() => {
    bridgeRef.current?.refreshDevices();
  }, []);

  const handleStartMonitor = useCallback(
    (device: string, bank: string, transType: string, steps: TransactionStep[]) => {
      const b = bridgeRef.current;
      if (!b) return;
      b.setTestTarget(bank, transType, steps);
      b.startLogcat(device);
      setIsMonitoring(true);
    },
    []
  );

  const handleStopMonitor = useCallback(() => {
    bridgeRef.current?.stopLogcat();
    setIsMonitoring(false);
  }, []);

  const handleClearResults = useCallback(() => {
    setTransactions([]);
    bridgeRef.current?.resetTransaction();
  }, []);

  const handleSaveRules = useCallback((updated: AllRules) => {
    setRules(updated);
    bridgeRef.current?.saveRules(updated);
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  const tabs: { id: 'test' | 'config' | 'help'; label: string; icon: React.ReactNode }[] = [
    { id: 'test',   label: '測試驗証面板', icon: <FlaskConical className="w-4 h-4" /> },
    { id: 'config', label: '規格設定管理', icon: <Settings className="w-4 h-4" /> },
    { id: 'help',   label: '操作說明',     icon: <BookOpen className="w-4 h-4" /> },
  ];

  const StatusBadge = () => {
    const map: Record<ConnectionStatus, { icon: React.ReactNode; label: string; cls: string }> = {
      connected:    { icon: <Wifi className="w-3.5 h-3.5" />,                          label: 'Bridge 已連線',   cls: 'text-emerald-400' },
      connecting:   { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,          label: '連線中…',        cls: 'text-amber-400'   },
      disconnected: { icon: <WifiOff className="w-3.5 h-3.5" />,                       label: 'Bridge 未連線',   cls: 'text-slate-500'   },
      error:        { icon: <AlertTriangle className="w-3.5 h-3.5" />,                  label: '連線失敗',        cls: 'text-red-400'     },
    };
    const { icon, label, cls } = map[connStatus];
    return (
      <div className={`flex items-center gap-1.5 text-xs ${cls}`} title={connMsg}>
        {icon} {label}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-base text-slate-100 leading-tight">POS 電文驗証平台</h1>
                <p className="text-xs text-slate-500">ISO 8583 規格化驗証工具</p>
              </div>
            </div>
            <StatusBadge />
          </div>
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === 'test' && transactions.length > 0 && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === 'test' ? 'bg-blue-500' : 'bg-slate-700'
                }`}>
                  {transactions.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── 主內容 ──────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'test' && (
          <TestPanel
            rules={rules}
            devices={devices}
            connStatus={connStatus}
            transactions={transactions}
            isMonitoring={isMonitoring}
            onRefreshDevices={handleRefreshDevices}
            onStartMonitor={handleStartMonitor}
            onStopMonitor={handleStopMonitor}
            onClearResults={handleClearResults}
          />
        )}
        {activeTab === 'config' && (
          <ConfigPanel
            rules={rules}
            onSave={handleSaveRules}
          />
        )}
        {activeTab === 'help' && <HelpPanel />}
      </main>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-slate-800 bg-slate-900/60 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-10 flex items-center justify-between">
          <span className="text-xs text-slate-600">
            POS 電文驗証平台 &mdash; ISO 8583 規格化驗証工具
          </span>
          <span className="text-xs text-slate-600">
            &copy; {new Date().getFullYear()} Rachel Lo. All rights reserved.
          </span>
        </div>
      </footer>
    </div>
  );
}
