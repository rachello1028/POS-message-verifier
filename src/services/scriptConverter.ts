import type { TransactionResult, StepResult, AutoTestScript, AutoTestStep, AutoPosAction } from '../types';
import { parseIsoLog } from './isoVerifier';

function inferFuncName(mti: string, pcode: string): string {
  const m = mti.replace(/^0x/, '').trim();
  if (m.includes('0400') || m.includes('0420')) return '取消交易';
  if (m.includes('0500') || m.includes('0520')) return '結帳';
  const pc = pcode.replace(/^0x/, '').trim();
  if (pc.startsWith('20')) return '退貨交易';
  return '銷售交易';
}

function inferPayMethod(cardBrand: string, transType: string): string {
  if (cardBrand === 'SP' || /smartpay/i.test(transType)) return '晶片金融卡';
  if (cardBrand === 'CUP' || /銀聯/.test(transType)) return '銀聯卡';
  return '信用卡';
}

function inferPosTransType(transType: string): string {
  if (/smartpay/i.test(transType)) return 'SmartPay';
  if (/分期/.test(transType)) return '分期交易';
  if (/紅利/.test(transType)) return '紅利交易';
  if (/DCC/i.test(transType)) return 'DCC';
  return '一般交易';
}

function extractAmountFromRawLog(step: StepResult): string {
  if (!step.rawLog) return '';
  const parsed = parseIsoLog(step.rawLog);
  const raw = parsed['REQ_4'] ?? parsed['4'] ?? '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  if (num === 0) return '';
  return String(num % 100 === 0 ? num / 100 : num / 100);
}

function extractAmountFromFields(step: StepResult): string {
  const f4 = step.fields.find(f =>
    f.fieldId === 'REQ_4' || f.fieldId === '4' || f.fieldId.endsWith('_4')
  );
  if (f4?.actual) {
    const digits = f4.actual.replace(/\D/g, '');
    if (digits) {
      const num = parseInt(digits, 10);
      if (num > 0) return String(num % 100 === 0 ? num / 100 : num / 100);
    }
  }
  return '';
}

export function transactionsToScript(
  transactions: TransactionResult[],
  scriptName?: string,
): AutoTestScript {
  const steps: AutoTestStep[] = [];
  let saleCounter = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const mainStep = tx.steps[0];
    if (!mainStep) continue;

    const funcName = inferFuncName(mainStep.mti, mainStep.pcode);
    const payMethod = inferPayMethod(mainStep.cardBrand, tx.transactionType);
    const amount = extractAmountFromFields(mainStep) || extractAmountFromRawLog(mainStep);

    const posAction: AutoPosAction = { funcName };
    if (amount) posAction.amount = amount;
    if (payMethod) posAction.payMethod = payMethod;
    if (funcName === '銷售交易') {
      posAction.transType = inferPosTransType(tx.transactionType);
    }

    let saveResultAs: string | undefined;

    if (funcName === '銷售交易') {
      saleCounter++;
      saveResultAs = `sale${saleCounter}`;
    } else if (funcName === '取消交易') {
      const prevSale = findPrevSale(steps);
      if (prevSale) {
        posAction.traceRef = `{{${prevSale}.traceNumber}}`;
      }
    } else if (funcName === '退貨交易') {
      const prevSale = findPrevSale(steps);
      if (prevSale) {
        posAction.authRef = `{{${prevSale}.authCode}}`;
        posAction.txDateRef = `{{${prevSale}.txDate}}`;
      }
    }

    const stepName = [
      funcName,
      amount ? `$${amount}` : '',
      payMethod ? `· ${payMethod}` : '',
    ].filter(Boolean).join(' ');

    steps.push({
      id: `step_${steps.length + 1}`,
      name: stepName,
      bank: tx.bank,
      transType: tx.transactionType,
      posAction,
      saveResultAs,
    });
  }

  return {
    id: `custom-${Date.now()}`,
    name: scriptName || `匯出腳本 ${new Date().toLocaleString('zh-TW')}`,
    description: `從測試驗證面板匯出（${steps.length} 步驟）`,
    steps,
  };
}

function findPrevSale(steps: AutoTestStep[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].saveResultAs && steps[i].posAction.funcName === '銷售交易') {
      return steps[i].saveResultAs;
    }
  }
  return undefined;
}
