import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, FlaskConical, Settings, Wifi, WifiOff, Loader2, AlertTriangle, BookOpen, Terminal, Download, X, Zap, Copy, Pencil, Check, CheckCircle2, Sun, Moon } from 'lucide-react';
import TestPanel from './components/TestPanel';
import ConfigPanel from './components/ConfigPanel';
import HelpPanel from './components/HelpPanel';
import type { AllRules, ConnectionStatus, TransactionResult, TransactionStep } from './types';
import { AdbBridge } from './services/adbBridge';

const EMPTY_RULES: AllRules = {};

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('pos-theme') as 'dark' | 'light') ?? 'dark';
  });
  const [activeTab, setActiveTab] = useState<'test' | 'config' | 'help'>('test');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [connMsg, setConnMsg] = useState('');
  const [devices, setDevices] = useState<string[]>([]);
  const [rules, setRules] = useState<AllRules>(() => {
    try {
      const cached = localStorage.getItem('pos-rules-cache');
      if (cached) return JSON.parse(cached) as AllRules;
    } catch { /* ignore */ }
    return EMPTY_RULES;
  });
  const [transactions, setTransactions] = useState<TransactionResult[]>(() => {
    try {
      const cached = localStorage.getItem('pos-transactions');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [hasEverConnected, setHasEverConnected] = useState(false);
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
Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value ('"{0}"' -f $batPath)
Write-Host "✅ 註冊成功！現在網頁可以直接啟動 ADB Bridge 了。" -ForegroundColor Green`;

  const bridgeRef = useRef<AdbBridge | null>(null);

  // ── 交易結果持久化（sessionStorage，F5 保留、關分頁清除）────────────────────

  useEffect(() => {
    localStorage.setItem('pos-transactions', JSON.stringify(transactions));
  }, [transactions]);

  // ── 主題切換 ───────────────────────────────────────────────────────────────

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pos-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // ── 初始化 Bridge（port 變更時重建）────────────────────────────────────────

  useEffect(() => {
    const bridge = new AdbBridge({
      onStatus: (status, msg) => {
        setConnStatus(status);
        if (msg) setConnMsg(msg);
        if (status === 'connected') setHasEverConnected(true);
      },
      onDevices: (list) => setDevices(list),
      onRules: (r) => {
        // 優先使用本地緩存（用戶匯入的）；若無緩存才採用 Bridge 傳來的
        const cached = localStorage.getItem('pos-rules-cache');
        if (cached) {
          try {
            const local = JSON.parse(cached) as AllRules;
            setRules(local);
            // 將本地版本同步回 Bridge 檔案
            bridgeRef.current?.saveRules(local);
            return;
          } catch { /* ignore, fall through */ }
        }
        setRules(r);
        localStorage.setItem('pos-rules-cache', JSON.stringify(r));
      },
      onRulesSaved: () => {},
      onTransaction: (tx) => setTransactions(prev => [...prev, tx]),
      onError: (msg) => console.error('[Bridge Error]', msg),
    }, `ws://127.0.0.1:${bridgePort}`);
    bridgeRef.current = bridge;

    // 從 sessionStorage 恢復的交易 ID 接續，避免新交易 ID 重複
    try {
      const cached = localStorage.getItem('pos-transactions');
      if (cached) {
        const restored = JSON.parse(cached) as TransactionResult[];
        if (restored.length > 0) {
          const maxId = Math.max(...restored.map(t => t.id));
          bridge.setTxCounter(maxId);
        }
      }
    } catch { /* ignore */ }

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

  // 監聽中切換交易類型時，同步更新 bridge 的 test target
  const handleUpdateTestTarget = useCallback(
    (bank: string, transType: string, steps: TransactionStep[]) => {
      const b = bridgeRef.current;
      if (!b) return;
      b.setTestTarget(bank, transType, steps);
    },
    []
  );

  const handleClearResults = useCallback(() => {
    setTransactions([]);
    bridgeRef.current?.resetTransaction();
  }, []);

  const handleSaveRules = useCallback((updated: AllRules) => {
    setRules(updated);
    localStorage.setItem('pos-rules-cache', JSON.stringify(updated));
    bridgeRef.current?.saveRules(updated);
  }, []);

  const handleStartBridge = useCallback(() => {
    setIsBridgeLaunching(true);
    const a = document.createElement('a');
    a.href = `pos-bridge-runner://run?port=${bridgePort}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 等 Bridge 程式啟動後再建立 WebSocket 連線
    setTimeout(() => {
      setIsBridgeLaunching(false);
      bridgeRef.current?.connect();
      // 再等 3 秒，若還是沒連上就提示用戶需要首次設定或手動啟動
      setTimeout(() => {
        if (bridgeRef.current && connStatus !== 'connected') {
          setShowSetupModal(true);
        }
      }, 3000);
    }, 2500);
  }, [connStatus]);

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
      connected:    { icon: <Wifi className="w-3.5 h-3.5" />,                          label: 'Bridge 已連線',   cls: 'text-[var(--emerald-ink)]' },
      connecting:   { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,          label: '連線中…',        cls: 'text-[var(--amber-ink)]'   },
      disconnected: { icon: <WifiOff className="w-3.5 h-3.5" />,                       label: 'Bridge 未連線',   cls: 'text-[var(--fg-subtle)]'   },
      error:        { icon: <AlertTriangle className="w-3.5 h-3.5" />,                  label: '連線失敗',        cls: 'text-[var(--red-ink)]'     },
    };
    const { icon, label, cls } = map[connStatus];
    return (
      <div className={`flex items-center gap-1.5 text-xs ${cls}`} title={connMsg}>
        {icon} {label}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--fg)] font-sans flex flex-col">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[var(--primary)] rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-base text-[var(--fg)] leading-tight">POS 電文驗証平台</h1>
                <p className="text-xs text-[var(--fg-subtle)]">ISO 8583 規格化驗証工具</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge />
              <button
                onClick={toggleTheme}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-3)] text-[var(--fg-muted)]"
                title={theme === 'dark' ? '切換淺色模式' : '切換深色模式'}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-[var(--primary)] text-white shadow-md'
                  : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-3)]'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === 'test' && transactions.length > 0 && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === 'test' ? 'bg-[var(--primary-strong)]' : 'bg-[var(--surface-3)]'
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
        <div className="alert-banner-warning border-b border-amber-500/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-amber-300 text-sm flex-1 flex items-center gap-2 flex-wrap">
              {hasEverConnected
                ? <span>Bridge 連線已中斷{connMsg ? `（${connMsg}）` : ''}，請重新點擊啟動。</span>
                : 'ADB Bridge 未執行，請點擊右側按鈕啟動。'
              }
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
                      className="w-16 px-1.5 py-0.5 bg-[var(--surface-2)] border border-amber-500 rounded text-amber-200 text-xs font-mono focus:outline-none"
                    />
                    <button onClick={handleConfirmPort} className="text-[var(--emerald-ink)] hover:opacity-80">
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
                className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg"
              >
                {isBridgeLaunching
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 啟動中…</>
                  : <><Zap className="w-3.5 h-3.5" /> 啟動 ADB Bridge</>}
              </button>
              <a
                href="/start_bridge.bat"
                download="start_bridge.bat"
                className="toolbar-btn text-xs"
                title="下載後放到固定資料夾，雙擊執行即可（需搭配 adb_bridge.py）"
              >
                <Download className="w-3.5 h-3.5" /> 下載工具
              </a>
              <button
                onClick={() => setShowSetupModal(true)}
                className="toolbar-btn text-xs"
              >
                首次設定
              </button>
              <button
                onClick={() => setActiveTab('help')}
                className="toolbar-btn text-xs"
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
            onDeleteTransaction={(id) => setTransactions(prev => prev.filter(tx => tx.id !== id))}
            onUpdateTestTarget={handleUpdateTestTarget}
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
      <footer className="border-t border-[var(--border)] bg-[var(--surface)]/60 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-10 flex items-center justify-between">
          <span className="text-xs text-[var(--fg-subtle)]">
            POS 電文驗証平台 &mdash; ISO 8583 規格化驗証工具
          </span>
          <span className="text-xs text-[var(--fg-subtle)]">
            Designed &amp; Architected by Rachel Lo
          </span>
        </div>
      </footer>

      {/* ── 首次設定 Modal ────────────────────────────────── */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowSetupModal(false)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--fg)] flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--emerald-ink)]" /> 首次設定：一鍵啟動 Bridge
              </h2>
              <button onClick={() => setShowSetupModal(false)} className="p-1 hover:bg-[var(--surface-3)] rounded-lg transition-colors text-[var(--fg-muted)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-sm text-[var(--fg-muted)]">
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-1.5">
                <p className="font-semibold text-[var(--fg)]">設定步驟（只需做一次）</p>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--fg-subtle)] ml-1">
                  <li>下載 <a href="/start_bridge.bat" download="start_bridge.bat" className="text-[var(--blue-ink)] hover:underline inline-flex items-center gap-1"><Download className="w-3 h-3" />start_bridge.bat</a> 與 <a href="/adb_bridge.py" download="adb_bridge.py" className="text-[var(--blue-ink)] hover:underline inline-flex items-center gap-1"><Download className="w-3 h-3" />adb_bridge.py</a>，放到同一個固定資料夾（例如 <code className="bg-[var(--surface-3)] px-1 rounded">D:\Tools\POS-Bridge\</code>）。</li>
                  <li>在那個資料夾的<strong className="text-[var(--fg)]">網址列</strong>輸入 <code className="bg-[var(--surface-3)] px-1 rounded">powershell</code> 按 Enter。</li>
                  <li>在彈出的 PowerShell 視窗貼上以下指令，按 Enter。</li>
                </ol>
              </div>

              <div className="relative group">
                <pre className="bg-[#0b0f19] text-[#38bdf8] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-[#1e293b]">{psScript}</pre>
                <button
                  onClick={() => copyToClipboard(psScript)}
                  className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[#1e293b]/80 hover:bg-[#334155] text-slate-300"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? '已複製！' : '複製指令'}
                </button>
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                <p className="text-[var(--amber-ink)] font-medium mb-1">替代方案：手動啟動（不需要註冊協定）</p>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--fg-subtle)] ml-1">
                  <li>下載上述兩個檔案到同一個資料夾</li>
                  <li>直接雙擊執行 <code className="bg-[#0b0f19] text-[#38bdf8] px-1.5 py-0.5 rounded text-xs font-mono">start_bridge.bat</code></li>
                  <li>等待終端機顯示「WebSocket Server started」</li>
                  <li>回到網頁，重新整理頁面即可連線</li>
                </ol>
              </div>

              <p className="text-xs text-[var(--emerald-ink)] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                設定完成後，關閉此視窗即可從橫幅的按鈕直接啟動 Bridge。
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
