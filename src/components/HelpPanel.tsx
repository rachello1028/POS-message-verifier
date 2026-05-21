import React, { useState, useCallback } from 'react';
import {
  Terminal, Wifi, FlaskConical, Settings, Copy,
  CheckCircle2, Download, ChevronDown, ChevronRight,
  BookOpen, Zap, AlertTriangle, Info, Package, Check
} from 'lucide-react';

// ── 可折疊的區段 ────────────────────────────────────────────────────────────
function Section({
  icon, title, children, defaultOpen = false
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
      >
        <span className="text-blue-400">{icon}</span>
        <span className="font-semibold text-slate-100 text-sm flex-1">{title}</span>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-5 py-4 bg-slate-900/40 text-sm text-slate-300 leading-relaxed space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── 步驟標籤 ────────────────────────────────────────────────────────────────
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 flex-shrink-0 rounded-full bg-blue-900 text-blue-200 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ── inline code ─────────────────────────────────────────────────────────────
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-slate-800 text-amber-300 font-mono text-xs px-1.5 py-0.5 rounded">
      {children}
    </code>
  );
}

// ── 提示框 ─────────────────────────────────────────────────────────────────
function Tip({ type = 'info', children }: { type?: 'info' | 'warn'; children: React.ReactNode }) {
  const cls = type === 'warn'
    ? 'bg-amber-950/30 border-amber-700/50 text-amber-200'
    : 'bg-blue-950/30 border-blue-700/50 text-blue-200';
  const icon = type === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />;
  return (
    <div className={`flex gap-2 px-3 py-2.5 rounded-lg border text-xs ${cls}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

// ── Protocol 註冊指令區塊 ───────────────────────────────────────────────────
function ProtocolRegisterScript() {
  const [copied, setCopied] = useState(false);
  const script = `$dir = Get-Location
$batPath = Join-Path $dir "start_bridge.bat"
$regPath = "HKCU:\\Software\\Classes\\pos-bridge-runner"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:POS Bridge Runner Protocol"
Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
$cmdPath = Join-Path $regPath "shell\\open\\command"
New-Item -Path $cmdPath -Force | Out-Null
Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value ('"{0}"' -f $batPath)
Write-Host "✅ 註冊成功！現在網頁可以直接啟動 ADB Bridge 了。" -ForegroundColor Green`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [script]);

  return (
    <div className="relative mt-2">
      <pre className="bg-slate-950 text-emerald-300 p-3 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap">{script}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors bg-slate-700/80 hover:bg-slate-600 text-slate-200"
      >
        {copied ? <><Check className="w-3 h-3" /> 已複製！</> : <><Copy className="w-3 h-3" /> 複製指令</>}
      </button>
    </div>
  );
}

// ── 下載工具包 ──────────────────────────────────────────────────────────────
function DownloadSection() {
  const files = [
    { name: 'start_bridge.bat', desc: '橋接程式啟動腳本（Windows）',        hint: '首次設定時下載，完成協議註冊後由網頁按鈕自動呼叫', highlight: true },
    { name: 'adb_bridge.py',    desc: 'ADB WebSocket Bridge（Python）',    hint: '主要橋接程式，與 bat 放在同一資料夾' },
    { name: 'pos_rules.json',   desc: '電文驗証規格設定檔',                hint: '可匯入規格設定管理頁面編輯' },
  ];

  const download = (filename: string) => {
    const a = document.createElement('a');
    a.href = `/${filename}`;
    a.download = filename;
    a.click();
  };

  return (
    <div className="space-y-2">
      <p className="text-slate-400 text-xs mb-3">下列檔案放置於工具根目錄，首次使用請先下載到本機：</p>
      {files.map(f => (
        <div key={f.name} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${
          (f as { highlight?: boolean }).highlight
            ? 'bg-amber-950/30 border-amber-700/50'
            : 'bg-slate-800/60 border-slate-700'
        }`}>
          <div>
            <p className={`font-mono text-xs ${(f as { highlight?: boolean }).highlight ? 'text-amber-300' : 'text-amber-300'}`}>{f.name}</p>
            <p className="text-slate-400 text-xs mt-0.5">{f.desc}</p>
            <p className="text-slate-500 text-xs">{f.hint}</p>
          </div>
          <button
            onClick={() => download(f.name)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 text-white rounded-lg transition-colors flex-shrink-0 ml-4 ${
              (f as { highlight?: boolean }).highlight
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            <Download className="w-3.5 h-3.5" /> 下載
          </button>
        </div>
      ))}
      <Tip>
        首次設定完成後，日常使用只需點擊頁面頂端橫幅的「啟動 ADB Bridge」按鈕，
        無需手動找資料夾或雙擊檔案。
      </Tip>
    </div>
  );
}

// ── 主元件 ──────────────────────────────────────────────────────────────────
export default function HelpPanel() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* 標題卡片 */}
      <div className="flex items-start gap-4 px-5 py-4 bg-gradient-to-r from-blue-950/60 to-slate-900/60 border border-blue-800/40 rounded-xl">
        <BookOpen className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="font-bold text-slate-100 text-base">POS 電文驗証平台 — 操作說明</h2>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            本工具透過 ADB logcat 即時擷取 POS 裝置的 ISO 8583 電文，
            並依照可自訂的銀行規格設定檔自動驗証每個欄位是否符合預期，
            適用於 EMV 晶片卡、感應、磁條等多種交易類型。
          </p>
        </div>
      </div>

      {/* ── 1. 環境需求 ── */}
      <Section icon={<Terminal className="w-4 h-4" />} title="1. 環境需求與初次設定" defaultOpen>
        <div className="space-y-3">
          <p className="text-slate-400">開始使用前，請確認以下環境已準備就緒：</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Python 3.9+',       hint: 'pip install websockets' },
              { label: 'ADB (Android Debug Bridge)', hint: '加入系統 PATH' },
              { label: 'USB 偵錯模式已開啟', hint: 'POS 裝置開發者選項' },
              { label: '現代瀏覽器',         hint: 'Chrome / Edge / Firefox' },
            ].map(r => (
              <div key={r.label} className="flex items-start gap-2 px-3 py-2 bg-slate-800/50 rounded-lg">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-200 text-xs font-medium">{r.label}</p>
                  <p className="text-slate-500 text-xs">{r.hint}</p>
                </div>
              </div>
            ))}
          </div>
          <Step n={1}>
            安裝 Python 套件：
            <Code>pip install websockets</Code>
          </Step>
          <Step n={2}>
            <strong className="text-slate-100">首次設定（只需做一次）</strong>
            <div className="mt-2 space-y-2">
              <p>2-1. 下載 <a href="/start_bridge.bat" download className="text-blue-400 hover:text-blue-300 underline">start_bridge.bat</a> 與 <a href="/adb_bridge.py" download className="text-blue-400 hover:text-blue-300 underline">adb_bridge.py</a>，放到同一個固定資料夾（例如 <Code>D:\Tools\POS-Bridge\</Code>）</p>
              <p>2-2. 在該資料夾的<strong className="text-slate-100">網址列</strong>輸入 <Code>powershell</Code> 按 Enter，開啟 PowerShell</p>
              <p>2-3. 複製並貼上以下指令，按 Enter 執行：</p>
              <ProtocolRegisterScript />
            </div>
          </Step>
          <Step n={3}>
            <strong className="text-slate-100">每次啟動（點按鈕即可）</strong>
            <br />
            Bridge 未執行時，頁面頂端會出現提示橫幅。點擊
            <span className="inline-flex items-center gap-1 bg-emerald-700 text-white text-xs px-1.5 py-0.5 rounded mx-1">
              <Zap className="w-3 h-3" /> 啟動 ADB Bridge
            </span>
            按鈕，Windows 會自動呼叫本機的橋接程式，無需手動找資料夾執行。
          </Step>
          <Step n={4}>
            Header 右上角顯示
            <span className="inline-flex items-center gap-1 text-emerald-400 text-xs mx-1">
              <Wifi className="w-3 h-3" /> Bridge 已連線
            </span>
            即表示連線成功，可開始測試。
          </Step>
          <Tip type="warn">
            若點擊「啟動 ADB Bridge」後仍未連線，請確認首次設定已完成（協議已註冊），
            且 <Code>adb_bridge.py</Code> 與 <Code>start_bridge.bat</Code> 放在登記時的同一資料夾。
          </Tip>
        </div>
      </Section>

      {/* ── 2. 測試驗証面板 ── */}
      <Section icon={<FlaskConical className="w-4 h-4" />} title="2. 測試驗証面板 — 即時監聽交易">
        <div className="space-y-3">
          <Step n={1}>
            <strong className="text-slate-100">連接 ADB 設備</strong>
            <br />
            透過 USB 連接 POS 裝置後，點選「<Code>↺ 刷新</Code>」按鈕，在「測試設備」下拉清單選取裝置序號。
          </Step>
          <Step n={2}>
            <strong className="text-slate-100">選擇銀行與交易類別</strong>
            <br />
            從「銀行 / 客戶」與「交易類別」下拉選取本次要驗証的規格。
            下方會顯示監測步驟（如主交易 0200 + TC Upload 0220）。
          </Step>
          <Step n={3}>
            <strong className="text-slate-100">開始監聽</strong>
            <br />
            點選「<span className="text-emerald-400 font-medium">▶ 開始監聽</span>」，底部顯示「正在監聽…」後，
            在 POS 裝置上執行交易。
          </Step>
          <Step n={4}>
            <strong className="text-slate-100">查看驗証結果</strong>
            <br />
            每筆交易完成後自動顯示結果卡片。展開可查看每個欄位的驗証明細：
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>綠色 = 欄位符合預期</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 flex items-center justify-center text-red-400 flex-shrink-0">✗</span>
                <span>紅色 = 欄位值錯誤或欄位不存在</span>
              </div>
            </div>
          </Step>
          <Tip>
            多段式交易（如晶片卡需上傳 TC）會自動依照步驟順序驗証，全部步驟通過才算整筆交易通過。
          </Tip>
        </div>
      </Section>

      {/* ── 3. 規格設定管理 ── */}
      <Section icon={<Settings className="w-4 h-4" />} title="3. 規格設定管理 — 自訂驗証規則">
        <div className="space-y-3">
          <p className="text-slate-400">可針對不同銀行／交易類型，自訂每個 ISO 8583 欄位的驗証規則。</p>

          <div className="space-y-2">
            <p className="text-slate-200 font-medium text-xs">新增銀行</p>
            <p>在左側「銀行 / 客戶」欄位下方輸入銀行名稱，按 <Code>+</Code> 或 Enter 建立。</p>
          </div>
          <div className="space-y-2">
            <p className="text-slate-200 font-medium text-xs">新增 / 複製交易</p>
            <p>
              在「交易類別」輸入新名稱，可選擇「複製自：xxx」來沿用現有規格後再修改。
              也可以直接在清單上 hover 交易名稱，點擊 <Copy className="w-3 h-3 inline" /> 圖示快速複製。
              複製後會自動進入改名模式。
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-slate-200 font-medium text-xs">預期數值語法</p>
            <div className="rounded-lg overflow-hidden border border-slate-700 text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800 text-slate-400">
                    <th className="text-left px-3 py-2 font-medium">語法</th>
                    <th className="text-left px-3 py-2 font-medium">說明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {[
                    ['NOT_NULL',           '欄位必須存在且不為空'],
                    ['MUST_NOT_EXIST',     '欄位不得出現（違規夾帶）'],
                    ['IF_EXIST:值',        '選填；若出現則值需包含指定內容'],
                    ['IF_EXIST:NOT_NULL',  '選填；若出現則不得為空'],
                    ['000000',            '欄位值必須包含此具體字串'],
                  ].map(([syntax, desc]) => (
                    <tr key={syntax} className="hover:bg-slate-800/40">
                      <td className="px-3 py-1.5 font-mono text-amber-300">{syntax}</td>
                      <td className="px-3 py-1.5 text-slate-300">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-slate-200 font-medium text-xs">多段式交易（Multi-step）</p>
            <p>
              晶片卡交易通常包含「主交易 0200」＋「TC Upload 0220」兩段，
              點選右側「<Code>新增階段</Code>」按鈕可加入多個步驟，每段可獨立設定 MTI 與欄位規則。
            </p>
          </div>
          <Tip>
            設定完成後記得點「<Code>儲存規格</Code>」，規格會同步存入 <Code>pos_rules.json</Code>，
            下次啟動工具時自動載入。
          </Tip>
        </div>
      </Section>

      {/* ── 4. 欄位 ID 命名規則 ── */}
      <Section icon={<Zap className="w-4 h-4" />} title="4. 欄位 ID 命名規則">
        <div className="space-y-3">
          <p>欄位代碼格式為 <Code>前綴_欄位號碼</Code>，例如：</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {[
              { id: 'REQ_3',     desc: '送出電文（Request）的 Field 3' },
              { id: 'REQ_22',    desc: '送出電文的 Field 22（POS Entry Mode）' },
              { id: 'REQ_55',    desc: '送出電文的 Field 55（Chip Data）' },
              { id: 'RSP_39',    desc: '回應電文（Response）的 Field 39（RC）' },
              { id: 'RSP_38',    desc: '回應電文的 Field 38（Auth Code）' },
              { id: 'REQ_55_9F26', desc: 'Field 55 下的 EMV Tag 9F26' },
              { id: 'REQ_58_M6',   desc: 'Field 58 下的 Sub-field M6' },
            ].map(r => (
              <div key={r.id} className="flex items-start gap-2 px-3 py-2 bg-slate-800/50 rounded-lg">
                <Code>{r.id}</Code>
                <span className="text-slate-400 text-xs">{r.desc}</span>
              </div>
            ))}
          </div>
          <Tip>
            欄位號碼為整數（<Code>REQ_3</Code> 而非 <Code>REQ_03</Code>），
            Sub-tag / Sub-field 使用底線串接父欄位。
          </Tip>
        </div>
      </Section>

      {/* ── 5. 下載工具包 ── */}
      <Section icon={<Package className="w-4 h-4" />} title="5. 下載工具包">
        <DownloadSection />
      </Section>

    </div>
  );
}
