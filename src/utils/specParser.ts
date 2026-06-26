import type { AllRules, TransactionStep } from '../types';

interface ParsedTransaction {
  name: string;
  mti: string;
  processingCode: string;
  fields: { id: string; name: string; expected: string }[];
}

interface ParseResult {
  suggestedBankName: string;
  transactions: ParsedTransaction[];
  warnings: string[];
}

const FIELD_NAMES: Record<string, string> = {
  '2': 'Primary Account Number',
  '3': 'Processing Code',
  '4': 'Amount, Transaction',
  '6': 'Card Holder Amount',
  '10': 'Conversion Rate',
  '11': 'System Trace Audit Number',
  '12': 'Time, Local Transaction',
  '13': 'Date, Local Transaction',
  '14': 'Date, Expiration',
  '15': 'Date, Year',
  '22': 'Point of Service Entry Mode',
  '24': 'Network International Identifier',
  '25': 'Point of Service Condition Code',
  '27': 'Installment Flag',
  '35': 'Track II Data',
  '37': 'Retrieval Reference Number',
  '38': 'Authorization Identification Response',
  '39': 'Response Code',
  '41': 'Card Acceptor Terminal Identification',
  '42': 'Card Acceptor Identification Code',
  '47': 'Order Number',
  '48': 'Store Message',
  '49': 'Merchant Currency',
  '51': 'Cardholder Currency',
  '52': 'Pin Block',
  '54': 'Additional Amount',
  '55': 'Chip Data',
  '56': 'Redemption Related Data',
  '57': 'XID',
  '58': 'Additional Data',
  '59': 'Original Transaction Data',
  '60': 'Batch Number',
  '62': 'Invoice Number',
  '63': 'Installment / Totals',
};

function extractFieldNumber(raw: string): string | null {
  const m = raw.match(/(?:Field|Fiels)[_ ]?(\d+)/i);
  if (m) return String(parseInt(m[1], 10));
  const m2 = raw.match(/^(\d{1,2})$/);
  if (m2) return String(parseInt(m2[1], 10));
  return null;
}

function extractProcessingCode(comment: string): string | null {
  const m = comment.match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

function extractMTI(comment: string): string | null {
  const m = comment.match(/\b(0[1-8]\d{2})\b/);
  return m ? m[1] : null;
}

function isConditional(comment: string): boolean {
  const lower = comment.toLowerCase();
  return lower.includes('presented if') ||
    lower.includes('if_exist') ||
    (lower.includes('if ') && !lower.includes('same'));
}

function extractNiiValue(comment: string): string | null {
  const m = comment.match(/\b(\d{3})\b/);
  return m ? m[1] : null;
}

// ── Format A: 彰銀 style — combined table with M/ME/O/C columns ──────────

function parseFormatA(lines: string[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const sectionMatch = line.match(/^#{2,4}\s+\d+\.\d+\s+(.+)/);
    if (!sectionMatch) { i++; continue; }

    const txName = sectionMatch[1].trim();
    i++;

    // Find the table
    let tableStart = -1;
    for (let j = i; j < Math.min(i + 20, lines.length); j++) {
      if (lines[j].includes('|') && (
        lines[j].toLowerCase().includes('request') && lines[j].toLowerCase().includes('response') ||
        lines[j].toLowerCase().includes('req') && lines[j].toLowerCase().includes('res')
      )) {
        tableStart = j;
        break;
      }
    }
    if (tableStart === -1) { continue; }

    // Detect column indices
    const headerLine = lines[tableStart];
    const headerCells = headerLine.split('|').map(c => c.trim());

    let bitCol = -1, nameCol = -1, reqCol = -1, respCol = -1, commentCol = -1;
    headerCells.forEach((cell, idx) => {
      const lower = cell.toLowerCase();
      if (lower === '') return;
      if ((lower.includes('bit') || lower === 'field') && bitCol === -1) bitCol = idx;
      if (lower.includes('field name') || (lower === 'name' && nameCol === -1)) nameCol = idx;
      if (lower === 'request' || lower === 'req.' || lower === 'req') reqCol = idx;
      if (lower === 'response' || lower === 'res.' || lower === 'res') respCol = idx;
      if (lower.includes('comment') || lower.includes('description')) commentCol = idx;
    });

    if (nameCol === -1 && bitCol >= 0) nameCol = bitCol + 1;

    if (reqCol === -1 || respCol === -1) { continue; }

    // Skip separator line
    let j = tableStart + 1;
    if (j < lines.length && lines[j].match(/^\|[\s:|-]+\|$/)) j++;

    let mti = '';
    let processingCode = '';
    const fields: { id: string; name: string; expected: string }[] = [];

    while (j < lines.length && lines[j].startsWith('|')) {
      const cells = lines[j].split('|').map(c => c.trim());
      j++;

      const bitVal = bitCol >= 0 && bitCol < cells.length ? cells[bitCol] : '';
      const nameVal = nameCol >= 0 && nameCol < cells.length ? cells[nameCol] : '';
      const reqVal = reqCol >= 0 && reqCol < cells.length ? cells[reqCol].toUpperCase() : '';
      const respVal = respCol >= 0 && respCol < cells.length ? cells[respCol].toUpperCase() : '';
      const commentVal = commentCol >= 0 && commentCol < cells.length ? cells[commentCol] : '';

      const nameLower = nameVal.toLowerCase();
      if (nameLower.includes('message type') || nameLower === 'mti') {
        const extracted = extractMTI(reqVal || commentVal || cells.slice(2).join(' '));
        if (extracted) mti = extracted;
        continue;
      }
      if (nameLower.includes('bit map')) continue;

      const fieldNum = extractFieldNumber(bitVal) || extractFieldNumber(nameVal);
      if (!fieldNum) continue;

      if (fieldNum === '3') {
        const pc = extractProcessingCode(commentVal || reqVal);
        if (pc) processingCode = pc;
      }

      // Only include fields that are M or ME in Request
      if (reqVal === 'M' || reqVal === 'ME') {
        let expected = 'NOT_NULL';
        if (fieldNum === '3' && processingCode) expected = processingCode;
        else if (fieldNum === '24') {
          const nii = extractNiiValue(commentVal);
          if (nii) expected = nii;
        }
        else if (fieldNum === '25') {
          const codeMatch = commentVal.match(/['"]?(\d{2})['"]?/);
          if (codeMatch) expected = codeMatch[1];
        }
        fields.push({
          id: `REQ_${fieldNum}`,
          name: FIELD_NAMES[fieldNum] || nameVal,
          expected,
        });
      } else if (reqVal === 'C' || reqVal === 'O') {
        let expected = 'IF_EXIST:NOT_NULL';
        if (fieldNum === '3' && processingCode) expected = processingCode;
        fields.push({
          id: `REQ_${fieldNum}`,
          name: FIELD_NAMES[fieldNum] || nameVal,
          expected,
        });
      }

      // Check RSP_39
      if (fieldNum === '39' && (respVal === 'M' || respVal === 'ME')) {
        fields.push({
          id: 'RSP_39',
          name: 'Response Code',
          expected: '00',
        });
      }
    }

    // If RSP_39 not added yet, add it (most transactions expect 00)
    if (!fields.find(f => f.id === 'RSP_39')) {
      fields.push({ id: 'RSP_39', name: 'Response Code', expected: '00' });
    }

    if (mti && fields.length > 1) {
      transactions.push({ name: txName, mti, processingCode, fields });
    }

    i = j;
  }

  return transactions;
}

// ── Format B: TSB style — separate Request/Response tables ────────────

function parseFormatB(lines: string[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const sectionMatch = line.match(/^#{2,4}\s+\d+\.\d+\.?\s+(.+)/);
    if (!sectionMatch) { i++; continue; }

    const txName = sectionMatch[1].trim();
    i++;

    // Find "Request From Terminal" table
    let reqTableStart = -1;
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      if (lines[j].toLowerCase().includes('request from terminal') ||
          lines[j].match(/^\|.*Field.*\|.*Field Name.*\|.*Comment.*\|/i)) {
        reqTableStart = j;
        break;
      }
    }
    if (reqTableStart === -1) { i++; continue; }

    // Skip to table header
    let j = reqTableStart;
    while (j < lines.length && !lines[j].match(/^\|.*Field.*\|.*Field Name.*\|/i)) j++;
    if (j >= lines.length) { i++; continue; }

    // Skip header + separator
    j++;
    if (j < lines.length && lines[j].match(/^\|[\s:|-]+\|$/)) j++;

    let mti = '';
    let processingCode = '';
    const fields: { id: string; name: string; expected: string }[] = [];

    while (j < lines.length && lines[j].startsWith('|')) {
      const cells = lines[j].split('|').map(c => c.trim());
      j++;

      if (cells.length < 3) continue;
      const fieldCell = cells[1] || '';
      const nameCell = cells[2] || '';
      const commentCell = cells.slice(3).join('|').replace(/\|$/,'').trim();

      const nameLower = nameCell.toLowerCase();
      if (nameLower.includes('message type')) {
        const extracted = extractMTI(commentCell);
        if (extracted) mti = extracted;
        continue;
      }
      if (nameLower.includes('bit map')) continue;

      const fieldNum = extractFieldNumber(fieldCell);
      if (!fieldNum) continue;

      if (fieldNum === '3') {
        const pc = extractProcessingCode(commentCell);
        if (pc) processingCode = pc;
      }

      const conditional = isConditional(commentCell);
      let expected = conditional ? 'IF_EXIST:NOT_NULL' : 'NOT_NULL';

      if (fieldNum === '3' && processingCode) expected = processingCode;
      else if (fieldNum === '25') {
        const codeMatch = commentCell.match(/['"](\d{2})['"]|=\s*['"]?(\d{2})['"]?/);
        if (codeMatch) expected = codeMatch[1] || codeMatch[2];
      }

      fields.push({
        id: `REQ_${fieldNum}`,
        name: FIELD_NAMES[fieldNum] || nameCell,
        expected,
      });
    }

    // Add RSP_39
    if (!fields.find(f => f.id === 'RSP_39')) {
      fields.push({ id: 'RSP_39', name: 'Response Code', expected: '00' });
    }

    if (mti && fields.length > 1) {
      transactions.push({ name: txName, mti, processingCode, fields });
    }

    i = j;
  }

  return transactions;
}

// ── Format detection & main parser ────────────────────────────────────

function detectFormat(content: string): 'A' | 'B' | 'mixed' {
  const hasReqResp = /\|\s*Request\s*\|\s*Response\s*\|/im.test(content) ||
                     /\|\s*Req\.\s*\|\s*Res\.\s*\|/im.test(content);
  const hasSeparateTables = /Request From Terminal/im.test(content);

  if (hasReqResp && hasSeparateTables) return 'mixed';
  if (hasReqResp) return 'A';
  if (hasSeparateTables) return 'B';

  // Fallback: check for M/ME markers in tables
  if (/\|\s*M\s*\|\s*ME?\s*\|/m.test(content)) return 'A';

  return 'B';
}

function guessBankName(content: string): string {
  const lines = content.split('\n').slice(0, 30);
  for (const line of lines) {
    if (line.match(/chang\s*hwa|彰化|彰銀/i)) return '彰銀CHB';
    if (line.match(/taishin|台新/i)) return '台新TSB';
    if (line.match(/cathay|國泰/i)) return '國泰CUB';
    if (line.match(/first\s*bank|第一|一銀/i)) return '第一銀行FCB';
    if (line.match(/mega|兆豐/i)) return '兆豐ICBC';
    if (line.match(/esun|玉山/i)) return '玉山ESun';
    if (line.match(/ctbc|中信/i)) return '中信CTBC';
    if (line.match(/sinopac|永豐/i)) return '永豐SinoPac';
    if (line.match(/fubon|富邦/i)) return '富邦Fubon';
    if (line.match(/american\s*express|amex|gedc/i)) return 'AE';
  }
  return '未命名銀行';
}

function findTransactionSections(content: string): string {
  const lines = content.split('\n');
  const startPatterns = [
    /^#{1,4}\s+\d+\.\s+.*(?:Message|Transaction|Authorization).*(?:Bit\s*Map|Format|Field|Interface)/i,
    /^#{1,4}\s+\d+\.\d+\.?\s+(?:Sale|Refund|Void|Settle|Logon|Reversal|Batch|Pre.?Auth|Inquiry|Close|Change|Download|TC Upload|Passive|FISC|CHBI|Authorization|Financial|Reconciliation|Maintenance|Transaction Upload)/i,
  ];

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPatterns.some(p => p.test(lines[i]))) {
      if (sectionStart === -1) sectionStart = Math.max(0, i - 2);
    }
  }

  if (sectionStart === -1) {
    // Fallback: try to find "Section 5" or "Section 7" style headers
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^#{1,3}\s+[5-7]\b/)) {
        sectionStart = i;
        break;
      }
    }
  }

  return sectionStart >= 0 ? lines.slice(sectionStart).join('\n') : content;
}

export function parseSpec(content: string): ParseResult {
  const warnings: string[] = [];
  const suggestedBankName = guessBankName(content);

  const txSection = findTransactionSections(content);
  const format = detectFormat(txSection);
  const lines = txSection.split('\n');

  let transactions: ParsedTransaction[] = [];

  if (format === 'A') {
    transactions = parseFormatA(lines);
  } else if (format === 'B') {
    transactions = parseFormatB(lines);
  } else {
    // Mixed: try both parsers and merge
    const txA = parseFormatA(lines);
    const txB = parseFormatB(lines);
    const seenNames = new Set<string>();
    for (const tx of [...txB, ...txA]) {
      if (!seenNames.has(tx.name)) {
        transactions.push(tx);
        seenNames.add(tx.name);
      }
    }
  }

  if (transactions.length === 0) {
    warnings.push('未偵測到交易格式表。請確認規格文件包含交易欄位定義（Section 5/7 等）。');
  }

  return { suggestedBankName, transactions, warnings };
}

export function toRulesJson(bankName: string, transactions: ParsedTransaction[]): AllRules {
  const bankRules: Record<string, { type: 'multi-step'; description: string; steps: TransactionStep[] }> = {};

  for (const tx of transactions) {
    const cleanName = tx.name
      .replace(/\(Not Support.*?\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    bankRules[cleanName] = {
      type: 'multi-step' as const,
      description: cleanName,
      steps: [{
        step_name: cleanName,
        mti: tx.mti,
        fields: tx.fields,
      }],
    };
  }

  return { [bankName]: bankRules };
}
