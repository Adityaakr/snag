import { BudgetExceededError } from './errors.js';

export interface Usage {
  jevInputTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  costUsd: number;
  calls: number;
}

/** Accumulates cost per review and refuses calls once the budget is spent (BUILD_PROMPT 7.3). */
export class CostTracker {
  readonly usage: Usage = { jevInputTokens: 0, llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, calls: 0 };

  constructor(readonly limitUsd: number = Number.POSITIVE_INFINITY) {}

  /** Throws BudgetExceededError when the estimated cost would pass the limit. */
  ensure(provider: string, estimateUsd = 0): void {
    if (this.usage.costUsd + estimateUsd > this.limitUsd)
      throw new BudgetExceededError(provider, this.usage.costUsd, this.limitUsd);
  }

  addJev(inputTokens: number, costUsd: number): void {
    this.usage.jevInputTokens += inputTokens;
    this.usage.costUsd += costUsd;
    this.usage.calls += 1;
  }

  addLlm(inputTokens: number, outputTokens: number, costUsd: number): void {
    this.usage.llmInputTokens += inputTokens;
    this.usage.llmOutputTokens += outputTokens;
    this.usage.costUsd += costUsd;
    this.usage.calls += 1;
  }

  get exceeded(): boolean {
    return this.usage.costUsd >= this.limitUsd;
  }
}
