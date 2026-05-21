import React, { useState, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Copy, Save, ChevronDown, ChevronUp,
  Building2, FileText, Layers, Download, Upload, Info,
  Cloud, CloudDownload, CloudUpload, RefreshCw, AlertCircle, CheckCircle, X
} from 'lucide-react';
import type { AllRules, TransactionConfig, TransactionStep, VerifyField } from '../types';

interface Props {
  rules: AllRules;
  onSave: (rules: AllRules) => void;
}

// 深層複製 helper
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// 取得正規化的多段式設定
function normalizeConfig(cfg: TransactionConfig): { type: 'multi-step'; steps: TransactionStep[] } {
  if (cfg.steps) return { type: 'multi-step', steps: cfg.steps };
  return {
    type: 'multi-step',
    steps: [{ step_name: '主交易', mti: cfg.mti ?? '0200', fields: cfg.fields ?? [] }],
  };
}

// 自然排序（REQ_2 < REQ_12 < REQ_21）
function naturalSort(a: VerifyField, b: VerifyField): number {
  const tokenize = (s: string) =>
    s.split(/(\d+)/).map(t => (/^\d+$/.test(t) ? parseInt(t, 10) : t.toUpperCase()));
  const ta = tokenize(a.id);
  const tb = tokenize(b.id);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const va = ta[i] ?? '';
    const vb = tb[i] ?? '';
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

// ─── 欄位編輯器 ────────────────────────────────────────────────────────────────

interface FieldEditorProps {
  fields: VerifyField[];
  onChange: (fields: VerifyField[]) => void;
}

function FieldEditor({ fields, onChange }: FieldEditorProps) {
  const update = (idx: number, key: keyof VerifyField, val: string) => {
    const next = fields.map((f, i) => i === idx ? { ...f, [key]: val } : f);
    onChange(next);
  };
  const addRow = () => onChange([...fields, { id: '', name: '', expected: 'NOT_NULL' }]);
  const removeRow = (idx: number) => onChange(fields.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/80 text-slate-400">
              <th className="text-left px-3 py-2 font-medium w-36">欄位代碼</th>
              <th className="text-left px-3 py-2 font-medium">欄位名稱（備註）</th>
              <th className="text-left px-3 py-2 font-medium w-52">預期數值</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {fields.map((f, i) => (
              <tr key={i} className="hover:bg-slate-800/40">
                <td className="px-2 py-1.5">
                  <input
                    value={f.id}
                    onChange={e => update(i, 'id', e.target.value)}
                    placeholder="REQ_3"
                    className="w-full bg-transparent text-slate-100 font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={f.name ?? ''}
                    onChange={e => update(i, 'name', e.target.value)}
                    placeholder="Processing Code"
                    className="w-full bg-transparent text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={f.expected}
                    onChange={e => update(i, 'expected', e.target.value)}
                    placeholder="NOT_NULL"
                    className="w-full bg-transparent text-amber-300 font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => removeRow(i)}
                    className="p-1 rounded hover:bg-red-950/50 hover:text-red-400 text-slate-600 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addRow}
        className="mt-2 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> 新增欄位
      </button>
    </div>
  );
}

// ─── 主元件 ────────────────────────────────────────────────────────────────────

export default function ConfigPanel({ rules: initialRules, onSave }: Props) {
  const [rules, setRules] = useState<AllRules>(() => deepClone(initialRules));
  const [selectedBank, setSelectedBank] = useState(() => Object.keys(initialRules)[0] ?? '');
  const [selectedTrans, setSelectedTrans] = useState<string>(() => {
    const bank = Object.keys(initialRules)[0] ?? '';
    return Object.keys(initialRules[bank] ?? {})[0] ?? '';
  });
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));
  const [newBankName, setNewBankName] = useState('');
  const [newTransName, setNewTransName] = useState('');
  const [copyFromTrans, setCopyFromTrans] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [renamingTrans, setRenamingTrans] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── 雲端規格庫狀態 ────────────────────────────────────────────────────────
  const [cloudBanks, setCloudBanks] = useState<string[]>([]);
  const [selectedCloudBank, setSelectedCloudBank] = useState('');
  const [cloudMsg, setCloudMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isCloudFetching, setIsCloudFetching] = useState(false);
  const [isCloudDownloading, setIsCloudDownloading] = useState(false);
  const [isCloudUploading, setIsCloudUploading] = useState(false);
  const cloudMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCloudMsg = (type: 'success' | 'error' | 'info', text: string) => {
    setCloudMsg({ type, text });
    if (cloudMsgTimerRef.current) clearTimeout(cloudMsgTimerRef.current);
    cloudMsgTimerRef.current = setTimeout(() => setCloudMsg(null), 4000);
  };

  // 同步外部 rules 更新
  React.useEffect(() => {
    setRules(deepClone(initialRules));
    const bank = Object.keys(initialRules)[0] ?? '';
    setSelectedBank(bank);
    setSelectedTrans(Object.keys(initialRules[bank] ?? {})[0] ?? '');
  }, [initialRules]);

  const bankList = Object.keys(rules);
  const transList = selectedBank ? Object.keys(rules[selectedBank] ?? {}) : [];
  const currentConfig = selectedBank && selectedTrans
    ? normalizeConfig(rules[selectedBank]?.[selectedTrans] ?? { steps: [] })
    : null;

  // ── 銀行管理 ──────────────────────────────────────────────────────────────

  const addBank = () => {
    const name = newBankName.trim();
    if (!name || rules[name]) return;
    setRules(prev => ({ ...prev, [name]: {} }));
    setSelectedBank(name);
    setSelectedTrans('');
    setNewBankName('');
  };

  const deleteBank = (bank: string) => {
    if (!window.confirm(`確定要刪除銀行「${bank}」及其所有規格嗎？`)) return;
    setRules(prev => {
      const next = { ...prev };
      delete next[bank];
      return next;
    });
    if (selectedBank === bank) {
      const remaining = Object.keys(rules).filter(b => b !== bank);
      setSelectedBank(remaining[0] ?? '');
      setSelectedTrans('');
    }
  };

  // ── 交易管理 ──────────────────────────────────────────────────────────────

  const addTrans = () => {
    const name = newTransName.trim();
    if (!name || !selectedBank) return;
    if (rules[selectedBank]?.[name]) { alert('此交易名稱已存在！'); return; }

    const newCfg: TransactionConfig = copyFromTrans && rules[selectedBank]?.[copyFromTrans]
      ? deepClone(rules[selectedBank][copyFromTrans])
      : { type: 'multi-step', steps: [{ step_name: '主交易', mti: '0200', fields: [] }] };

    setRules(prev => ({
      ...prev,
      [selectedBank]: { ...prev[selectedBank], [name]: newCfg }
    }));
    setSelectedTrans(name);
    setNewTransName('');
    setCopyFromTrans('');
  };

  const deleteTrans = (trans: string) => {
    if (!window.confirm(`確定要刪除「${trans}」的規格嗎？`)) return;
    setRules(prev => {
      const next = { ...prev };
      const bankCopy = { ...next[selectedBank] };
      delete bankCopy[trans];
      next[selectedBank] = bankCopy;
      return next;
    });
    if (selectedTrans === trans) {
      const remaining = Object.keys(rules[selectedBank]).filter(t => t !== trans);
      setSelectedTrans(remaining[0] ?? '');
    }
  };

  const duplicateTrans = (e: React.MouseEvent, trans: string) => {
    e.stopPropagation();
    if (!selectedBank) return;
    let newName = `${trans}_副本`;
    let suffix = 2;
    while (rules[selectedBank]?.[newName]) {
      newName = `${trans}_副本${suffix++}`;
    }
    setRules(prev => ({
      ...prev,
      [selectedBank]: {
        ...prev[selectedBank],
        [newName]: deepClone(prev[selectedBank][trans]),
      }
    }));
    setSelectedTrans(newName);
    // 複製後直接進入改名模式
    setRenamingTrans(newName);
    setRenameValue(newName);
  };

  const startRename = (e: React.MouseEvent, trans: string) => {
    e.stopPropagation();
    setRenamingTrans(trans);
    setRenameValue(trans);
  };

  const commitRename = () => {
    const oldName = renamingTrans;
    const newName = renameValue.trim();
    setRenamingTrans(null);
    if (!oldName || !newName || newName === oldName) return;
    if (rules[selectedBank]?.[newName]) {
      alert('此交易名稱已存在！');
      return;
    }
    setRules(prev => {
      const bank = prev[selectedBank];
      // 保留順序重建物件
      const entries = Object.entries(bank).map(([k, v]) =>
        k === oldName ? [newName, v] : [k, v]
      );
      return { ...prev, [selectedBank]: Object.fromEntries(entries) };
    });
    if (selectedTrans === oldName) setSelectedTrans(newName);
  };

  // ── 步驟管理 ──────────────────────────────────────────────────────────────

  const updateSteps = useCallback((steps: TransactionStep[]) => {
    if (!selectedBank || !selectedTrans) return;
    setRules(prev => ({
      ...prev,
      [selectedBank]: {
        ...prev[selectedBank],
        [selectedTrans]: { type: 'multi-step', steps }
      }
    }));
  }, [selectedBank, selectedTrans]);

  const addStep = () => {
    if (!currentConfig) return;
    const steps = [...currentConfig.steps, {
      step_name: `第 ${currentConfig.steps.length + 1} 段交易`,
      mti: '0220',
      fields: []
    }];
    updateSteps(steps);
    setExpandedSteps(prev => new Set([...prev, steps.length - 1]));
  };

  const removeStep = (idx: number) => {
    if (!currentConfig || currentConfig.steps.length <= 1) return;
    const steps = currentConfig.steps.filter((_, i) => i !== idx);
    updateSteps(steps);
  };

  const updateStepField = (stepIdx: number, key: keyof TransactionStep, val: string) => {
    if (!currentConfig) return;
    const steps = currentConfig.steps.map((s, i) =>
      i === stepIdx ? { ...s, [key]: val } : s
    );
    updateSteps(steps);
  };

  const updateStepFields = (stepIdx: number, fields: VerifyField[]) => {
    if (!currentConfig) return;
    const steps = currentConfig.steps.map((s, i) =>
      i === stepIdx ? { ...s, fields } : s
    );
    updateSteps(steps);
  };

  const sortFields = (stepIdx: number) => {
    if (!currentConfig) return;
    const steps = currentConfig.steps.map((s, i) =>
      i === stepIdx ? { ...s, fields: [...s.fields].sort(naturalSort) } : s
    );
    updateSteps(steps);
  };

  // ── 雲端操作 ──────────────────────────────────────────────────────────────

  const fetchCloudBanks = async () => {
    setIsCloudFetching(true);
    try {
      const res = await fetch('/api/cloud-specs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const banks: string[] = data.banks ?? [];
      setCloudBanks(banks);
      if (banks.length > 0) {
        setSelectedCloudBank(prev => banks.includes(prev) ? prev : banks[0]);
        showCloudMsg('info', `雲端共有 ${banks.length} 筆規格`);
      } else {
        showCloudMsg('info', '雲端目前無規格');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤';
      showCloudMsg('error', `無法取得列表：${msg}`);
    } finally {
      setIsCloudFetching(false);
    }
  };

  const downloadFromCloud = async () => {
    if (!selectedCloudBank) { showCloudMsg('error', '請先選擇要下載的規格'); return; }
    setIsCloudDownloading(true);
    try {
      const res = await fetch(`/api/cloud-specs?bank=${encodeURIComponent(selectedCloudBank)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const bankSpec = await res.json();
      // 將雲端規格合併進本地 rules（以雲端版本為主）
      const merged = {
        ...rules,
        [selectedCloudBank]: bankSpec,
      };
      setRules(merged);
      setSelectedBank(selectedCloudBank);
      setSelectedTrans(Object.keys(bankSpec)[0] ?? '');
      // 立即同步到 App.tsx，避免切換 tab 後規格遺失
      onSave(merged);
      showCloudMsg('success', `已下載 ${selectedCloudBank}（${Object.keys(bankSpec).length} 個交易）`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤';
      showCloudMsg('error', `下載失敗：${msg}`);
    } finally {
      setIsCloudDownloading(false);
    }
  };

  const uploadToCloud = async () => {
    if (!selectedBank) { showCloudMsg('error', '請先選擇要上傳的銀行'); return; }
    const bankSpec = rules[selectedBank];
    if (!bankSpec || Object.keys(bankSpec).length === 0) {
      showCloudMsg('error', `${selectedBank} 目前無規格可上傳`);
      return;
    }
    setIsCloudUploading(true);
    try {
      const res = await fetch(`/api/cloud-specs?bank=${encodeURIComponent(selectedBank)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bankSpec),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      showCloudMsg('success', `已上傳 ${selectedBank} 至雲端`);
      // 重新整理列表
      setCloudBanks([]);
      setSelectedCloudBank('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤';
      showCloudMsg('error', `上傳失敗：${msg}`);
    } finally {
      setIsCloudUploading(false);
    }
  };

  const deleteFromCloud = async () => {
    if (!selectedCloudBank) { showCloudMsg('error', '請先選擇要刪除的規格'); return; }
    if (!window.confirm(`確定要從雲端刪除「${selectedCloudBank}」的規格嗎？`)) return;
    try {
      const res = await fetch(`/api/cloud-specs?bank=${encodeURIComponent(selectedCloudBank)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      showCloudMsg('success', `已從雲端刪除 ${selectedCloudBank}`);
      setCloudBanks(prev => prev.filter(b => b !== selectedCloudBank));
      setSelectedCloudBank('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤';
      showCloudMsg('error', `刪除失敗：${msg}`);
    }
  };

  // ── 儲存 ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true);
    onSave(rules);
    setSaveMsg('已儲存！');
    setTimeout(() => setSaveMsg(''), 2500);
    setIsSaving(false);
  };

  // ── 匯入/匯出 ─────────────────────────────────────────────────────────────

  const exportRules = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pos_rules.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importRules = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as AllRules;
        setRules(parsed);
        const bank = Object.keys(parsed)[0] ?? '';
        setSelectedBank(bank);
        setSelectedTrans(Object.keys(parsed[bank] ?? {})[0] ?? '');
        // 立即同步到 App.tsx，避免切換 tab 後規格遺失
        onSave(parsed);
      } catch { alert('JSON 格式錯誤，無法匯入'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* ── 左側：銀行/交易 tree ───────────────────────── */}
      <div className="lg:col-span-1 space-y-4">
        {/* 匯入/匯出 */}
        <div className="flex gap-2">
          <button onClick={exportRules} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors">
            <Download className="w-3.5 h-3.5" /> 匯出 JSON
          </button>
          <label className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" /> 匯入 JSON
            <input type="file" accept=".json" className="hidden" onChange={importRules} />
          </label>
        </div>

        {/* 雲端規格庫 */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-semibold text-slate-300">雲端規格庫</span>
            </div>
            <button
              onClick={fetchCloudBanks}
              disabled={isCloudFetching}
              title="重新整理雲端列表"
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCloudFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="px-3 py-2.5 space-y-2">
            {/* 訊息列 */}
            {cloudMsg && (
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${
                cloudMsg.type === 'success' ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40' :
                cloudMsg.type === 'error'   ? 'bg-red-950/50 text-red-300 border border-red-800/40' :
                                              'bg-blue-950/50 text-blue-300 border border-blue-800/40'
              }`}>
                {cloudMsg.type === 'success' ? <CheckCircle className="w-3 h-3 flex-shrink-0" /> :
                 cloudMsg.type === 'error'   ? <AlertCircle  className="w-3 h-3 flex-shrink-0" /> :
                                              <Cloud        className="w-3 h-3 flex-shrink-0" />}
                <span className="flex-1">{cloudMsg.text}</span>
                <button onClick={() => setCloudMsg(null)} className="flex-shrink-0 hover:opacity-70"><X className="w-3 h-3" /></button>
              </div>
            )}

            {/* 下載區 */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">從雲端下載</p>
              {cloudBanks.length > 0 ? (
                <select
                  value={selectedCloudBank}
                  onChange={e => setSelectedCloudBank(e.target.value)}
                  className="w-full bg-slate-700 text-xs text-slate-200 px-2 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {cloudBanks.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : (
                <p className="text-xs text-slate-500 italic">點選 ↺ 取得雲端列表</p>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={downloadFromCloud}
                  disabled={isCloudDownloading || !selectedCloudBank}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
                >
                  <CloudDownload className={`w-3.5 h-3.5 ${isCloudDownloading ? 'animate-pulse' : ''}`} />
                  {isCloudDownloading ? '下載中…' : '下載規格'}
                </button>
                <button
                  onClick={deleteFromCloud}
                  disabled={!selectedCloudBank}
                  title="從雲端刪除此規格"
                  className="px-2 py-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="border-t border-slate-700/50 pt-2 space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">上傳到雲端</p>
              <button
                onClick={uploadToCloud}
                disabled={isCloudUploading || !selectedBank}
                className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
              >
                <CloudUpload className={`w-3.5 h-3.5 ${isCloudUploading ? 'animate-pulse' : ''}`} />
                {isCloudUploading ? '上傳中…' : `上傳「${selectedBank || '—'}」至雲端`}
              </button>
            </div>
          </div>
        </div>

        {/* 銀行列表 */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-800/80 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">銀行 / 客戶</span>
          </div>
          <div className="divide-y divide-slate-700/50 max-h-60 overflow-y-auto">
            {bankList.map(bank => (
              <button
                key={bank}
                onClick={() => { setSelectedBank(bank); setSelectedTrans(Object.keys(rules[bank] ?? {})[0] ?? ''); }}
                className={`w-full text-left flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                  selectedBank === bank ? 'bg-blue-900/40 text-blue-200' : 'text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <span className="truncate">{bank}</span>
                {selectedBank === bank && bankList.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteBank(bank); }}
                    className="p-1 rounded hover:text-red-400 text-slate-500 flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </button>
            ))}
          </div>
          <div className="px-2 py-2 border-t border-slate-700/50 flex gap-1.5">
            <input
              value={newBankName}
              onChange={e => setNewBankName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBank()}
              placeholder="新銀行名稱…"
              className="flex-1 bg-slate-700 text-sm text-slate-200 px-2 py-1 rounded placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button onClick={addBank} className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded text-white">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 交易列表 */}
        {selectedBank && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-800/80 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-300">交易類別</span>
            </div>
            <div className="divide-y divide-slate-700/50 max-h-72 overflow-y-auto">
              {transList.map(trans => (
                <div
                  key={trans}
                  onClick={() => { if (renamingTrans !== trans) setSelectedTrans(trans); }}
                  className={`group flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors ${
                    selectedTrans === trans ? 'bg-blue-900/40 text-blue-200' : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                >
                  {renamingTrans === trans ? (
                    /* 行內改名輸入框 */
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingTrans(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-slate-700 text-slate-100 text-sm px-2 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  ) : (
                    <span className="truncate flex-1 min-w-0">{trans}</span>
                  )}
                  <span className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                    {renamingTrans !== trans && (
                      <>
                        <span
                          title="重新命名"
                          onClick={e => startRename(e, trans)}
                          className="p-1 rounded hover:text-amber-400 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {/* pencil icon inline svg */}
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </span>
                        <span
                          title="複製此交易規格"
                          onClick={e => duplicateTrans(e, trans)}
                          className="p-1 rounded hover:text-blue-400 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="w-3 h-3" />
                        </span>
                        {selectedTrans === trans && (
                          <span
                            onClick={e => { e.stopPropagation(); deleteTrans(trans); }}
                            className="p-1 rounded hover:text-red-400 text-slate-500"
                          >
                            <Trash2 className="w-3 h-3" />
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {/* 新增交易 */}
            <div className="px-2 py-2 border-t border-slate-700/50 space-y-1.5">
              <input
                value={newTransName}
                onChange={e => setNewTransName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTrans()}
                placeholder="新交易名稱…"
                className="w-full bg-slate-700 text-sm text-slate-200 px-2 py-1 rounded placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <select
                value={copyFromTrans}
                onChange={e => setCopyFromTrans(e.target.value)}
                className="w-full bg-slate-700 text-xs text-slate-300 px-2 py-1 rounded focus:outline-none"
              >
                <option value="">（建立空白規格）</option>
                {transList.map(t => <option key={t} value={t}>複製自：{t}</option>)}
              </select>
              <button onClick={addTrans} className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                <Plus className="w-3.5 h-3.5" /> 新增交易規格
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 右側：多段式步驟編輯器 ─────────────────────── */}
      <div className="lg:col-span-3 space-y-4">
        {currentConfig && selectedBank && selectedTrans ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                {selectedBank} <span className="text-slate-400 mx-1">/</span>
                {renamingTrans === selectedTrans ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingTrans(null);
                    }}
                    className="bg-slate-700 text-slate-100 text-sm px-2 py-0.5 rounded w-56 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                ) : (
                  <span
                    className="cursor-pointer hover:text-blue-300 transition-colors"
                    title="雙擊改名"
                    onDoubleClick={e => startRename(e as unknown as React.MouseEvent, selectedTrans)}
                  >
                    {selectedTrans}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={e => duplicateTrans(e, selectedTrans)}
                  title="複製此交易規格"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> 複製交易
                </button>
                <button
                  onClick={addStep}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" /> 新增階段
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? '儲存中…' : '儲存規格'}
                </button>
                {saveMsg && <span className="text-xs text-emerald-400">{saveMsg}</span>}
              </div>
            </div>

            {/* 說明 */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-950/30 border border-blue-800/40 rounded-lg text-xs text-blue-300">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-mono text-amber-300">NOT_NULL</span> 必填且有值 ·{' '}
                <span className="font-mono text-amber-300">MUST_NOT_EXIST</span> 不得出現 ·{' '}
                <span className="font-mono text-amber-300">IF_EXIST:值</span> 選填；出現時需符合 ·{' '}
                <span className="font-mono text-amber-300">IF_EXIST:NOT_NULL</span> 選填；出現不得為空 ·{' '}
                具體值則直接填入（如 <span className="font-mono text-amber-300">000000</span>）
              </div>
            </div>

            {/* 步驟列表 */}
            <div className="space-y-3">
              {currentConfig.steps.map((step, si) => {
                const isOpen = expandedSteps.has(si);
                return (
                  <div key={si} className="border border-slate-700 rounded-xl overflow-hidden">
                    {/* 步驟標題 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 bg-slate-800/60 cursor-pointer hover:bg-slate-800 transition-colors"
                      onClick={() => setExpandedSteps(prev => {
                        const next = new Set(prev);
                        next.has(si) ? next.delete(si) : next.add(si);
                        return next;
                      })}
                    >
                      <span className="w-6 h-6 flex-shrink-0 rounded-full bg-blue-900 text-blue-200 text-xs font-bold flex items-center justify-center">{si + 1}</span>
                      <div className="flex-1 flex items-center gap-3 flex-wrap">
                        <input
                          value={step.step_name}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateStepField(si, 'step_name', e.target.value)}
                          className="bg-transparent text-sm font-semibold text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 w-40"
                        />
                        <span className="text-slate-500 text-xs">MTI:</span>
                        <input
                          value={step.mti}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateStepField(si, 'mti', e.target.value)}
                          className="bg-slate-700 text-xs font-mono text-amber-300 px-2 py-0.5 rounded w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-500">{step.fields.length} 個欄位</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); sortFields(si); }}
                          className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
                          title="依欄位代碼自然排序"
                        >
                          排序
                        </button>
                        {currentConfig.steps.length > 1 && (
                          <button
                            onClick={e => { e.stopPropagation(); removeStep(si); }}
                            className="p-1.5 hover:bg-red-950/50 hover:text-red-400 text-slate-500 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>

                    {/* 欄位編輯器 */}
                    {isOpen && (
                      <div className="px-4 py-3">
                        <FieldEditor
                          fields={step.fields}
                          onChange={fields => updateStepFields(si, fields)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 text-sm gap-3">
            <Building2 className="w-12 h-12 opacity-20" />
            <span>請從左側選擇銀行與交易規格，或新增一個銀行開始</span>
          </div>
        )}
      </div>
    </div>
  );
}
