/**
 * Provider failures, classified as retryable or fatal (BUILD_PROMPT 12). Messages never include secrets.
 */
export type ProviderErrorKind =
  | 'overflow'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'server'
  | 'auth'
  | 'bad_request'
  | 'validation'
  | 'budget'
  | 'cache_miss'
  | 'config';

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limited',
  'overloaded',
  'timeout',
  'connection',
  'server',
]);

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly fix?: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.retryable = RETRYABLE.has(kind);
  }
}

/** Raised when a call would push a review over its dollar budget. Partial results are still usable. */
export class BudgetExceededError extends ProviderError {
  constructor(provider: string, spentUsd: number, limitUsd: number) {
    super(
      provider,
      'budget',
      `budget of $${limitUsd.toFixed(2)} reached ($${spentUsd.toFixed(4)} spent); stopping further calls`,
      'Raise budgets.max_usd_per_review or pass --budget-usd.',
    );
    this.name = 'BudgetExceededError';
  }
}
