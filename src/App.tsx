import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, FlaskConical, Settings, Wifi, WifiOff, Loader2, AlertTriangle, BookOpen, Terminal, Download, X, Zap, Copy, Pencil, Check } from 'lucide-react';
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
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isBridgeLaunching, setIsBridgeLaunching] = useState(false);
  const [bridgePort, setBridgePort] = useState<string>(
    () => localStorage.getItem('pos-bridge-port') ?? '8765'
  );
  const [isEditingPort, setIsEditingPort] = useState(false);
  const [portDraft, setPortDraft] = useState(bridgePort);

  const psScript = `$dir = Get-Location
$batPath = Join-Path $dir "start_bridge.bat"
$regPath = "HKCU:\\Software\\Classes\\pos-bridge-runner"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:POS Bridge Runner Protocol"
Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
$cmdPath = Join-Path $regPath "shell\\open\\command"
New-Item -Path $cmdPath -Force | Out-Null
Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value "\`"$batPath\`""
Write-Host "✅ 註冊成功！現在網頁可以直接啟動 ADB Bridge 了。" -ForegroundColor Green`;

  const bridgeRef = useRef<AdbBridge | null>(null);

  // ── 初始化 Bridge（port 變更時重建）────────────────────────────────────────

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
    }, `ws://127.0.0.1:${bridgePort}`);
    bridgeRef.current = bridge;

    return () => bridge.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgePort]);

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

  const handleStartBridge = useCallback(() => {
    setIsBridgeLaunching(true);
    const a = document.createElement('a');
    a.href = 'pos-bridge-runner://run';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 等 Bridge 程式啟動後再建立 WebSocket 連線
    setTimeout(() => {
      setIsBridgeLaunching(false);
      bridgeRef.current?.connect();
    }, 2500);
  }, []);

  const handleConfirmPort = useCallback(() => {
    const p = portDraft.trim().replace(/\D/g, '');
    if (!p) return;
    setBridgePort(p);
    localStorage.setItem('pos-bridge-port', p);
    setIsEditingPort(false);
  }, [portDraft]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
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

      {/* ── Bridge 斷線提示橫幅 ──────────────────────────── */}
      {(connStatus === 'disconnected' || connStatus === 'error') && activeTab !== 'help' && (
        <div className="bg-amber-950/60 border-b border-amber-700/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-amber-200 text-sm flex-1 flex items-center gap-2 flex-wrap">
              ADB Bridge 未執行，請點擊右側按鈕啟動。
              <span className="flex items-center gap-1 text-amber-400 text-xs">
                Port:
                {isEditingPort ? (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={portDraft}
                      onChange={e => setPortDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleConfirmPort(); if (e.key === 'Escape') setIsEditingPort(false); }}
                      autoFocus
                      className="w-16 px-1.5 py-0.5 bg-slate-800 border border-amber-500 rounded text-amber-200 text-xs font-mono focus:outline-none"
                    />
                    <button onClick={handleConfirmPort} className="text-emerald-400 hover:text-emerald-300">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setPortDraft(bridgePort); setIsEditingPort(true); }}
                    className="font-mono text-amber-200 hover:text-white flex items-center gap-0.5 underline decoration-dotted"
                  >
                    {bridgePort} <Pencil className="w-3 h-3" />
                  </button>
                )}
              </span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleStartBridge}
                disabled={isBridgeLaunching}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
              >
                {isBridgeLaunching
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 啟動中…</>
                  : <><Zap className="w-3.5 h-3.5" /> 啟動 ADB Bridge</>}
              </button>
              <button
                onClick={() => setShowSetupModal(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
              >
                首次設定
              </button>
              <button
                onClick={() => setActiveTab('help')}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
              >
                <Terminal className="w-3.5 h-3.5" /> 查看說明
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── 首次設定 Modal ────────────────────────────────── */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowSetupModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" /> 首次設定：一鍵啟動 Bridge
              </h2>
              <button onClick={() => setShowSetupModal(false)} className="p-1 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-300">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-1.5">
                <p className="font-semibold text-slate-100">設定步驟（只需做一次）</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-400 ml-1">
                  <li>下載 <a href="/start_bridge.bat" download="start_bridge.bat" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"><Download className="w-3 h-3" />start_bridge.bat</a> 與 <a href="/adb_bridge.py" download="adb_bridge.py" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"><Download className="w-3 h-3" />adb_bridge.py</a>，放到同一個固定資料夾（例如 <code className="bg-slate-700 px-1 rounded">D:\Tools\POS-Bridge\</code>）。</li>
                  <li>在那個資料夾的<strong className="text-slate-200">網址列</strong>輸入 <code className="bg-slate-700 px-1 rounded">powershell</code> 按 Enter。</li>
                  <li>在彈出的 PowerShell 視窗貼上以下指令，按 Enter。</li>
                </ol>
              </div>

              <div className="relative group">
                <pre className="bg-slate-950 text-emerald-300 p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">{psScript}</pre>
                <button
                  onClick={() => copyToClipboard(psScript)}
                  className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-slate-700/80 hover:bg-slate-600 text-slate-200"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? '已複製！' : '複製指令'}
                </button>
              </div>

              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-4">
                <p className="text-emerald-300 font-medium mb-1">設定完成後</p>
                <p className="text-slate-400">關閉此視窗，橫幅上的「啟動 ADB Bridge」按鈕就能直接啟動 Bridge，不需再手動找資料夾。</p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 flex justify-end">
              <button onClick={() => setShowSetupModal(false)} className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium transition-colors">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
