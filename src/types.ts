// ─── 規格設定相關型別 ──────────────────────────────────────────────────────────

/** 欄位驗証規則 */
export interface VerifyField {
  id: string;
  name: string | null;
  expected: string;
}

/** 單一驗証階段（如主交易、TC Upload） */
export interface TransactionStep {
  step_name: string;
  mti: string;
  fields: VerifyField[];
}

/** 交易規格設定 */
export interface TransactionConfig {
  type?: 'multi-step';
  steps?: TransactionStep[];
  // 向下相容舊版單段式格式
  mti?: string;
  fields?: VerifyField[];
}

/** 銀行所有交易規格 */
export interface BankRules {
  [transactionName: string]: TransactionConfig;
}

/** 完整規格檔 */
export interface AllRules {
  [bankName: string]: BankRules;
}

// ─── 驗証結果相關型別 ─────────────────────────────────────────────────────────

/** 單一欄位驗証結果 */
export interface FieldResult {
  fieldId: string;
  fieldName: string;
  expected: string;
  actual: string;
  pass: boolean;
  message: string;
}

/** 單一階段驗証結果 */
export interface StepResult {
  stepName: string;
  mti: string;
  pass: boolean;
  fields: FieldResult[];
  auth: string;   // Field 38 授權碼
  rrn: string;    // Field 37 序號
  trace: string;  // Field 62 調閱編號
}

/** 完整交易驗証結果 */
export interface TransactionResult {
  id: number;
  timestamp: string;
  bank: string;
  transactionType: string;
  pass: boolean;
  steps: StepResult[];
}

// ─── WebSocket / ADB 橋接相關型別 ─────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}
