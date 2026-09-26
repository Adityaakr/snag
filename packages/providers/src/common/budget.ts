import { BudgetExceededError } from './errors.js';

export interface Usage {
  jevInputTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  costUsd: number;
  calls: number;
}

/** One provider call, for the `api_calls` table (10.4): no request or response content, only a hash. */
export interface CallRecord {
  provider: string;
  model: string;
  kind: string;
  requestHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'ok';
}

export type CallMetaInput = Omit<CallRecord, 'inputTokens' | 'outputTokens' | 'costUsd' | 'status'>;

/** Accumulates cost per review and refuses calls once the budget is spent (BUILD_PROMPT 7.3). */
export class CostTracker {
  readonly usage: Usage = { jevInputTokens: 0, llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, calls: 0 };
  /** Per-call records, capped so a runaway review cannot grow memory without bound. */
  readonly log: CallRecord[] = [];

  constructor(readonly limitUsd: number = Number.POSITIVE_INFINITY) {}

  /** Throws BudgetExceededError when the estimated cost would pass the limit. */
  ensure(provider: string, estimateUsd = 0): void {
    if (this.usage.costUsd + estimateUsd > this.limitUsd)
      throw new BudgetExceededError(provider, this.usage.costUsd, this.limitUsd);
  }

  addJev(inputTokens: number, costUsd: number, meta?: CallMetaInput): void {
    this.usage.jevInputTokens += inputTokens;
    this.usage.costUsd += costUsd;
    this.usage.calls += 1;
    this.record(meta, inputTokens, 0, costUsd);
  }

  addLlm(inputTokens: number, outputTokens: number, costUsd: number, meta?: CallMetaInput): void {
    this.usage.llmInputTokens += inputTokens;
    this.usage.llmOutputTokens += outputTokens;
    this.usage.costUsd += costUsd;
    this.usage.calls += 1;
    this.record(meta, inputTokens, outputTokens, costUsd);
  }

  private record(
    meta: CallMetaInput | undefined,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ) {
    if (meta && this.log.length < 5000)
      this.log.push({ ...meta, inputTokens, outputTokens, costUsd, status: 'ok' });
  }

  get exceeded(): boolean {
    return this.usage.costUsd >= this.limitUsd;
  }
}
