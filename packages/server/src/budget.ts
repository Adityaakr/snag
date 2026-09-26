/**
 * The per-installation daily budget (BUILD_PROMPT 9.13) for every job that spends provider money: reviews and issue
 * checklists. A run reserves its worst case (the per-review maximum, capped at a quarter of the daily budget) in the
 * spend ledger before it starts, so concurrent runs cannot all pass, and settles to its real spend however it ends.
 */
import type { RemitConfig } from '@remit/core';
import type { Logger } from './logger.js';
import type { Store } from './store.js';

export interface Reservation {
  /** The config with the per-run limit capped, for the providers' cost tracker. */
  config: RemitConfig;
  /** Replaces the reservation with real spend. Never throws: a failure is logged and the two-day prune cleans up. */
  settle(costUsd: number): Promise<void>;
}

export async function reserveBudget(
  store: Store,
  dailyBudgetUsd: number | undefined,
  installationId: number,
  runId: string,
  config: RemitConfig,
  log: Logger,
): Promise<Reservation | 'over'> {
  if (dailyBudgetUsd === undefined) return { config, settle: async () => {} };
  const perRun = Math.min(config.budgets.max_usd_per_review, dailyBudgetUsd / 4);
  const capped: RemitConfig = { ...config, budgets: { ...config.budgets, max_usd_per_review: perRun } };
  const settle = async (costUsd: number) => {
    try {
      await store.settleSpend(runId, costUsd);
    } catch (e) {
      log.error({ runId, error: (e as Error).message }, 'could not settle the spend reservation');
    }
  };
  await store.reserveSpend(installationId, runId, perRun);
  let total: number;
  try {
    total = await store.spendToday(installationId);
  } catch (e) {
    await settle(0);
    throw e;
  }
  if (total > dailyBudgetUsd) {
    await settle(0);
    log.warn({ total, limit: dailyBudgetUsd }, 'daily budget reached; run skipped');
    return 'over';
  }
  return { config: capped, settle };
}
