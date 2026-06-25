import React, { useState, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Copy, Save, ChevronDown, ChevronUp,
  Building2, FileText, Layers, Download, Upload, Info,
  Cloud, CloudDownload, CloudUpload, RefreshCw, AlertCircle, CheckCircle, X,
  FilePlus2, Eye, Loader2, Check
} from 'lucide-react';
import type { AllRules, TransactionConfig, TransactionStep, VerifyField } from '../types';
import { parseSpec, toRulesJson } from '../utils/specParser';

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
      <div className="overflow-x-auto rounded-lg border border-[var(--border-strong)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--surface-2)] text-[var(--fg-muted)]">
              <th className="text-left px-3 py-2 font-medium w-36">欄位代碼</th>
              <th className="text-left px-3 py-2 font-medium">欄位名稱（備註）</th>
              <th className="text-left px-3 py-2 font-medium w-52">預期數值</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {fields.map((f, i) => (
              <tr key={i} className="hover:bg-[var(--surface-2)]/50">
                <td className="px-2 py-1.5">
                  <input
                    value={f.id}
                    onChange={e => update(i, 'id', e.target.value)}
                    placeholder="REQ_3"
                    className="w-full bg-transparent text-[var(--fg)] font-mono placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] rounded px-1"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={f.name ?? ''}
                    onChange={e => update(i, 'name', e.target.value)}
                    placeholder="Processing Code"
                    className="w-full bg-transparent text-[var(--fg-muted)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] rounded px-1"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={f.expected}
                    onChange={e => update(i, 'expected', e.target.value)}
                    placeholder="NOT_NULL"
                    className="w-full bg-transparent text-[var(--amber-ink)] font-mono placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] rounded px-1"
                  />
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => removeRow(i)}
                    className="p-1 rounded hover:bg-[var(--red-soft)] hover:text-[var(--red-ink)] text-[var(--fg-subtle)] transition-colors"
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
        className="mt-2 flex items-center gap-1.5 text-xs text-[var(--blue-ink)] hover:opacity-80 transition-colors"
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
  const [isCloudExpanded, setIsCloudExpanded] = useState(false);
  const [cloudBanks, setCloudBanks] = useState<string[]>([]);
  const [selectedCloudBank, setSelectedCloudBank] = useState('');
  const [cloudMsg, setCloudMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isCloudFetching, setIsCloudFetching] = useState(false);
  const [isCloudDownloading, setIsCloudDownloading] = useState(false);
  const [isCloudUploading, setIsCloudUploading] = useState(false);
  const cloudMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 規格匯入（從 .md 自動解析）────────────────────────────────────────────
  const [specImportOpen, setSpecImportOpen] = useState(false);
  const [specParsing, setSpecParsing] = useState(false);
  const [specResult, setSpecResult] = useState<ReturnType<typeof parseSpec> | null>(null);
  const [specBankName, setSpecBankName] = useState('');
  const [specSelectedTx, setSpecSelectedTx] = useState<Set<number>>(() => new Set());
  const specFileRef = useRef<HTMLInputElement>(null);

  const handleSpecFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSpecParsing(true);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const content = ev.target?.result as string;
        const result = parseSpec(content);
        setSpecResult(result);
        setSpecBankName(result.suggestedBankName);
        setSpecSelectedTx(new Set(result.transactions.map((_, i) => i)));
        setSpecImportOpen(true);
      } catch (err) {
        alert('解析規格檔失敗：' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setSpecParsing(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSpecImport = () => {
    if (!specResult || !specBankName.trim()) return;
    const selected = specResult.transactions.filter((_, i) => specSelectedTx.has(i));
    if (selected.length === 0) return;
    const newRules = toRulesJson(specBankName.trim(), selected);
    const merged = { ...rules, ...newRules };
    setRules(merged);
    onSave(merged);
    setSelectedBank(specBankName.trim());
    const firstTx = selected[0]?.name ?? '';
    setSelectedTrans(firstTx);
    setSpecImportOpen(false);
    setSpecResult(null);
  };

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

  const bankList = Object.keys(rules).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  
  // 交易類別排序：依優先權 + 中文自然排序
  const transList = selectedBank
    ? Object.keys(rules[selectedBank] ?? {}).sort((a, b) => {
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
    for (const [bankName, bankData] of Object.entries(rules)) {
      const blob = new Blob([JSON.stringify({ [bankName]: bankData }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bankName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const importRules = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as AllRules;
        const merged = { ...rules, ...parsed };
        setRules(merged);
        const bank = Object.keys(parsed)[0] ?? '';
        setSelectedBank(bank);
        setSelectedTrans(Object.keys(parsed[bank] ?? {})[0] ?? '');
        onSave(merged);
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
        {/* 新增規格（從 .md 解析） */}
        <label className={`w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 rounded-lg cursor-pointer font-medium transition-colors ${
          specParsing ? 'btn-secondary opacity-60' : 'btn-primary'
        }`}>
          {specParsing
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 解析中…</>
            : <><FilePlus2 className="w-3.5 h-3.5" /> 從規格文件新增</>
          }
          <input type="file" accept=".md,.txt" className="hidden" ref={specFileRef} onChange={handleSpecFileSelect} disabled={specParsing} />
        </label>

        {/* 匯入/匯出 JSON */}
        <div className="flex gap-2">
          <button onClick={exportRules} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 btn-secondary rounded-lg">
            <Download className="w-3.5 h-3.5" /> 匯出 JSON
          </button>
          <label className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 btn-secondary rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> 匯入 JSON
            <input type="file" accept=".json" className="hidden" onChange={importRules} />
          </label>
        </div>

        {/* 雲端規格庫（可折疊） */}
        <div className="pb-3 mb-3 border-b border-[var(--border)]">
          <button
            onClick={() => setIsCloudExpanded(!isCloudExpanded)}
            className="w-full flex items-center justify-between py-1 text-left"
          >
            <div className="flex items-center gap-2">
              <Cloud className="w-3.5 h-3.5 text-[var(--blue-ink)]" />
              <span className="text-xs font-semibold text-[var(--fg-muted)]">雲端規格庫</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={e => { e.stopPropagation(); fetchCloudBanks(); }}
                disabled={isCloudFetching}
                title="重新整理雲端列表"
                className="toolbar-btn p-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCloudFetching ? 'animate-spin' : ''}`} />
              </button>
              {isCloudExpanded
                ? <ChevronUp className="w-3.5 h-3.5 text-[var(--fg-subtle)]" />
                : <ChevronDown className="w-3.5 h-3.5 text-[var(--fg-subtle)]" />}
            </div>
          </button>

          {isCloudExpanded && (
            <div className="mt-2 space-y-2">
              {cloudMsg && (
                <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${
                  cloudMsg.type === 'success' ? 'bg-[var(--emerald-soft)] text-[var(--emerald-ink)] border border-[var(--emerald-line)]' :
                  cloudMsg.type === 'error'   ? 'bg-[var(--red-soft)] text-[var(--red-ink)] border border-[var(--red-line)]' :
                                                'bg-[var(--blue-soft)] text-[var(--blue-ink)] border border-[var(--blue-line)]'
                }`}>
                  {cloudMsg.type === 'success' ? <CheckCircle className="w-3 h-3 flex-shrink-0" /> :
                   cloudMsg.type === 'error'   ? <AlertCircle  className="w-3 h-3 flex-shrink-0" /> :
                                                <Cloud        className="w-3 h-3 flex-shrink-0" />}
                  <span className="flex-1">{cloudMsg.text}</span>
                  <button onClick={() => setCloudMsg(null)} className="flex-shrink-0 hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] text-[var(--fg-subtle)] uppercase tracking-wider font-semibold">從雲端下載</p>
                {cloudBanks.length > 0 ? (
                  <select
                    value={selectedCloudBank}
                    onChange={e => setSelectedCloudBank(e.target.value)}
                    className="w-full bg-[var(--surface-2)] text-xs text-[var(--fg)] px-2 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  >
                    {cloudBanks.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-[var(--fg-subtle)] italic">點選 ↺ 取得雲端列表</p>
                )}
                <div className="flex gap-1.5">
                  <button
                    onClick={downloadFromCloud}
                    disabled={isCloudDownloading || !selectedCloudBank}
                    className="flex-1 btn-primary flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 disabled:opacity-40"
                  >
                    <CloudDownload className={`w-3.5 h-3.5 ${isCloudDownloading ? 'animate-pulse' : ''}`} />
                    {isCloudDownloading ? '下載中…' : '下載規格'}
                  </button>
                  <button
                    onClick={deleteFromCloud}
                    disabled={!selectedCloudBank}
                    title="從雲端刪除此規格"
                    className="px-2 py-1.5 rounded text-[var(--fg-subtle)] hover:text-[var(--red-ink)] hover:bg-[var(--red-soft)] disabled:opacity-30 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="border-t border-[var(--border)] pt-2 space-y-1.5">
                <p className="text-[10px] text-[var(--fg-subtle)] uppercase tracking-wider font-semibold">上傳到雲端</p>
                <button
                  onClick={uploadToCloud}
                  disabled={isCloudUploading || !selectedBank}
                  className="w-full btn-secondary flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 disabled:opacity-40"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${isCloudUploading ? 'animate-pulse' : ''}`} />
                  {isCloudUploading ? '上傳中…' : `上傳「${selectedBank || '—'}」至雲端`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 銀行列表 */}
        <div className="pb-3 mb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
            <span className="text-xs font-semibold text-[var(--fg-muted)]">銀行 / 客戶</span>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-[var(--border)]">
            {bankList.map(bank => (
              <button
                key={bank}
                onClick={() => { setSelectedBank(bank); setSelectedTrans(Object.keys(rules[bank] ?? {})[0] ?? ''); }}
                className={`w-full text-left flex items-center justify-between px-3 py-2 text-sm transition-colors border-b border-[var(--border)] last:border-b-0 ${
                  selectedBank === bank ? 'bg-[var(--blue-soft)] text-[var(--blue-ink)]' : 'text-[var(--fg-muted)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span className="truncate">{bank}</span>
                {selectedBank === bank && bankList.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteBank(bank); }}
                    className="p-1 rounded hover:text-[var(--red-ink)] text-[var(--fg-subtle)] flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 mt-2">
            <input
              value={newBankName}
              onChange={e => setNewBankName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBank()}
              placeholder="新銀行名稱…"
              className="flex-1 bg-[var(--surface-2)] text-sm text-[var(--fg)] px-2 py-1 rounded placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <button onClick={addBank} className="btn-primary p-1.5">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 交易列表 */}
        {selectedBank && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
              <span className="text-xs font-semibold text-[var(--fg-muted)]">交易類別</span>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)]">
              {transList.map(trans => (
                <div
                  key={trans}
                  onClick={() => { if (renamingTrans !== trans) setSelectedTrans(trans); }}
                  className={`group flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors border-b border-[var(--border)] last:border-b-0 ${
                    selectedTrans === trans ? 'bg-[var(--blue-soft)] text-[var(--blue-ink)]' : 'text-[var(--fg-muted)] hover:bg-[var(--surface-2)]'
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
                      className="flex-1 min-w-0 bg-[var(--surface-2)] text-[var(--fg)] text-sm px-2 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
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
                          className="p-1 rounded hover:text-[var(--amber-ink)] text-[var(--fg-subtle)] opacity-0 group-hover:opacity-100 transition-opacity"
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
                          className="p-1 rounded hover:text-[var(--blue-ink)] text-[var(--fg-subtle)] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="w-3 h-3" />
                        </span>
                        {selectedTrans === trans && (
                          <span
                            onClick={e => { e.stopPropagation(); deleteTrans(trans); }}
                            className="p-1 rounded hover:text-[var(--red-ink)] text-[var(--fg-subtle)]"
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
            <div className="mt-2 space-y-1.5">
              <input
                value={newTransName}
                onChange={e => setNewTransName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTrans()}
                placeholder="新交易名稱…"
                className="w-full bg-[var(--surface-2)] text-sm text-[var(--fg)] px-2 py-1 rounded placeholder:text-[var(--fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <select
                value={copyFromTrans}
                onChange={e => setCopyFromTrans(e.target.value)}
                className="w-full bg-[var(--surface-2)] text-xs text-[var(--fg-muted)] px-2 py-1 rounded focus:outline-none"
              >
                <option value="">（建立空白規格）</option>
                {transList.map(t => <option key={t} value={t}>複製自：{t}</option>)}
              </select>
              <button onClick={addTrans} className="w-full btn-primary flex items-center justify-center gap-1.5 text-xs px-2 py-1.5">
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
              <h3 className="font-semibold text-[var(--fg)] flex items-center gap-1.5">
                {selectedBank} <span className="text-[var(--fg-muted)] mx-1">/</span>
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
                    className="bg-[var(--surface-2)] text-[var(--fg)] text-sm px-2 py-0.5 rounded w-56 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                ) : (
                  <span
                    className="cursor-pointer hover:text-[var(--blue-ink)] transition-colors"
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
                  className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5"
                >
                  <Copy className="w-3.5 h-3.5" /> 複製交易
                </button>
                <button
                  onClick={addStep}
                  className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5"
                >
                  <Layers className="w-3.5 h-3.5" /> 新增階段
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="btn-primary flex items-center gap-1.5 text-sm px-4 py-1.5 disabled:opacity-40 font-medium"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? '儲存中…' : '儲存規格'}
                </button>
                {saveMsg && <span className="text-xs text-[var(--emerald-ink)]">{saveMsg}</span>}
              </div>
            </div>

            {/* 說明 */}
            <div className="alert-banner alert-banner-info flex items-start gap-2 px-3 py-2.5 text-xs">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-mono text-[var(--amber-ink)]">NOT_NULL</span> 必填且有值 ·{' '}
                <span className="font-mono text-[var(--amber-ink)]">MUST_EXIST</span> 必填但值可為空 ·{' '}
                <span className="font-mono text-[var(--amber-ink)]">MUST_NOT_EXIST</span> 不得出現 ·{' '}
                <span className="font-mono text-[var(--amber-ink)]">IF_EXIST:值</span> 選填；出現時需符合 ·{' '}
                <span className="font-mono text-[var(--amber-ink)]">IF_EXIST:NOT_NULL</span> 選填；出現不得為空 ·{' '}
                <span className="font-mono text-[var(--amber-ink)]">REGEX:pattern</span> 正規式比對 ·{' '}
                具體值則直接填入（如 <span className="font-mono text-[var(--amber-ink)]">000000</span>）
              </div>
            </div>

            {/* 步驟列表 */}
            <div className="space-y-3">
              {currentConfig.steps.map((step, si) => {
                const isOpen = expandedSteps.has(si);
                return (
                  <div key={si} className="border border-[var(--border)] rounded-xl overflow-hidden">
                    {/* 步驟標題 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                      onClick={() => setExpandedSteps(prev => {
                        const next = new Set(prev);
                        next.has(si) ? next.delete(si) : next.add(si);
                        return next;
                      })}
                    >
                      <span className="w-6 h-6 flex-shrink-0 rounded-full bg-[var(--blue-soft)] text-[var(--blue-ink)] text-xs font-bold flex items-center justify-center">{si + 1}</span>
                      <div className="flex-1 flex items-center gap-3 flex-wrap">
                        <input
                          value={step.step_name}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateStepField(si, 'step_name', e.target.value)}
                          className="bg-transparent text-sm font-semibold text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] rounded px-1 w-40"
                        />
                        <span className="text-[var(--fg-subtle)] text-xs">MTI:</span>
                        <input
                          value={step.mti}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateStepField(si, 'mti', e.target.value)}
                          className="bg-[var(--surface-2)] text-xs font-mono text-[var(--amber-ink)] px-2 py-0.5 rounded w-20 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />
                        <span className="text-xs text-[var(--fg-subtle)]">{step.fields.length} 個欄位</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); sortFields(si); }}
                          className="text-xs px-2 py-1 btn-secondary rounded"
                          title="依欄位代碼自然排序"
                        >
                          排序
                        </button>
                        {currentConfig.steps.length > 1 && (
                          <button
                            onClick={e => { e.stopPropagation(); removeStep(si); }}
                            className="p-1.5 hover:bg-[var(--red-soft)] hover:text-[var(--red-ink)] text-[var(--fg-subtle)] rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isOpen ? <ChevronUp className="w-4 h-4 text-[var(--fg-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--fg-muted)]" />}
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
          <div className="flex flex-col items-center justify-center py-24 text-[var(--fg-subtle)] text-sm gap-3">
            <Building2 className="w-12 h-12 opacity-20" />
            <span>請從左側選擇銀行與交易規格，或新增一個銀行開始</span>
          </div>
        )}
      </div>

      {/* ── 規格匯入 Modal ─────────────────────────────────────────────── */}
      {specImportOpen && specResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[640px] max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <FilePlus2 className="w-5 h-5 text-[var(--blue-ink)]" />
                <h2 className="text-base font-semibold text-[var(--fg)]">規格解析結果</h2>
              </div>
              <button onClick={() => { setSpecImportOpen(false); setSpecResult(null); }} className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--fg-subtle)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Warnings */}
              {specResult.warnings.length > 0 && (
                <div className="alert-banner alert-banner-warning text-xs space-y-1">
                  {specResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[var(--amber-ink)]" />
                      <span className="text-[var(--amber-ink)]">{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Bank name */}
              <div>
                <label className="text-xs font-medium text-[var(--fg-muted)] mb-1 block">銀行 / 規格名稱</label>
                <input
                  value={specBankName}
                  onChange={e => setSpecBankName(e.target.value)}
                  className="w-full bg-[var(--surface)] text-sm text-[var(--fg)] px-3 py-2 rounded-lg border border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  placeholder="例如：彰銀CHB聚合支付"
                />
                {specBankName.trim() && Object.keys(rules).includes(specBankName.trim()) && (
                  <p className="text-[10px] text-[var(--amber-ink)] mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 此名稱已存在，匯入後將合併覆蓋同名交易
                  </p>
                )}
              </div>

              {/* Transaction list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-[var(--fg-muted)]">
                    偵測到 {specResult.transactions.length} 種交易
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSpecSelectedTx(new Set(specResult.transactions.map((_, i) => i)))}
                      className="text-[10px] text-[var(--blue-ink)] hover:underline"
                    >全選</button>
                    <button
                      onClick={() => setSpecSelectedTx(new Set())}
                      className="text-[10px] text-[var(--fg-subtle)] hover:underline"
                    >取消全選</button>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                  {specResult.transactions.map((tx, idx) => (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        specSelectedTx.has(idx) ? 'bg-[var(--blue-soft)]' : 'hover:bg-[var(--surface)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={specSelectedTx.has(idx)}
                        onChange={() => {
                          setSpecSelectedTx(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--fg)] truncate">{tx.name}</span>
                          <span className="badge badge-info text-[10px] flex-shrink-0">MTI {tx.mti}</span>
                          {tx.processingCode && (
                            <span className="text-[10px] font-mono text-[var(--fg-subtle)] flex-shrink-0">PC:{tx.processingCode}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-[var(--fg-subtle)] mt-0.5">
                          {tx.fields.length} 個驗證欄位：{tx.fields.slice(0, 5).map(f => f.id).join(', ')}{tx.fields.length > 5 ? '…' : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)]">
              <span className="text-xs text-[var(--fg-subtle)]">
                已選 {specSelectedTx.size} / {specResult.transactions.length} 種交易
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setSpecImportOpen(false); setSpecResult(null); }}
                  className="btn-secondary text-xs px-4 py-2"
                >取消</button>
                <button
                  onClick={handleSpecImport}
                  disabled={!specBankName.trim() || specSelectedTx.size === 0}
                  className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  存入規格
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
