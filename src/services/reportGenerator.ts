import type { TransactionResult, FieldResult } from '../types';

export type ExportFormat = 'html' | 'csv' | 'json' | 'excel' | 'caselist';

function formatNow(): string {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function maskCard(val: string): string {
  if (!val || val.length < 10) return val;
  const t = val.trim();
  if (t.length < 10) return val;
  return `${t.substring(0, 6)}${'*'.repeat(t.length - 10)}${t.substring(t.length - 4)}`;
}

function sanitizeField(f: FieldResult): FieldResult {
  if (/^(REQ_2|RSP_2)\b/.test(f.fieldId) && f.actual) {
    return { ...f, actual: maskCard(f.actual), message: f.message.replace(f.actual, maskCard(f.actual)) };
  }
  return f;
}

function escCsv(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HTML Report ─────────────────────────────────────────────────────────────

export function generateHTML(
  transactions: TransactionResult[],
  meta: { bank: string; transType: string }
): string {
  const total = transactions.length;
  const passed = transactions.filter(t => t.pass).length;
  const failed = total - passed;
  const rate = total > 0 ? Math.round((passed / total) * 10000) / 100 : 0;

  const testListHTML = transactions.map((tx, idx) => {
    const stepsHTML = tx.steps.map(step => {
      const fieldsHTML = step.fields.map(f => {
        const sf = sanitizeField(f);
        if (sf.pass) {
          return `<li class="field-pass"><span class="field-icon">✓</span> ${escHtml(sf.message)}</li>`;
        }
        return `<li class="field-fail"><span class="field-icon">✗</span> ${escHtml(sf.message)}</li>`;
      }).join('\n');

      return `
      <div class="step">
        <div class="step-header ${step.pass ? 'step-pass' : 'step-fail'}">
          <span>${step.pass ? '✓' : '✗'} ${escHtml(step.stepName)}</span>
          <span class="step-meta">[${escHtml(step.mti)}] 授權碼: ${escHtml(step.auth)} / 序號: ${escHtml(step.rrn)}</span>
        </div>
        <ul class="field-list">${fieldsHTML}</ul>
      </div>`;
    }).join('\n');

    return `
    <div class="tx-card ${tx.pass ? 'tx-pass' : 'tx-fail'}">
      <div class="tx-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="tx-status">${tx.pass ? '✅' : '❌'}</span>
        <span class="tx-title">交易 #${tx.id}</span>
        <span class="tx-badge ${tx.pass ? 'badge-pass' : 'badge-fail'}">${tx.pass ? '通過' : '失敗'}</span>
        <span class="tx-time">${escHtml(tx.timestamp)}</span>
        <span class="tx-detail">${escHtml(tx.bank)} · ${escHtml(tx.transactionType)}</span>
        <span class="chevron">▼</span>
      </div>
      <div class="tx-body">${stepsHTML}</div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>POS 電文驗証報告 — ${escHtml(meta.bank)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --bg: #020617; --surface: #0f172a; --surface-2: #1e293b;
    --fg: #f1f5f9; --fg-muted: #94a3b8; --border: #334155;
    --primary: #5b7fa6; --emerald: #6ee7b7; --red: #fca5a5;
    --emerald-soft: rgba(16,185,129,0.12); --red-soft: rgba(239,68,68,0.12);
    --emerald-line: rgba(16,185,129,0.3); --red-line: rgba(239,68,68,0.3);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif;
    background: var(--bg); color: var(--fg);
    padding: 32px; line-height: 1.6;
  }
  .container { max-width: 960px; margin: 0 auto; }

  /* Header */
  .report-header {
    background: linear-gradient(135deg, #3b597a 0%, #5b7fa6 100%);
    color: white; padding: 28px 32px; border-radius: 12px; margin-bottom: 24px;
  }
  .report-header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
  .report-header .meta { opacity: 0.85; font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 16px; }

  /* Summary */
  .summary-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;
  }
  .summary-card {
    background: var(--surface); border-radius: 10px; padding: 16px 20px; text-align: center;
    border: 1px solid var(--border);
  }
  .summary-card .value { font-size: 1.8rem; font-weight: 700; }
  .summary-card .label { font-size: 0.8rem; color: var(--fg-muted); margin-top: 2px; }
  .summary-card.s-pass { border-left: 3px solid var(--emerald); }
  .summary-card.s-pass .value { color: var(--emerald); }
  .summary-card.s-fail { border-left: 3px solid var(--red); }
  .summary-card.s-fail .value { color: var(--red); }
  .summary-card.s-rate { border-left: 3px solid var(--primary); }
  .summary-card.s-rate .value { color: var(--primary); }

  .progress-bar {
    height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 28px;
  }
  .progress-fill { height: 100%; background: var(--emerald); }

  /* Transaction cards */
  .tx-card {
    background: var(--surface); border-radius: 8px; margin-bottom: 8px;
    border: 1px solid var(--border); overflow: hidden;
  }
  .tx-card.tx-pass { border-left: 3px solid var(--emerald); }
  .tx-card.tx-fail { border-left: 3px solid var(--red); }

  .tx-header {
    display: flex; align-items: center; gap: 10px; padding: 12px 16px;
    cursor: pointer; font-size: 0.9rem; flex-wrap: wrap;
  }
  .tx-header:hover { background: var(--surface-2); }
  .tx-status { font-size: 1.1rem; }
  .tx-title { font-weight: 600; }
  .tx-badge {
    font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; font-weight: 600;
  }
  .badge-pass { background: var(--emerald-soft); color: var(--emerald); }
  .badge-fail { background: var(--red-soft); color: var(--red); }
  .tx-time { color: var(--fg-muted); font-size: 0.8rem; }
  .tx-detail { color: var(--fg-muted); font-size: 0.8rem; flex: 1; text-align: right; }
  .chevron { color: var(--fg-muted); font-size: 0.7rem; transition: transform 0.2s; }
  .tx-card.expanded .chevron { transform: rotate(180deg); }

  .tx-body { display: none; border-top: 1px solid var(--border); padding: 16px; }
  .tx-card.expanded .tx-body { display: block; }

  /* Steps */
  .step { margin-bottom: 14px; }
  .step:last-child { margin-bottom: 0; }
  .step-header {
    font-size: 0.85rem; font-weight: 600; padding: 6px 0; display: flex;
    align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
  .step-pass { color: var(--emerald); }
  .step-fail { color: var(--red); }
  .step-meta { font-weight: 400; font-size: 0.75rem; color: var(--fg-muted); font-family: 'JetBrains Mono', monospace; }

  /* Fields */
  .field-list { list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .field-list li {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 5px 10px; border-radius: 4px; font-size: 0.8rem;
    font-family: 'JetBrains Mono', monospace;
  }
  .field-icon { flex-shrink: 0; }
  .field-pass {
    background: var(--surface-2); color: var(--fg-muted);
    border: 1px solid transparent;
  }
  .field-pass .field-icon { color: var(--emerald); opacity: 0.5; }
  .field-fail {
    background: var(--red-soft); color: var(--red);
    border: 1px solid var(--red-line); font-weight: 600;
    box-shadow: 0 0 12px rgba(239,68,68,0.1);
  }
  .field-fail .field-icon { color: #ef4444; }

  /* Footer */
  .report-footer {
    text-align: center; color: var(--fg-muted); font-size: 0.8rem;
    padding: 24px 0; border-top: 1px solid var(--border); margin-top: 24px;
  }

  /* Print */
  @media print {
    body { background: white; color: #1a1a1a; padding: 16px; }
    .report-header { background: #3b597a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tx-body { display: block !important; }
    .tx-card { break-inside: avoid; }
    .chevron { display: none; }
  }

  /* Toggle script */
  .tx-card { cursor: default; }
</style>
<script>
document.addEventListener('click', e => {
  const h = e.target.closest('.tx-header');
  if (h) h.parentElement.classList.toggle('expanded');
});
</script>
</head>
<body>
<div class="container">
  <div class="report-header">
    <h1>📋 POS 電文驗証報告</h1>
    <div class="meta">
      <span>銀行：${escHtml(meta.bank)}</span>
      <span>交易類型：${escHtml(meta.transType)}</span>
      <span>產生時間：${escHtml(formatNow())}</span>
      <span>共 ${total} 筆交易</span>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="value">${total}</div>
      <div class="label">總交易數</div>
    </div>
    <div class="summary-card s-pass">
      <div class="value">${passed}</div>
      <div class="label">通過</div>
    </div>
    <div class="summary-card s-fail">
      <div class="value">${failed}</div>
      <div class="label">失敗</div>
    </div>
    <div class="summary-card s-rate">
      <div class="value">${rate}%</div>
      <div class="label">成功率</div>
    </div>
  </div>

  <div class="progress-bar">
    <div class="progress-fill" style="width:${rate}%"></div>
  </div>

  <div class="tx-list">
    ${testListHTML}
  </div>

  <div class="report-footer">
    POS 電文驗証平台 — ISO 8583 規格化驗証工具<br>
    Designed &amp; Architected by Rachel Lo · Generated at ${escHtml(formatNow())}
  </div>
</div>
</body>
</html>`;
}

// ─── CSV (原始詳細) ──────────────────────────────────────────────────────────

export function generateCSV(transactions: TransactionResult[]): string {
  const headers = [
    'No.', '交易ID', '時間', '銀行', '交易類型', '結果',
    '步驟', 'MTI', '步驟結果', '授權碼', '序號',
    '欄位ID', '欄位名稱', '預期值', '實際值', '欄位結果', '訊息',
  ];

  const rows: string[] = [headers.map(escCsv).join(',')];
  let no = 0;

  for (const tx of transactions) {
    for (const step of tx.steps) {
      for (const f of step.fields) {
        no++;
        const sf = sanitizeField(f);
        rows.push([
          String(no), String(tx.id), tx.timestamp, tx.bank, tx.transactionType,
          tx.pass ? '通過' : '失敗', step.stepName, step.mti,
          step.pass ? '通過' : '失敗', step.auth, step.rrn,
          sf.fieldId, sf.fieldName, sf.expected, sf.actual,
          sf.pass ? '通過' : '失敗', sf.message,
        ].map(escCsv).join(','));
      }
    }
  }
  return rows.join('\n');
}

// ─── Excel 報告（對齊 ECR 格式）─────────────────────────────────────────────

export function generateExcel(
  transactions: TransactionResult[],
  screenshotNames?: Map<number, string>
): string {
  const headers = [
    'No.', '測試案例ID', '交易類別', 'P Code', '交易金額',
    '卡號', '過卡方式', '回應碼', '預期結果', '實際結果', '測試時間',
    '授權碼', '序號', '備註',
  ];

  const rows: string[] = [headers.map(escCsv).join(',')];

  for (const tx of transactions) {
    const step = tx.steps[0];
    if (!step) continue;

    const findField = (prefix: string) => {
      const f = step.fields.find(f => f.fieldId.startsWith(prefix));
      return f ? sanitizeField(f) : null;
    };

    const cardField = findField('REQ_2');
    const amountField = findField('REQ_4');
    const rcField = findField('RSP_39');
    const pcodeField = findField('REQ_3');
    const entryModeField = findField('REQ_22');

    const amount = amountField?.actual ?? '';
    const formattedAmount = amount ? `$${(parseInt(amount, 10) / 100).toLocaleString()}` : '';

    rows.push([
      String(tx.id),
      `TX_${String(tx.id).padStart(3, '0')}`,
      tx.transactionType,
      pcodeField?.actual ?? step.mti,
      formattedAmount,
      cardField?.actual ?? '',
      entryModeField?.actual ?? '',
      rcField?.actual ?? '',
      '電文驗証通過',
      tx.pass ? 'Pass' : 'Fail',
      tx.timestamp,
      step.auth,
      `="${step.rrn}"`,
      screenshotNames?.get(tx.id) ?? '',
    ].map(escCsv).join(','));
  }

  return rows.join('\n');
}

// ─── 案例清單（精簡版）─────────────────────────────────────────────────────

export function generateCaseList(transactions: TransactionResult[]): string {
  const headers = [
    'No.', '交易類別', '卡種', '過卡', '交易金額', '預期結果', '結果',
  ];

  const rows: string[] = [headers.map(escCsv).join(',')];

  for (const tx of transactions) {
    const step = tx.steps[0];
    if (!step) continue;

    const findField = (prefix: string) => step.fields.find(f => f.fieldId.startsWith(prefix));
    const amountField = findField('REQ_4');
    const cardField = findField('REQ_2');
    const entryModeField = findField('REQ_22');
    const amount = amountField?.actual ?? '';
    const formattedAmount = amount ? `$${(parseInt(amount, 10) / 100).toLocaleString()}` : '';

    rows.push([
      String(tx.id),
      tx.transactionType,
      cardField ? sanitizeField(cardField).actual : '',
      entryModeField?.actual ?? '',
      formattedAmount,
      '電文驗証通過',
      tx.pass ? 'Pass' : 'Fail',
    ].map(escCsv).join(','));
  }

  return rows.join('\n');
}

// ─── JSON Export ──────────────────────────────────────────────────────────────

export function generateJSON(
  transactions: TransactionResult[],
  meta: { bank: string; transType: string }
): string {
  const sanitized = transactions.map(tx => ({
    ...tx,
    steps: tx.steps.map(step => ({
      ...step,
      fields: step.fields.map(sanitizeField),
    })),
  }));

  return JSON.stringify({
    format: 'POS_TEST_REPORT',
    version: '1.0',
    generatedAt: formatNow(),
    bank: meta.bank,
    transactionType: meta.transType,
    summary: {
      total: transactions.length,
      passed: transactions.filter(t => t.pass).length,
      failed: transactions.filter(t => !t.pass).length,
    },
    transactions: sanitized,
  }, null, 2);
}

// ─── Download Helper ─────────────────────────────────────────────────────────

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob(['﻿' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadReport(
  format: ExportFormat,
  transactions: TransactionResult[],
  meta: { bank: string; transType: string },
  screenshotNames?: Map<number, string>
): void {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const base = `pos-report-${meta.bank}-${ts}`;

  switch (format) {
    case 'html':
      downloadBlob(generateHTML(transactions, meta), `${base}.html`, 'text/html;charset=utf-8');
      break;
    case 'csv':
      downloadBlob(generateCSV(transactions), `${base}.csv`, 'text/csv;charset=utf-8');
      break;
    case 'excel':
      downloadBlob(generateExcel(transactions, screenshotNames), `${base}-excel.csv`, 'text/csv;charset=utf-8');
      break;
    case 'caselist':
      downloadBlob(generateCaseList(transactions), `${base}-cases.csv`, 'text/csv;charset=utf-8');
      break;
    case 'json':
      downloadBlob(generateJSON(transactions, meta), `${base}.json`, 'application/json;charset=utf-8');
      break;
  }
}
