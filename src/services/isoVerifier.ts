import type { VerifyField, FieldResult } from '../types';

/**
 * 解析 ISO 8583 logcat 記錄
 * 支援：
 * - 自動去除 ANSI 顏色碼
 * - REQ (SEND) / RSP (RECEIVE) 區塊自動識別
 * - Field / Tag / Sub-field 三層結構
 * - 數字補零轉換：Field "03" → "3"
 */
export function parseIsoLog(logText: string): Record<string, string> {
  const blockData: Record<string, string> = {};
  const result: Record<string, string> = {};
  let inBlock = false;
  let packetType = '';
  let parentField: string | null = null;

  const ansiRe = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

  for (const rawLine of logText.split('\n')) {
    const line = rawLine.replace(ansiRe, '').trim();
    if (!line) continue;

    // ── 區塊起始 ─────────────────────────────────────────────────────────────
    // 使用短字串匹配，避免因等號數量差異導致比對失敗
    if (line.includes('RECEIVE DATA UnPack START')) {
      inBlock = true;
      packetType = 'RSP';
      Object.keys(blockData).forEach(k => delete blockData[k]);
      parentField = null;
      continue;
    }
    if (line.includes('REAL SEND DATA Pack START')) {
      inBlock = true;
      packetType = 'REQ';
      Object.keys(blockData).forEach(k => delete blockData[k]);
      parentField = null;
      continue;
    }

    // ── 區塊結尾：把本區塊資料合入總結果 ────────────────────────────────────
    if (
      line.includes('RECEIVE DATA UnPack END') ||
      line.includes('REAL SEND DATA Pack END')
    ) {
      inBlock = false;
      for (const [k, v] of Object.entries(blockData)) {
        result[`${packetType}_${k}`] = v;
        result[k] = v; // 不帶前綴的版本（方便通用查找）
      }
      continue;
    }

    if (!inBlock) continue;

    // ── 解析 Field/Tag 行 ────────────────────────────────────────────────────
    // 實際 logcat 行含時間戳前綴，必須用 includes 判斷 Field/Tag，不能專連行首
    // 正則對齊原始 Python re.search 行為（任意位置找到第一筆匹配）
    // 一個 pattern 涵蓋全部情況：有/無 Field、Tag 前綴，有/無空格
    const m = line.match(/(?:Field|Tag)?\s*([.*A-Za-z0-9_]+)\s*:\s*\[\d+\](.*)/);
    if (!m) continue;

    // 對齊 Python 原始邏輯：
    //   m[1] = 欄位名稱（可能包含 .MTI、03、9F26、M6 等）
    //   m[2] = 欄位值
    let nameRaw = m[1].trim();
    const val = m[2].trim();

    // 判斷用 includes（不能用 ^Field 錨定，因為 logcat 行有時間戳前綴）
    if (line.includes('Field')) {
      // 純數字欄位去除前導零 (e.g., "03" → "3")
      if (/^\d+$/.test(nameRaw)) {
        nameRaw = String(parseInt(nameRaw, 10));
      }
      parentField = nameRaw;
      blockData[parentField] = val;
    } else if (line.includes('Tag') && parentField) {
      blockData[`${parentField}_${nameRaw}`] = val;
      blockData[`${parentField}_TAG_${nameRaw}`] = val;
    } else if (parentField) {
      // Sub-field（無 Field/Tag 關鍵字）：58_M6, 58_MA, 58_QJ
      blockData[`${parentField}_${nameRaw}`] = val;
    }
  }

  return result;
}

/**
 * 依規格驗証已解析的電文
 *
 * 支援的 expected 模式：
 *   MUST_EXIST       → 欄位必須存在（值可為空）
 *   NOT_NULL         → 欄位必須存在且不為空
 *   MUST_NOT_EXIST   → 欄位不得出現
 *   IF_EXIST:VALUE   → 選填；若出現則值必須包含 VALUE
 *   IF_EXIST:NOT_NULL→ 選填；若出現則不得為空
 *   REGEX:pattern    → 欄位值須符合正規表達式
 *   (具體值)         → 欄位值必須包含此字串
 */
export function verifyMessage(
  parsed: Record<string, string>,
  fields: VerifyField[]
): { pass: boolean; results: FieldResult[] } {
  let allPass = true;
  const results: FieldResult[] = [];

  for (const rule of fields) {
    const fId   = String(rule.id   ?? '').trim();
    const fName = String(rule.name ?? '').trim();
    const fExp  = String(rule.expected ?? '').trim();

    if (!fId || fId.toLowerCase() === 'nan') continue;

    const exists = fId in parsed;
    const actual = String(parsed[fId] ?? '').trim();
    const displayName = fName ? `${fId} (${fName})` : fId;

    let pass = true;
    let message = '';

    if (fExp === 'MUST_EXIST') {
      if (!exists) {
        pass = false;
        message = `欄位缺失：${displayName}（必須送出，但未出現）`;
      } else {
        message = `欄位存在：${displayName} = "${actual || '(空值)'}"`;
      }

    } else if (fExp === 'MUST_NOT_EXIST') {
      if (exists) {
        pass = false;
        message = `違規夾帶：${displayName}（不應送出，實際帶了 "${actual}"）`;
      } else {
        message = `符合預期（未出現）：${displayName}`;
      }

    } else if (fExp.startsWith('IF_EXIST:')) {
      const target = fExp.slice('IF_EXIST:'.length).trim();
      if (!exists) {
        message = `合法省略：${displayName}（選填欄位，本次未帶入）`;
      } else if (target === 'NOT_NULL') {
        if (actual) {
          message = `選填欄位存在值：${displayName} = "${actual}"`;
        } else {
          pass = false;
          message = `選填欄位空值違規：${displayName}（帶了就不能是空的）`;
        }
      } else {
        if (actual.includes(target)) {
          message = `選填欄位符合預期：${displayName} = "${actual}"`;
        } else {
          pass = false;
          message = `選填欄位值錯誤：${displayName}，預期含 "${target}"，實際 "${actual}"`;
        }
      }

    } else if (fExp.startsWith('REGEX:')) {
      const pattern = fExp.slice('REGEX:'.length).trim();
      if (!exists || !actual) {
        pass = false;
        message = `找不到欄位或值為空：${displayName}`;
      } else {
        try {
          const re = new RegExp(pattern);
          if (re.test(actual)) {
            message = `符合正規式：${displayName} = "${actual}"`;
          } else {
            pass = false;
            message = `正規式不符：${displayName}，預期符合 /${pattern}/，實際 "${actual}"`;
          }
        } catch {
          pass = false;
          message = `正規式語法錯誤：${displayName}，pattern="${pattern}"`;
        }
      }

    } else if (fExp === 'NOT_NULL') {
      if (!exists || !actual) {
        pass = false;
        message = `找不到欄位或值為空：${displayName}`;
      } else {
        message = `欄位存在值：${displayName} = "${actual}"`;
      }

    } else {
      // 具體值比對
      if (!exists || !actual) {
        pass = false;
        message = `找不到欄位：${displayName}`;
      } else if (actual.includes(fExp)) {
        message = `符合預期：${displayName} = "${actual}"`;
      } else {
        pass = false;
        message = `值不符：${displayName}，預期含 "${fExp}"，實際 "${actual}"`;
      }
    }

    if (!pass) allPass = false;
    results.push({ fieldId: fId, fieldName: fName, expected: fExp, actual, pass, message });
  }

  return { pass: allPass, results };
}
