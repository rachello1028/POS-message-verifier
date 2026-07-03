import type {
  AutoTestScript, AutoTestStep, AutoStepResult, AutoRunStatus,
  TransactionResult, TransactionStep, AllRules, TransactionConfig,
} from '../types';
import { PosBridge, type PosStepResult } from './posBridge';
import { AdbBridge } from './adbBridge';

export interface RunnerCallbacks {
  onStatusChange: (status: AutoRunStatus) => void;
  onStepUpdate: (stepIdx: number, result: AutoStepResult) => void;
  onTransaction: (tx: TransactionResult) => void;
  onLog: (msg: string) => void;
}

interface StepContext {
  authCode: string;
  rrn: string;
  traceNumber: string;
  txDate: string;
}

export class AutoTestRunner {
  private posBridge: PosBridge;
  private adbBridge: AdbBridge;
  private callbacks: RunnerCallbacks;
  private rules: AllRules;
  private status: AutoRunStatus = 'idle';
  private abortRequested = false;
  private currentStepResolve: ((result: PosStepResult) => void) | null = null;
  private txWaitResolve: ((tx: TransactionResult) => void) | null = null;
  private pendingTx: TransactionResult | null = null;
  private context: Map<string, StepContext> = new Map();
  private prevContext: StepContext = { authCode: '', rrn: '', traceNumber: '', txDate: '' };
  private txCounter = 0;

  constructor(
    posBridge: PosBridge,
    adbBridge: AdbBridge,
    rules: AllRules,
    callbacks: RunnerCallbacks,
  ) {
    this.posBridge = posBridge;
    this.adbBridge = adbBridge;
    this.rules = rules;
    this.callbacks = callbacks;
  }

  async runScript(script: AutoTestScript, adbDevice = ''): Promise<void> {
    this.status = 'running';
    this.abortRequested = false;
    this.context.clear();
    this.prevContext = { authCode: '', rrn: '', traceNumber: '', txDate: '' };
    this.callbacks.onStatusChange('running');
    this.callbacks.onLog(`開始執行腳本：${script.name}（共 ${script.steps.length} 步）`);

    this.adbBridge.startLogcat(adbDevice);
    this.callbacks.onLog('ADB logcat 監聽已啟動');

    for (let i = 0; i < script.steps.length; i++) {
      if (this.abortRequested) {
        this.callbacks.onLog('測試已中止');
        for (let j = i; j < script.steps.length; j++) {
          this.callbacks.onStepUpdate(j, {
            stepId: script.steps[j].id,
            stepName: script.steps[j].name,
            status: 'skipped',
            progressMessages: ['已跳過'],
          });
        }
        break;
      }

      await this.executeStep(i, script.steps[i]);
    }

    this.adbBridge.stopLogcat();
    this.status = this.abortRequested ? 'aborted' : 'completed';
    this.callbacks.onStatusChange(this.status);
    this.callbacks.onLog(`腳本執行${this.abortRequested ? '已中止' : '完成'}`);
  }

  abort(): void {
    this.abortRequested = true;
    this.callbacks.onLog('正在中止測試...');
  }

  private async executeStep(idx: number, step: AutoTestStep): Promise<void> {
    const result: AutoStepResult = {
      stepId: step.id,
      stepName: step.name,
      status: 'running',
      progressMessages: [],
    };
    this.callbacks.onStepUpdate(idx, result);
    this.callbacks.onLog(`[${idx + 1}] 執行：${step.name}`);
    this.pendingTx = null;

    const action = this.resolveAction(step);

    const config = this.getTransactionConfig(step.bank, step.transType);
    if (config) {
      const steps = this.configToSteps(config);
      this.adbBridge.setTestTarget(step.bank, step.transType, steps);
    }

    const posResult = await this.executePosAction(step.id, action, result, idx);

    if (!posResult || !posResult.success) {
      result.status = 'failed';
      result.error = posResult?.msg ?? 'POS 操作失敗';
      this.callbacks.onStepUpdate(idx, result);
      this.callbacks.onLog(`[${idx + 1}] ❌ 失敗：${result.error}`);
      return;
    }

    result.authCode = posResult.authCode;
    result.rrn = posResult.rrn;
    result.traceNumber = posResult.traceNumber;
    result.txDate = posResult.txDate;
    result.logData = posResult.logData;

    const ctx: StepContext = {
      authCode: posResult.authCode,
      rrn: posResult.rrn,
      traceNumber: posResult.traceNumber,
      txDate: posResult.txDate,
    };
    this.prevContext = ctx;
    if (step.saveResultAs) {
      this.context.set(step.saveResultAs, ctx);
    }

    const txReceived = await this.waitForTransaction(15000);
    if (txReceived) {
      result.transaction = txReceived;
      result.status = txReceived.pass ? 'passed' : 'failed';
      this.callbacks.onLog(`[${idx + 1}] ${txReceived.pass ? '✅' : '❌'} 電文驗證${txReceived.pass ? '通過' : '失敗'}`);
    } else {
      result.status = posResult.success ? 'passed' : 'failed';
      this.callbacks.onLog(`[${idx + 1}] ⚠️ 未收到電文驗證結果（POS 操作${posResult.success ? '成功' : '失敗'}）`);
    }

    this.callbacks.onStepUpdate(idx, result);
  }

  private resolveAction(step: AutoTestStep): Record<string, unknown> {
    const a = step.posAction;
    const resolved: Record<string, unknown> = {
      funcName: a.funcName,
      amount: a.amount ?? '',
      payMethod: a.payMethod ?? '',
      transType: a.transType ?? '',
      installments: a.installments ?? '',
      dccChoice: a.dccChoice ?? '外幣',
      settleUnit: a.settleUnit ?? '',
      cardNo: a.cardNo ?? '',
      expDate: a.expDate ?? '',
      signatureMode: a.signatureMode ?? 'electronic',
      addTip: a.addTip ?? '',
      waitSeconds: a.waitSeconds ?? 60,
    };

    if (a.traceRef) resolved['traceNo'] = this.resolveRef(a.traceRef, 'traceNumber');
    if (a.authRef) resolved['authCode'] = this.resolveRef(a.authRef, 'authCode');
    if (a.rrnRef) resolved['rrn'] = this.resolveRef(a.rrnRef, 'rrn');
    if (a.txDateRef) resolved['txDate'] = this.resolveRef(a.txDateRef, 'txDate');

    return resolved;
  }

  private resolveRef(ref: string, field: keyof StepContext): string {
    const prevMatch = ref.match(/\{\{prev\.(\w+)\}\}/);
    if (prevMatch) return this.prevContext[field] ?? '';

    const keyMatch = ref.match(/\{\{(\w+)\.(\w+)\}\}/);
    if (keyMatch) {
      const ctx = this.context.get(keyMatch[1]);
      return ctx ? (ctx[field] ?? '') : '';
    }

    return ref;
  }

  private executePosAction(
    stepId: string,
    action: Record<string, unknown>,
    result: AutoStepResult,
    idx: number,
  ): Promise<PosStepResult | null> {
    return new Promise((resolve) => {
      this.currentStepResolve = resolve;

      const progressHandler = (_sid: string, stage: string, message: string) => {
        result.progressMessages.push(`[${stage}] ${message}`);
        if (stage === 'waiting' || message.includes('等待') || message.includes('刷卡')) {
          result.status = 'waiting_card';
        }
        this.callbacks.onStepUpdate(idx, { ...result });
      };

      const originalOnStepProgress = this.posBridge['callbacks'].onStepProgress;
      const originalOnStepResult = this.posBridge['callbacks'].onStepResult;

      this.posBridge['callbacks'].onStepProgress = progressHandler;
      this.posBridge['callbacks'].onStepResult = (posResult: PosStepResult) => {
        this.posBridge['callbacks'].onStepProgress = originalOnStepProgress;
        this.posBridge['callbacks'].onStepResult = originalOnStepResult;
        this.currentStepResolve = null;
        resolve(posResult);
      };

      this.posBridge.executePosStep(stepId, action);

      setTimeout(() => {
        if (this.currentStepResolve === resolve) {
          this.posBridge['callbacks'].onStepProgress = originalOnStepProgress;
          this.posBridge['callbacks'].onStepResult = originalOnStepResult;
          this.currentStepResolve = null;
          resolve(null);
        }
      }, ((action['waitSeconds'] as number) ?? 60) * 1000 + 30000);
    });
  }

  private waitForTransaction(timeoutMs: number): Promise<TransactionResult | null> {
    if (this.pendingTx) {
      const tx = this.pendingTx;
      this.pendingTx = null;
      return Promise.resolve(tx);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.txWaitResolve = null;
        resolve(null);
      }, timeoutMs);

      this.txWaitResolve = (tx) => {
        clearTimeout(timer);
        this.txWaitResolve = null;
        resolve(tx);
      };
    });
  }

  feedTransaction(tx: TransactionResult): void {
    if (this.txWaitResolve) {
      this.txWaitResolve(tx);
    } else {
      this.pendingTx = tx;
    }
  }

  private getTransactionConfig(bank: string, transType: string): TransactionConfig | null {
    const bankRules = this.rules[bank];
    if (!bankRules) return null;
    return bankRules[transType] ?? null;
  }

  private configToSteps(config: TransactionConfig): TransactionStep[] {
    if (config.type === 'multi-step' && config.steps) {
      return config.steps;
    }
    if (config.mti && config.fields) {
      return [{ step_name: '主交易', mti: config.mti, fields: config.fields }];
    }
    return [];
  }
}
