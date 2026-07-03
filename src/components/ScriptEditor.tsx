import React, { useState, useCallback } from 'react';
import {
  X, Plus, Trash2, ChevronUp, ChevronDown, Save, Download,
  Copy, GripVertical,
} from 'lucide-react';
import type { AutoTestScript, AutoTestStep, AutoPosAction, AllRules } from '../types';

interface Props {
  script: AutoTestScript;
  rules: AllRules;
  onSave: (script: AutoTestScript) => void;
  onCancel: () => void;
}

const ALL_FUNC_NAMES = [
  '銷售交易', '取消交易', '退貨交易',
  '小費交易', '預先授權', '預授權完成',
  '預先授權取消', '補登', '調帳',
  '結帳作業',
];
const PAY_METHODS = ['信用卡', '銀聯卡', '晶片金融卡'];
const TRANS_TYPES = ['一般交易', '分期交易', '紅利交易', 'SmartPay', 'DCC'];

const _NEEDS_AMOUNT = new Set(['銷售交易', '退貨交易', '小費交易', '預先授權', '預授權完成', '調帳']);
const _NEEDS_PAY = new Set(['銷售交易', '退貨交易', '預先授權']);
const _NEEDS_TRANS = new Set(['銷售交易', '退貨交易']);
const _NEEDS_REF = new Set(['取消交易', '退貨交易', '小費交易', '預授權完成', '預先授權取消']);

function getFuncNames(bank: string): string[] {
  if (bank.includes('聚合支付')) return ALL_FUNC_NAMES.filter(f => f !== '結帳作業');
  return ALL_FUNC_NAMES;
}

function needsAmount(funcName: string): boolean {
  return _NEEDS_AMOUNT.has(funcName);
}

function needsPayMethod(funcName: string): boolean {
  return _NEEDS_PAY.has(funcName);
}

function needsTransType(funcName: string): boolean {
  return _NEEDS_TRANS.has(funcName);
}

function needsRef(funcName: string): boolean {
  return _NEEDS_REF.has(funcName);
}

function getRefHint(funcName: string, payMethod?: string): string {
  if (funcName === '取消交易') return '取消交易僅需調閱編號（traceNumber）';
  if (funcName === '退貨交易') {
    if (payMethod === '銀聯卡') return '銀聯退貨需原交易日 + 調閱編號 + 授權碼';
    return '信用卡退貨需授權碼 + 原交易日';
  }
  if (funcName === '小費交易') return '小費需引用原銷售交易的調閱編號';
  if (funcName === '預授權完成' || funcName === '預先授權取消') return '需引用原預先授權的調閱編號';
  return '';
}

function extractRefSource(action: AutoPosAction): string | null {
  const ref = action.traceRef ?? action.authRef ?? action.txDateRef ?? action.rrnRef ?? '';
  const m = ref.match(/\{\{(\w+)\./);
  return m ? m[1] : null;
}

function newStep(idx: number): AutoTestStep {
  return {
    id: `step_${Date.now()}_${idx}`,
    name: '新步驟',
    bank: '',
    transType: '',
    posAction: { funcName: '銷售交易' },
  };
}

export default function ScriptEditor({ script: initial, rules, onSave, onCancel }: Props) {
  const [script, setScript] = useState<AutoTestScript>(() => structuredClone(initial));
  const [expandedIdx, setExpandedIdx] = useState<number | null>(
    initial.steps.length > 0 ? 0 : null
  );

  const bankNames = Object.keys(rules);

  const updateScript = useCallback((patch: Partial<AutoTestScript>) => {
    setScript(prev => ({ ...prev, ...patch }));
  }, []);

  const updateStep = useCallback((idx: number, patch: Partial<AutoTestStep>) => {
    setScript(prev => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], ...patch };
      return { ...prev, steps };
    });
  }, []);

  const updateAction = useCallback((idx: number, patch: Partial<AutoPosAction>) => {
    setScript(prev => {
      const steps = [...prev.steps];
      steps[idx] = {
        ...steps[idx],
        posAction: { ...steps[idx].posAction, ...patch },
      };
      return { ...prev, steps };
    });
  }, []);

  const addStep = useCallback(() => {
    setScript(prev => {
      const steps = [...prev.steps, newStep(prev.steps.length)];
      return { ...prev, steps };
    });
    setExpandedIdx(script.steps.length);
  }, [script.steps.length]);

  const removeStep = useCallback((idx: number) => {
    setScript(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx),
    }));
    setExpandedIdx(null);
  }, []);

  const moveStep = useCallback((idx: number, dir: -1 | 1) => {
    setScript(prev => {
      const target = idx + dir;
      if (target < 0 || target >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...prev, steps };
    });
    setExpandedIdx(prev => prev !== null ? prev + dir : null);
  }, []);

  const duplicateStep = useCallback((idx: number) => {
    setScript(prev => {
      const clone = structuredClone(prev.steps[idx]);
      clone.id = `step_${Date.now()}_dup`;
      clone.name = `${clone.name} (複製)`;
      clone.saveResultAs = undefined;
      const steps = [...prev.steps];
      steps.splice(idx + 1, 0, clone);
      return { ...prev, steps };
    });
    setExpandedIdx(idx + 1);
  }, []);

  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.name.replace(/[^\w一-鿿]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [script]);

  const handleSave = useCallback(() => {
    const cleaned = {
      ...script,
      steps: script.steps.map((s, i) => ({ ...s, id: `step_${i + 1}` })),
    };
    onSave(cleaned);
  }, [script, onSave]);

  const availableRefs = script.steps
    .filter(s => s.saveResultAs)
    .map(s => s.saveResultAs!);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-bold text-[var(--fg)]">腳本編輯器</h2>
          <button onClick={onCancel} className="p-1.5 hover:bg-[var(--surface-3)] rounded-lg text-[var(--fg-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Script metadata */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">腳本名稱</label>
              <input
                type="text"
                value={script.name}
                onChange={e => updateScript({ name: e.target.value })}
                className="w-full h-9 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] focus:outline-none focus:border-[var(--blue-line)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">說明</label>
              <input
                type="text"
                value={script.description ?? ''}
                onChange={e => updateScript({ description: e.target.value })}
                className="w-full h-9 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] focus:outline-none focus:border-[var(--blue-line)]"
                placeholder="選填"
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                步驟 ({script.steps.length})
              </h3>
              <button onClick={addStep} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> 新增步驟
              </button>
            </div>

            {script.steps.length === 0 && (
              <div className="text-center py-8 text-sm text-[var(--fg-subtle)] bg-[var(--surface-2)] rounded-xl border border-dashed border-[var(--border)]">
                尚無步驟，點擊「新增步驟」開始編排
              </div>
            )}

            {script.steps.map((step, idx) => {
              const isExpanded = expandedIdx === idx;
              const bankTransTypes = step.bank && rules[step.bank]
                ? Object.keys(rules[step.bank])
                : [];

              return (
                <div
                  key={step.id}
                  className={`border rounded-xl overflow-hidden transition-colors ${
                    isExpanded
                      ? 'border-[var(--blue-line)] bg-[var(--blue-soft)]/30'
                      : 'border-[var(--border)] bg-[var(--surface-2)]'
                  }`}
                >
                  {/* Step header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-3)]/50 transition-colors"
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-[var(--fg-subtle)] flex-shrink-0" />
                    <span className="text-xs font-mono text-[var(--fg-subtle)] w-5 flex-shrink-0">{idx + 1}</span>
                    <span className="text-sm font-medium text-[var(--fg)] flex-1 truncate">{step.name}</span>
                    <span className="text-xs text-[var(--fg-subtle)] truncate max-w-[200px]">
                      {step.posAction.funcName}
                      {step.posAction.amount ? ` $${step.posAction.amount}` : ''}
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => moveStep(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-[var(--surface-3)] disabled:opacity-30 text-[var(--fg-muted)]"
                        title="上移"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveStep(idx, 1)}
                        disabled={idx === script.steps.length - 1}
                        className="p-1 rounded hover:bg-[var(--surface-3)] disabled:opacity-30 text-[var(--fg-muted)]"
                        title="下移"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => duplicateStep(idx)}
                        className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--fg-muted)]"
                        title="複製"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeStep(idx)}
                        className="p-1 rounded hover:bg-[var(--red-soft)] text-[var(--red-ink)]"
                        title="刪除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Step detail */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border)] px-4 py-3 space-y-3 bg-[var(--surface)]">
                      {/* Row 1: name */}
                      <div>
                        <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">步驟名稱</label>
                        <input
                          type="text"
                          value={step.name}
                          onChange={e => updateStep(idx, { name: e.target.value })}
                          className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] focus:outline-none focus:border-[var(--blue-line)]"
                        />
                      </div>

                      {/* Row 2: bank + transType */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">銀行 / 規格</label>
                          <select
                            value={step.bank}
                            onChange={e => updateStep(idx, { bank: e.target.value, transType: '' })}
                            className="w-full h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                          >
                            <option value="">選擇銀行</option>
                            {bankNames.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">交易類型（驗證用）</label>
                          <select
                            value={step.transType}
                            onChange={e => updateStep(idx, { transType: e.target.value })}
                            className="w-full h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                          >
                            <option value="">選擇交易類型</option>
                            {bankTransTypes.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="text-xs font-semibold text-[var(--fg-subtle)] pt-1">POS 操作參數</div>

                      {/* Row 3: funcName + amount */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">功能</label>
                          <select
                            value={step.posAction.funcName}
                            onChange={e => {
                              const fn = e.target.value;
                              const clearFields: Partial<AutoPosAction> = { funcName: fn };
                              if (!needsAmount(fn)) clearFields.amount = undefined;
                              if (!needsPayMethod(fn)) clearFields.payMethod = undefined;
                              if (!needsTransType(fn)) clearFields.transType = undefined;
                              updateAction(idx, clearFields);
                            }}
                            className="w-full h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                          >
                            {getFuncNames(step.bank).map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        {needsAmount(step.posAction.funcName) && (
                          <div>
                            <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">
                              {step.posAction.funcName === '小費交易' ? '小費金額' : '金額'}
                            </label>
                            <input
                              type="text"
                              value={step.posAction.amount ?? ''}
                              onChange={e => updateAction(idx, { amount: e.target.value })}
                              className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] focus:outline-none focus:border-[var(--blue-line)]"
                              placeholder={step.posAction.funcName === '小費交易' ? '例如 190' : '例如 100'}
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">等待秒數</label>
                          <input
                            type="number"
                            value={step.posAction.waitSeconds ?? 60}
                            onChange={e => updateAction(idx, { waitSeconds: parseInt(e.target.value) || 60 })}
                            className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] focus:outline-none focus:border-[var(--blue-line)]"
                            min={10}
                            max={300}
                          />
                        </div>
                      </div>

                      {/* Row 4: payMethod + transType — 僅銷售/退貨時顯示 */}
                      {(needsPayMethod(step.posAction.funcName) || needsTransType(step.posAction.funcName)) && (
                        <div className="grid grid-cols-2 gap-3">
                          {needsPayMethod(step.posAction.funcName) && (
                            <div>
                              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">付款方式</label>
                              <select
                                value={step.posAction.payMethod ?? ''}
                                onChange={e => updateAction(idx, { payMethod: e.target.value || undefined })}
                                className="w-full h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                              >
                                <option value="">不指定</option>
                                {PAY_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            </div>
                          )}
                          {needsTransType(step.posAction.funcName) && (
                            <div>
                              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">交易方式</label>
                              <select
                                value={step.posAction.transType ?? ''}
                                onChange={e => updateAction(idx, { transType: e.target.value || undefined })}
                                className="w-full h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                              >
                                <option value="">不指定</option>
                                {TRANS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Row 4b: 分期期數 / PIN — 條件式顯示 */}
                      {(step.posAction.transType === '分期交易' || step.posAction.payMethod === '銀聯卡' || step.posAction.payMethod === '晶片金融卡') && (
                        <div className="grid grid-cols-3 gap-3">
                          {step.posAction.transType === '分期交易' && (
                            <div>
                              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">分期期數</label>
                              <input
                                type="text"
                                value={step.posAction.installments ?? ''}
                                onChange={e => updateAction(idx, { installments: e.target.value || undefined })}
                                className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] font-mono focus:outline-none focus:border-[var(--blue-line)]"
                                placeholder="例如 3、6、12"
                              />
                            </div>
                          )}
                          {(step.posAction.payMethod === '銀聯卡' || step.posAction.payMethod === '晶片金融卡') && (
                            <div>
                              <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">PIN 碼</label>
                              <input
                                type="text"
                                value={step.posAction.pin ?? ''}
                                onChange={e => updateAction(idx, { pin: e.target.value || undefined })}
                                className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] font-mono focus:outline-none focus:border-[var(--blue-line)]"
                                placeholder="空白=等待手動輸入"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Row 5: saveResultAs */}
                      <div>
                        <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">
                          儲存結果為（供後續步驟引用）
                        </label>
                        <input
                          type="text"
                          value={step.saveResultAs ?? ''}
                          onChange={e => updateStep(idx, { saveResultAs: e.target.value || undefined })}
                          className="w-full h-8 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)] font-mono focus:outline-none focus:border-[var(--blue-line)]"
                          placeholder="例如 sale1"
                        />
                      </div>

                      {/* Row 6: Refs — 需要引用前筆交易的功能才顯示 */}
                      {idx > 0 && availableRefs.length > 0 && needsRef(step.posAction.funcName) && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">引用前筆交易結果</label>
                            {getRefHint(step.posAction.funcName, step.posAction.payMethod) && (
                              <p className="text-xs text-[var(--amber-ink)] mb-1.5">
                                💡 {getRefHint(step.posAction.funcName, step.posAction.payMethod)}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <select
                                value={extractRefSource(step.posAction) ?? ''}
                                onChange={e => {
                                  const ref = e.target.value;
                                  if (ref) {
                                    updateAction(idx, {
                                      traceRef: `{{${ref}.traceNumber}}`,
                                      authRef: `{{${ref}.authCode}}`,
                                      txDateRef: `{{${ref}.txDate}}`,
                                      rrnRef: `{{${ref}.rrn}}`,
                                    });
                                  } else {
                                    updateAction(idx, {
                                      traceRef: undefined,
                                      authRef: undefined,
                                      txDateRef: undefined,
                                      rrnRef: undefined,
                                    });
                                  }
                                }}
                                className="flex-1 h-8 px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg)]"
                              >
                                <option value="">不引用</option>
                                {availableRefs
                                  .filter((_, ri) => {
                                    const refStepIdx = script.steps.findIndex(s => s.saveResultAs === availableRefs[ri]);
                                    return refStepIdx < idx;
                                  })
                                  .map(r => {
                                    const refStep = script.steps.find(s => s.saveResultAs === r);
                                    return (
                                      <option key={r} value={r}>
                                        {r} — {refStep?.name ?? ''}
                                      </option>
                                    );
                                  })}
                              </select>
                            </div>
                            {extractRefSource(step.posAction) && (
                              <div className="mt-1.5 text-xs text-[var(--fg-subtle)] bg-[var(--surface-2)] rounded-lg px-3 py-2 font-mono grid grid-cols-2 gap-1">
                                <span>調閱編號 ← {step.posAction.traceRef}</span>
                                <span>授權碼 ← {step.posAction.authRef}</span>
                                <span>原交易日 ← {step.posAction.txDateRef}</span>
                                <span>RRN ← {step.posAction.rrnRef}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between flex-shrink-0">
          <button onClick={handleExportJson} className="toolbar-btn text-xs flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> 匯出 JSON
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="btn-secondary text-xs px-4 py-2">
              取消
            </button>
            <button onClick={handleSave} className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> 儲存腳本
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
